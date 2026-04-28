import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NP_PROHIBITED_STATES = new Set(['AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA']);
const PHYSICIAN_PROFESSIONS = new Set(['MD', 'DO']);
const SLOTS_PER_HOUR = 4;
const DEFAULT_SLA_BUFFER = 1.2;
const DEFAULT_TZ = 'America/New_York';

function canPracticeInState(profession: string | null | undefined, state: string): boolean {
  if (!NP_PROHIBITED_STATES.has(state)) return true;
  return profession ? PHYSICIAN_PROFESSIONS.has(profession.toUpperCase()) : false;
}
function slotsToHours(slots: number) { return slots / SLOTS_PER_HOUR; }
function slaTargetSlots(weeklyVisits: number, buffer: number) {
  return (weeklyVisits / 7) * buffer * SLOTS_PER_HOUR;
}
function getMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}
function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ──────────────── Data freshness helpers ────────────────
// Metabase visit data lags behind real time. The full day's actuals are not
// reliable until ~12h after the day ends (i.e. midday the day after). To stay
// safe we treat any `historical` slot row whose date is AFTER the cutoff as
// "preliminary" and prefer the Homebase-derived `forecast` row instead.
const DEFAULT_METABASE_LAG_DAYS = 2;

function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function getMetabaseLagDays(supabase: any): Promise<number> {
  const { data } = await supabase.from('system_config')
    .select('value').eq('key', 'metabase_lag_days').maybeSingle();
  if (data?.value) {
    const parsed = parseInt(String(data.value), 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 7) return parsed;
  }
  return DEFAULT_METABASE_LAG_DAYS;
}

function settledThrough(todayStr: string, lagDays: number): string {
  return addDaysISO(todayStr, -lagDays);
}

const LOVABLE_API = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

async function callAI(body: Record<string, unknown>, apiKey: string) {
  const res = await fetch(LOVABLE_API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, ...body }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err: any = new Error(`AI gateway ${res.status}: ${t}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

interface ExtractedQuery {
  mode: 'provider' | 'network';
  provider_query: string;
  date: string;            // YYYY-MM-DD
  start_local: string;     // HH:MM (24h)
  end_local: string;       // HH:MM (24h)
  timezone: string;        // IANA
  intent: 'approve_extra_hours' | 'find_gaps' | 'find_surplus' | 'general';
  scan_start_date?: string; // YYYY-MM-DD, for network scans
  scan_end_date?: string;   // YYYY-MM-DD, for network scans
  state_filter?: string;    // optional state abbreviation
  notes?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) throw new Error('LOVABLE_API_KEY is not configured');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* */ }
    const question = typeof body?.question === 'string' ? (body.question as string).trim() : '';
    if (!question) {
      return new Response(JSON.stringify({ error: 'Missing question' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ──────────────── Step A: extract structured params ────────────────
    const todayDefault = todayInTz(DEFAULT_TZ);
    const extractTools = [{
      type: 'function',
      function: {
        name: 'parse_question',
        description: 'Extract structured parameters from a coverage question. Pick mode="provider" when the question is about a specific provider working extra hours. Pick mode="network" when it asks about the network/state level (e.g. "when is the next date with gaps", "which states are short this week", "do we have surplus on Friday").',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['provider', 'network'], description: 'provider = question about one named provider. network = question about overall state coverage / gaps / surplus across the network.' },
            provider_query: { type: 'string', description: 'Provider name as written. Empty string if mode=network.' },
            date: { type: 'string', description: 'Target date YYYY-MM-DD if a single date is asked about. Today is ' + todayDefault + '. Empty string if mode=network and a date range is implied.' },
            start_local: { type: 'string', description: '24h local start time HH:MM. Empty string if not specified.' },
            end_local: { type: 'string', description: '24h local end time HH:MM. Empty string if not specified.' },
            timezone: { type: 'string', description: 'IANA timezone. Default America/New_York if EST/ET implied or unspecified.' },
            intent: { type: 'string', enum: ['approve_extra_hours', 'find_gaps', 'find_surplus', 'general'] },
            scan_start_date: { type: 'string', description: 'For network mode: start of date range to scan, YYYY-MM-DD. Default to today (' + todayDefault + ') if "next" / "upcoming" is implied. Empty string if not applicable.' },
            scan_end_date: { type: 'string', description: 'For network mode: end of date range, YYYY-MM-DD. Default to 14 days after scan_start_date if not specified. Empty string if not applicable.' },
            state_filter: { type: 'string', description: 'Optional 2-letter state abbreviation to focus on. Empty string if none.' },
            notes: { type: 'string', description: 'Optional extra context.' },
          },
          required: ['mode', 'provider_query', 'date', 'start_local', 'end_local', 'timezone', 'intent'],
          additionalProperties: false,
        },
      },
    }];

    const extractRes = await callAI({
      messages: [
        { role: 'system', content: `You extract structured parameters from short natural-language coverage questions sent by ops staff. Always return a tool call.

Mode rules:
- mode="provider": a specific provider name is mentioned and the question is about their hours/shift (e.g. "Mandy wants extra hours May 1 10am-5pm").
- mode="network": no specific provider, or the question is about the state/network level (e.g. "when is the next date with gaps", "which states are short this week", "do we have surplus Friday", "is TX covered next Monday"). Leave provider_query as empty string.

Times like "10am-5pm EST" map to start_local 10:00 end_local 17:00 timezone America/New_York. Today is ${todayDefault}. "Next date with gaps" -> scan_start_date=${todayDefault}, scan_end_date 14 days later.` },
        { role: 'user', content: question },
      ],
      tools: extractTools,
      tool_choice: { type: 'function', function: { name: 'parse_question' } },
    }, apiKey);

    const extractCall = extractRes.choices?.[0]?.message?.tool_calls?.[0];
    if (!extractCall) {
      return new Response(JSON.stringify({
        error: 'Could not parse question. Try "Mandy wants extra hours May 1 10am-5pm EST" or "When is the next date with coverage gaps?"',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const extracted: ExtractedQuery = JSON.parse(extractCall.function.arguments);

    // ──────────────── Network mode short-circuit ────────────────
    if (extracted.mode === 'network') {
      const networkResult = await runNetworkMode(supabase, extracted, todayDefault, apiKey, question);
      return new Response(JSON.stringify(networkResult), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ──────────────── Step B: resolve provider ────────────────
    const queryNorm = normalizeName(extracted.provider_query);
    const queryTokens = queryNorm.split(' ').filter(Boolean);
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, profession, employment_status')
      .eq('employment_status', 'active');

    // Score every profile: exact-name > full-substring > token-prefix > email-localpart-substring
    type Scored = { p: any; score: number };
    const scored: Scored[] = [];
    for (const p of allProfiles ?? []) {
      if (!p.full_name) continue;
      const nameNorm = normalizeName(p.full_name);
      const nameTokens = nameNorm.split(' ');
      const emailLocal = (p.email ?? '').split('@')[0].toLowerCase();
      let score = 0;
      if (nameNorm === queryNorm) score = 100;
      else if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) score = 80;
      else if (queryTokens.some(qt => nameTokens.includes(qt))) score = 70;
      else if (queryTokens.some(qt => qt.length >= 3 && nameTokens.some(nt => nt.startsWith(qt) || qt.startsWith(nt)))) score = 60;
      else if (queryTokens.some(qt => qt.length >= 3 && emailLocal.includes(qt))) score = 50;
      if (score > 0) scored.push({ p, score });
    }
    scored.sort((a, b) => b.score - a.score);
    // If top score is much higher than runner-up, treat as unique match.
    let profileMatches: any[];
    if (scored.length === 0) profileMatches = [];
    else if (scored.length === 1) profileMatches = [scored[0].p];
    else if (scored[0].score - scored[1].score >= 20) profileMatches = [scored[0].p];
    else profileMatches = scored.filter(s => s.score === scored[0].score).map(s => s.p);

    if (profileMatches.length === 0) {
      return new Response(JSON.stringify({
        error: `No active provider matches "${extracted.provider_query}".`,
        extracted,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (profileMatches.length > 1) {
      return new Response(JSON.stringify({
        error: `Multiple providers match "${extracted.provider_query}".`,
        extracted,
        candidates: profileMatches.slice(0, 8).map(p => ({ id: p.id, name: p.full_name, email: p.email })),
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const provider = profileMatches[0];

    // ──────────────── Step C: gather facts ────────────────
    const date = extracted.date;
    const weekStart = getMonday(date);
    const requestedHours = hoursBetween(extracted.start_local, extracted.end_local);

    // SLA buffer
    let buffer = DEFAULT_SLA_BUFFER;
    const { data: cfg } = await supabase.from('system_config')
      .select('value').eq('key', 'sla_buffer_multiplier').maybeSingle();
    if (cfg?.value) {
      const parsed = parseFloat(String(cfg.value));
      if (!Number.isNaN(parsed) && parsed > 0) buffer = parsed;
    }

    // Provider's licenses (with state) and provider_state_status
    const [licRes, statusRes, activationsRes, slotsRes, forecastRes, snapsLatestRes] = await Promise.all([
      supabase.from('provider_licenses')
        .select('state_abbreviation, status').eq('profile_id', provider.id).eq('status', 'active'),
      supabase.from('provider_state_status')
        .select('state_abbreviation, readiness_status, ehr_activation_status').eq('provider_id', provider.id),
      supabase.from('state_activation').select('state_abbreviation, is_active'),
      supabase.from('state_leftover_slots')
        .select('state_abbreviation, unfilled_slots, window_type')
        .eq('slot_date', date).in('window_type', ['historical', 'forecast']),
      supabase.from('demand_forecast')
        .select('state_abbreviation, projected_visits').eq('week_start', weekStart),
      supabase.from('license_optimization_snapshots')
        .select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1),
    ]);

    const licensedStates = (licRes.data ?? []).map(r => r.state_abbreviation as string);
    const statusByState = new Map<string, { readiness: string; ehr: string }>();
    for (const r of statusRes.data ?? []) {
      statusByState.set(r.state_abbreviation, {
        readiness: String(r.readiness_status), ehr: String(r.ehr_activation_status),
      });
    }
    const activeStates = new Set(
      (activationsRes.data ?? []).filter(a => a.is_active).map(a => a.state_abbreviation as string),
    );
    const slotsByState = new Map<string, number>();
    for (const r of slotsRes.data ?? []) {
      const ex = slotsByState.get(r.state_abbreviation);
      if (ex === undefined || r.window_type === 'historical') {
        slotsByState.set(r.state_abbreviation, r.unfilled_slots);
      }
    }
    const forecastByState = new Map<string, number>(
      (forecastRes.data ?? []).map(r => [r.state_abbreviation as string, r.projected_visits as number]),
    );

    // Provider's snapshot allocations (for deactivation candidates)
    const latestSnap = snapsLatestRes.data?.[0]?.snapshot_date as string | undefined;
    const snapsRes = latestSnap
      ? await supabase.from('license_optimization_snapshots')
          .select('state_abbreviation, quadrant, allocated_hours, estimated_demand_hours')
          .eq('snapshot_date', latestSnap).eq('profile_id', provider.id)
      : { data: [] as any[] };
    const allocByState = new Map<string, { quadrant: string; allocated: number; demand: number; slack: number }>();
    for (const s of snapsRes.data ?? []) {
      const allocated = Number(s.allocated_hours ?? 0);
      const demand = Number(s.estimated_demand_hours ?? 0);
      allocByState.set(s.state_abbreviation, {
        quadrant: String(s.quadrant ?? 'UNKNOWN'),
        allocated, demand, slack: allocated - demand,
      });
    }

    // Build per-state facts for states this provider can practice in
    const stateFacts: Array<{
      state: string;
      eligible_to_practice: boolean;
      currently_active: boolean;
      readiness: string | null;
      ehr_status: string | null;
      available_slots: number | null;
      target_slots: number | null;
      gap_hours: number | null;       // positive = state is short
      surplus_hours: number | null;   // positive = state has surplus
      provider_allocated_hours: number | null;
      provider_demand_hours: number | null;
      provider_slack_hours: number | null;
    }> = [];

    for (const state of licensedStates) {
      const eligible = canPracticeInState(provider.profession, state);
      const isActive = activeStates.has(state);
      const available = slotsByState.get(state) ?? null;
      const visits = forecastByState.get(state) ?? null;
      const targetSlots = visits !== null ? slaTargetSlots(visits, buffer) : null;
      let gap: number | null = null;
      let surplus: number | null = null;
      if (targetSlots !== null && available !== null) {
        const diffSlots = targetSlots - available;
        if (diffSlots > 0) gap = round1(slotsToHours(diffSlots));
        else surplus = round1(slotsToHours(-diffSlots));
      }
      const alloc = allocByState.get(state);
      const status = statusByState.get(state);
      stateFacts.push({
        state,
        eligible_to_practice: eligible,
        currently_active: isActive,
        readiness: status?.readiness ?? null,
        ehr_status: status?.ehr ?? null,
        available_slots: available,
        target_slots: targetSlots !== null ? Math.round(targetSlots) : null,
        gap_hours: gap,
        surplus_hours: surplus,
        provider_allocated_hours: alloc?.allocated ?? null,
        provider_demand_hours: alloc?.demand ?? null,
        provider_slack_hours: alloc ? round1(alloc.slack) : null,
      });
    }

    // Already-scheduled hours that day for this provider (Homebase)
    let existingShiftHours = 0;
    {
      const { data: emps } = await supabase.from('homebase_employees')
        .select('id').eq('profile_id', provider.id);
      const empIds = (emps ?? []).map(e => e.id);
      if (empIds.length > 0) {
        const dayStart = `${date}T00:00:00`;
        const dayEnd = `${date}T23:59:59`;
        const { data: shifts } = await supabase.from('homebase_shifts')
          .select('scheduled_hours, scheduled')
          .in('homebase_employee_id', empIds)
          .gte('start_at', dayStart).lte('start_at', dayEnd);
        existingShiftHours = (shifts ?? [])
          .filter(s => s.scheduled !== false)
          .reduce((acc, s) => acc + (Number(s.scheduled_hours) || 0), 0);
      }
    }

    // Active states needing help where provider is licensed but NOT EHR-active → activation candidates
    const activationOpportunities = stateFacts.filter(f =>
      f.eligible_to_practice && f.currently_active &&
      (f.gap_hours ?? 0) > 0 &&
      f.readiness === 'ready' &&
      f.ehr_status && ['inactive', 'deactivated', 'activation_requested'].includes(f.ehr_status)
    );
    // States where this provider has surplus today → deactivation candidates
    const deactivationOpportunities = stateFacts.filter(f =>
      (f.provider_slack_hours ?? 0) >= 3 || (f.surplus_hours ?? 0) >= 4
    );
    // Active eligible states with biggest gaps
    const neediestStates = [...stateFacts]
      .filter(f => f.eligible_to_practice && f.currently_active && (f.gap_hours ?? 0) > 0)
      .sort((a, b) => (b.gap_hours ?? 0) - (a.gap_hours ?? 0));

    const facts = {
      provider: {
        id: provider.id,
        name: provider.full_name,
        email: provider.email,
        profession: provider.profession,
      },
      request: {
        date, start_local: extracted.start_local, end_local: extracted.end_local,
        timezone: extracted.timezone, requested_hours: requestedHours,
      },
      existing_shift_hours_that_day: round1(existingShiftHours),
      eligible_state_count: stateFacts.filter(f => f.eligible_to_practice).length,
      active_state_count: stateFacts.filter(f => f.eligible_to_practice && f.currently_active).length,
      neediest_states: neediestStates.slice(0, 5),
      activation_opportunities: activationOpportunities.slice(0, 5),
      deactivation_opportunities: deactivationOpportunities.slice(0, 5),
      total_network_gap_hours_in_eligible_states: round1(
        stateFacts.filter(f => f.eligible_to_practice && f.currently_active)
          .reduce((acc, f) => acc + (f.gap_hours ?? 0), 0)
      ),
      sla_buffer: buffer,
      slots_per_hour: SLOTS_PER_HOUR,
    };

    // Plain-English narrative for the provider-mode facts.
    {
      const plain: string[] = [];
      plain.push(`${provider.full_name} is licensed in ${facts.eligible_state_count} state(s) where they can legally practice; ${facts.active_state_count} of those are active in our network.`);
      plain.push(`On ${date} they already have ${facts.existing_shift_hours_that_day}h scheduled in Homebase. The request adds ${requestedHours}h.`);
      plain.push(`SLA target = (weekly projected visits ÷ 7) × ${buffer} buffer × ${SLOTS_PER_HOUR} slots/hour. A "gap" means the state is short of that target; a "surplus" means open availability not booked.`);
      if (neediestStates.length > 0) {
        plain.push(`Active eligible states with the biggest gaps that day: ${neediestStates.slice(0,5).map(s => `${s.state} (${s.gap_hours}h short)`).join('; ')}.`);
      } else {
        plain.push(`No active eligible states are short on coverage that day.`);
      }
      if (activationOpportunities.length > 0) {
        plain.push(`Activation candidates (provider is ready but EHR-inactive in a state with a gap): ${activationOpportunities.map(s => s.state).join(', ')}.`);
      }
      if (deactivationOpportunities.length > 0) {
        plain.push(`Deactivation candidates (this provider has slack ≥3h or the state has surplus ≥4h): ${deactivationOpportunities.map(s => s.state).join(', ')}.`);
      }
      (facts as any).plain_english = plain;
    }

    // ──────────────── Step D: synthesize recommendation ────────────────
    const synthTools = [{
      type: 'function',
      function: {
        name: 'recommend',
        description: 'Produce a structured shift-approval recommendation grounded only in the provided facts.',
        parameters: {
          type: 'object',
          properties: {
            recommendation: { type: 'string', enum: ['approve_full', 'approve_partial', 'decline'] },
            approved_hours: { type: 'number', description: 'Number of hours to approve from the requested window. 0 if declining.' },
            suggested_window: {
              type: 'object',
              properties: {
                start_local: { type: 'string' },
                end_local: { type: 'string' },
              },
              required: ['start_local', 'end_local'],
              additionalProperties: false,
              description: 'Suggested narrower window within the requested window. Same as requested if approving full.',
            },
            primary_state: { type: 'string', description: 'The state where the approved hours are most useful (e.g. neediest active+eligible state).' },
            reasons: { type: 'array', items: { type: 'string' }, description: 'Bullet reasons grounded in the facts.' },
            conditional_yes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['activate'] },
                  state: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['action', 'state', 'reason'],
                additionalProperties: false,
              },
              description: 'States where activating this provider would unlock additional approvable hours.',
            },
            conditional_no: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['deactivate'] },
                  state: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['action', 'state', 'reason'],
                additionalProperties: false,
              },
              description: 'States where this provider has surplus and could be deactivated to free capacity.',
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            summary: { type: 'string', description: 'One-paragraph plain-English answer suitable for replying in Slack.' },
          },
          required: ['recommendation', 'approved_hours', 'reasons', 'confidence', 'summary'],
          additionalProperties: false,
        },
      },
    }];

    const synthSystem = `You are an ops copilot deciding whether to approve a provider's request for additional hours.

Decision rules:
- Only approve hours that match a real GAP in an active state where the provider is eligible (licensed AND allowed to practice) AND already EHR-active.
- approved_hours <= request.requested_hours and <= sum of gap_hours across eligible+active states.
- If gap_hours == 0 in all eligible+active states, recommend "decline" UNLESS conditional activation in another state would create demand.
- If gap exists but only partially fills the request, recommend "approve_partial" with approved_hours equal to the coverable gap.
- Use conditional_yes for states where readiness=ready and ehr is inactive/deactivated/activation_requested AND state has gap.
- Use conditional_no for states where this provider has surplus_hours >= 3 (could be deactivated to free capacity).
- Never invent numbers. Cite facts only.
- Keep summary under 3 sentences.`;

    const synthRes = await callAI({
      messages: [
        { role: 'system', content: synthSystem },
        { role: 'user', content: 'FACTS:\n' + JSON.stringify(facts, null, 2) + '\n\nORIGINAL QUESTION:\n' + question },
      ],
      tools: synthTools,
      tool_choice: { type: 'function', function: { name: 'recommend' } },
    }, apiKey);

    const synthCall = synthRes.choices?.[0]?.message?.tool_calls?.[0];
    if (!synthCall) throw new Error('AI did not return a recommendation');
    const recommendation = JSON.parse(synthCall.function.arguments);

    return new Response(JSON.stringify({ extracted, facts, recommendation }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('coverage-copilot error', e);
    const status = e?.status === 429 ? 429 : e?.status === 402 ? 402 : 500;
    const message = status === 429
      ? 'Rate limits exceeded, please try again in a moment.'
      : status === 402
        ? 'AI credits exhausted. Add funds in Settings → Workspace → Usage.'
        : (e?.message ?? 'Unknown error');
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return round1(mins / 60);
}
function round1(n: number): number { return Math.round(n * 10) / 10; }

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function runNetworkMode(
  supabase: any,
  extracted: ExtractedQuery,
  todayDefault: string,
  apiKey: string,
  question: string,
) {
  const startDate = extracted.scan_start_date && extracted.scan_start_date.length === 10
    ? extracted.scan_start_date
    : (extracted.date && extracted.date.length === 10 ? extracted.date : todayDefault);
  const endDate = extracted.scan_end_date && extracted.scan_end_date.length === 10
    ? extracted.scan_end_date
    : (extracted.date && extracted.date.length === 10 ? extracted.date : addDays(startDate, 14));
  const stateFilter = extracted.state_filter && extracted.state_filter.length === 2
    ? extracted.state_filter.toUpperCase() : null;

  // SLA buffer
  let buffer = DEFAULT_SLA_BUFFER;
  const { data: cfg } = await supabase.from('system_config')
    .select('value').eq('key', 'sla_buffer_multiplier').maybeSingle();
  if (cfg?.value) {
    const parsed = parseFloat(String(cfg.value));
    if (!Number.isNaN(parsed) && parsed > 0) buffer = parsed;
  }

  // Active states only
  const { data: actRows } = await supabase.from('state_activation')
    .select('state_abbreviation, is_active');
  const activeStates = new Set(
    (actRows ?? []).filter((a: any) => a.is_active).map((a: any) => a.state_abbreviation as string),
  );

  // Slots over the date range
  let slotsQ = supabase.from('state_leftover_slots')
    .select('state_abbreviation, slot_date, unfilled_slots, window_type')
    .gte('slot_date', startDate).lte('slot_date', endDate)
    .in('window_type', ['historical', 'forecast']);
  if (stateFilter) slotsQ = slotsQ.eq('state_abbreviation', stateFilter);
  const { data: slotRows } = await slotsQ;

  // Forecast: weekly visits per state. Pull all weeks overlapping range.
  const startMonday = getMonday(startDate);
  const endMonday = getMonday(endDate);
  let fcQ = supabase.from('demand_forecast')
    .select('state_abbreviation, week_start, projected_visits')
    .gte('week_start', startMonday).lte('week_start', endMonday);
  if (stateFilter) fcQ = fcQ.eq('state_abbreviation', stateFilter);
  const { data: fcRows } = await fcQ;
  const fcByWeekState = new Map<string, number>();
  for (const r of fcRows ?? []) {
    fcByWeekState.set(`${r.week_start}|${r.state_abbreviation}`, Number(r.projected_visits) || 0);
  }

  // Fallback: if no forecast for any week in range, use the most recent available
  // forecast week as a proxy (so we can still report gaps/surplus using slots).
  let fallbackForecast: Map<string, number> | null = null;
  let fallbackWeek: string | null = null;
  if (fcByWeekState.size === 0) {
    let lfQ = supabase.from('demand_forecast')
      .select('state_abbreviation, week_start, projected_visits')
      .order('week_start', { ascending: false })
      .limit(200);
    if (stateFilter) lfQ = lfQ.eq('state_abbreviation', stateFilter);
    const { data: latest } = await lfQ;
    if (latest && latest.length > 0) {
      fallbackWeek = latest[0].week_start as string;
      fallbackForecast = new Map();
      for (const r of latest) {
        if (r.week_start !== fallbackWeek) continue;
        fallbackForecast.set(r.state_abbreviation, Number(r.projected_visits) || 0);
      }
    }
  }

  // Compute per-day per-state gap/surplus. Prefer historical over forecast for slots.
  const slotKey = new Map<string, { slots: number; window: string }>();
  for (const r of slotRows ?? []) {
    const k = `${r.slot_date}|${r.state_abbreviation}`;
    const existing = slotKey.get(k);
    if (!existing || r.window_type === 'historical') {
      slotKey.set(k, { slots: Number(r.unfilled_slots) || 0, window: r.window_type });
    }
  }

  type DayState = {
    date: string; state: string;
    available_slots: number; target_slots: number;
    gap_hours: number; surplus_hours: number;
    window: string;
  };
  const perDayState: DayState[] = [];
  for (const [k, v] of slotKey) {
    const [date, state] = k.split('|');
    if (!activeStates.has(state)) continue;
    const wk = getMonday(date);
    let visits = fcByWeekState.get(`${wk}|${state}`);
    if (visits === undefined && fallbackForecast) {
      visits = fallbackForecast.get(state);
    }
    if (visits === undefined) continue;
    const target = slaTargetSlots(visits, buffer);
    const diff = target - v.slots;
    perDayState.push({
      date, state,
      available_slots: Math.round(v.slots),
      target_slots: Math.round(target),
      gap_hours: diff > 0 ? round1(slotsToHours(diff)) : 0,
      surplus_hours: diff < 0 ? round1(slotsToHours(-diff)) : 0,
      window: v.window,
    });
  }

  // Aggregate per-day totals
  const perDayMap = new Map<string, { date: string; total_gap_hours: number; total_surplus_hours: number; gap_states: string[]; surplus_states: string[] }>();
  for (const r of perDayState) {
    const d = perDayMap.get(r.date) ?? { date: r.date, total_gap_hours: 0, total_surplus_hours: 0, gap_states: [], surplus_states: [] };
    d.total_gap_hours = round1(d.total_gap_hours + r.gap_hours);
    d.total_surplus_hours = round1(d.total_surplus_hours + r.surplus_hours);
    if (r.gap_hours > 0) d.gap_states.push(`${r.state}(${r.gap_hours}h)`);
    if (r.surplus_hours > 0) d.surplus_states.push(`${r.state}(${r.surplus_hours}h)`);
    perDayMap.set(r.date, d);
  }
  const perDay = [...perDayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const firstDayWithGaps = perDay.find(d => d.total_gap_hours > 0) ?? null;
  const worstDays = [...perDay].sort((a, b) => b.total_gap_hours - a.total_gap_hours).slice(0, 5);
  const stateTotals = new Map<string, { state: string; gap_hours: number; surplus_hours: number; days_with_gaps: number }>();
  for (const r of perDayState) {
    const s = stateTotals.get(r.state) ?? { state: r.state, gap_hours: 0, surplus_hours: 0, days_with_gaps: 0 };
    s.gap_hours = round1(s.gap_hours + r.gap_hours);
    s.surplus_hours = round1(s.surplus_hours + r.surplus_hours);
    if (r.gap_hours > 0) s.days_with_gaps += 1;
    stateTotals.set(r.state, s);
  }
  const topGapStates = [...stateTotals.values()].filter(s => s.gap_hours > 0)
    .sort((a, b) => b.gap_hours - a.gap_hours).slice(0, 5);
  const topSurplusStates = [...stateTotals.values()].filter(s => s.surplus_hours > 0)
    .sort((a, b) => b.surplus_hours - a.surplus_hours).slice(0, 5);

  const facts = {
    mode: 'network',
    scan_range: { start_date: startDate, end_date: endDate },
    state_filter: stateFilter,
    forecast_source: fallbackWeek
      ? `Using fallback forecast from week ${fallbackWeek} (no forecast loaded for the scanned range).`
      : 'Using forecast aligned to scanned weeks.',
    days_with_data: perDay.length,
    first_day_with_gaps: firstDayWithGaps,
    per_day: perDay.slice(0, 30),
    worst_days_by_gap: worstDays,
    top_gap_states: topGapStates,
    top_surplus_states: topSurplusStates,
    sla_buffer: buffer,
    slots_per_hour: SLOTS_PER_HOUR,
    note: perDay.length === 0
      ? `No coverage data found between ${startDate} and ${endDate}. Either state_leftover_slots are missing for these dates or no demand_forecast exists at all.`
      : null,
  };

  // Plain-English narrative of the facts (deterministic, not AI generated).
  const plain: string[] = [];
  plain.push(`Scanned ${perDay.length} day(s) of coverage data from ${startDate} to ${endDate}.`);
  if (fallbackWeek) {
    plain.push(`No demand forecast exists for the scanned range, so the most recent week (${fallbackWeek}) was used as a proxy. Numbers may be off if demand has shifted.`);
  }
  plain.push(`SLA target = (weekly projected visits ÷ 7) × ${buffer} buffer × ${SLOTS_PER_HOUR} slots/hour. Slots are converted to hours at ${SLOTS_PER_HOUR} slots/hour.`);
  plain.push(`A "gap" means available slots fell short of the SLA target. A "surplus" means available slots exceeded the SLA target — note this counts open Homebase availability that wasn't booked, not extra staffed labor.`);
  if (firstDayWithGaps) {
    const states = firstDayWithGaps.gap_states.slice(0, 5).join(', ') || 'none';
    plain.push(`Earliest day with gaps: ${firstDayWithGaps.date} — total ${firstDayWithGaps.total_gap_hours}h short across ${firstDayWithGaps.gap_states.length} state(s) (${states}).`);
  } else if (perDay.length > 0) {
    plain.push(`No gaps found in any active state across the scanned range — every day meets or exceeds SLA target.`);
  }
  if (topGapStates.length > 0) {
    plain.push(`States with the largest cumulative gaps: ${topGapStates.map(s => `${s.state} (${s.gap_hours}h short over ${s.days_with_gaps} day(s))`).join('; ')}.`);
  }
  if (topSurplusStates.length > 0) {
    plain.push(`States with the largest cumulative surplus (open availability not booked): ${topSurplusStates.map(s => `${s.state} (${s.surplus_hours}h)`).join('; ')}.`);
  }
  (facts as any).plain_english = plain;

  const synthTools = [{
    type: 'function',
    function: {
      name: 'network_answer',
      description: 'Answer a network-level coverage question grounded only in the provided facts.',
      parameters: {
        type: 'object',
        properties: {
          headline: { type: 'string', description: 'One-sentence direct answer to the question.' },
          summary: { type: 'string', description: 'Plain-English answer suitable for replying in Slack. Under 4 sentences.' },
          highlighted_date: { type: 'string', description: 'Most relevant date YYYY-MM-DD if applicable, else empty string.' },
          key_states: { type: 'array', items: { type: 'string' }, description: 'Up to 5 state abbreviations the answer focuses on.' },
          reasons: { type: 'array', items: { type: 'string' }, description: 'Bullet reasons grounded in the facts.' },
          suggested_actions: { type: 'array', items: { type: 'string' }, description: 'Concrete next steps (e.g. "Activate ready providers in TX", "Approve extra hours mid-week").' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['headline', 'summary', 'reasons', 'confidence'],
        additionalProperties: false,
      },
    },
  }];

  const synthSystem = `You are an ops copilot answering network-level coverage questions for the team.
- Use ONLY the provided facts. Never invent numbers, dates, or states.
- gap_hours > 0 means the state is short of the SLA target. surplus_hours > 0 means extra capacity.
- If facts.first_day_with_gaps is null, there are no gaps in the scanned range — say so plainly.
- If facts.note is set (no data), explain that politely and stop.
- Keep summary under 4 sentences.`;

  const synthRes = await callAI({
    messages: [
      { role: 'system', content: synthSystem },
      { role: 'user', content: 'FACTS:\n' + JSON.stringify(facts, null, 2) + '\n\nORIGINAL QUESTION:\n' + question },
    ],
    tools: synthTools,
    tool_choice: { type: 'function', function: { name: 'network_answer' } },
  }, apiKey);

  const call = synthRes.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) throw new Error('AI did not return a network answer');
  const network_answer = JSON.parse(call.function.arguments);

  return { mode: 'network', extracted, facts, network_answer };
}