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
  provider_query: string;
  date: string;            // YYYY-MM-DD
  start_local: string;     // HH:MM (24h)
  end_local: string;       // HH:MM (24h)
  timezone: string;        // IANA
  intent: 'approve_extra_hours' | 'general';
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
        description: 'Extract structured shift-approval parameters from the question.',
        parameters: {
          type: 'object',
          properties: {
            provider_query: { type: 'string', description: 'Provider name as written, e.g. "Mandy" or "Amanda Smith".' },
            date: { type: 'string', description: 'Target date YYYY-MM-DD. Today is ' + todayDefault + '. Year defaults to current year if missing.' },
            start_local: { type: 'string', description: '24h local start time HH:MM, e.g. "10:00".' },
            end_local: { type: 'string', description: '24h local end time HH:MM, e.g. "17:00".' },
            timezone: { type: 'string', description: 'IANA timezone. Default America/New_York if EST/ET implied or unspecified.' },
            intent: { type: 'string', enum: ['approve_extra_hours', 'general'] },
            notes: { type: 'string', description: 'Optional extra context.' },
          },
          required: ['provider_query', 'date', 'start_local', 'end_local', 'timezone', 'intent'],
          additionalProperties: false,
        },
      },
    }];

    const extractRes = await callAI({
      messages: [
        { role: 'system', content: 'You extract shift-approval parameters from short natural-language questions sent by ops staff. Always return a tool call. Times like "10am-5pm EST" map to start_local 10:00 end_local 17:00 timezone America/New_York.' },
        { role: 'user', content: question },
      ],
      tools: extractTools,
      tool_choice: { type: 'function', function: { name: 'parse_question' } },
    }, apiKey);

    const extractCall = extractRes.choices?.[0]?.message?.tool_calls?.[0];
    if (!extractCall) {
      return new Response(JSON.stringify({
        error: 'Could not parse question. Please include a provider name, date, and time window (e.g. "Mandy wants extra hours May 1, 10am-5pm EST").',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const extracted: ExtractedQuery = JSON.parse(extractCall.function.arguments);

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