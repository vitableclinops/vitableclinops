import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NP-prohibited states (mirrors src/constants/stateRestrictions.ts)
const NP_PROHIBITED_STATES = new Set(['AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA']);
const PHYSICIAN_PROFESSIONS = new Set(['MD', 'DO']);
function canPracticeInState(profession: string | null | undefined, state: string): boolean {
  if (!NP_PROHIBITED_STATES.has(state)) return true;
  return profession ? PHYSICIAN_PROFESSIONS.has(profession.toUpperCase()) : false;
}

const SLOTS_PER_HOUR = 4;
const DEFAULT_SLA_BUFFER = 1.2;
const COOLDOWN_DAYS = 7;

function slotsToHours(slots: number) { return slots / SLOTS_PER_HOUR; }
function slaTargetSlots(weeklyVisits: number, buffer: number) {
  return (weeklyVisits / 7) * buffer * SLOTS_PER_HOUR;
}
function getChicagoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function getMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

type StateStatus = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';

interface OutreachCandidate {
  profile_id: string;
  name: string;
  email: string;
  current_state: string | null;       // state where they have surplus today
  current_state_status: string | null; // SURPLUS / BALANCED / DEFICIT / null
  surplus_hours: number;               // hours of slack in their current_state
  rank_score: number;                  // lower = better
  on_cooldown: boolean;
  last_contacted_at: string | null;
  working_today: boolean;              // has a Homebase shift covering today
  shift_window: string | null;         // e.g. "9:00 AM – 5:00 PM CT"
  appointments_today: number | null;   // booked appointments today (best-effort name match)
}

interface StateRec {
  state: string;
  status: StateStatus;
  gap_hours: number;
  available_slots: number | null;
  target_slots: number | null;
  outreach_candidates: OutreachCandidate[];
  activation_recommendations: ActivationRec[];
  deactivation_recommendations: DeactivationRec[];
  projected_gain_hours: number;
  residual_gap_hours: number;
}

interface ActivationRec {
  profile_id: string;
  name: string;
  email: string;
  capacity_gain_hours: number; // expected additional hours/day if activated
  ehr_activation_status: string;
  readiness_status: string;
}

interface DeactivationRec {
  profile_id: string;
  name: string;
  state: string;        // surplus state we recommend pulling them OUT of
  allocated_hours: number;
  estimated_demand_hours: number;
  slack_hours: number;  // freed if deactivated
}

const DEFAULT_DAILY_CAPACITY_HOURS = 6; // fallback when no util data
const DEACTIVATION_SLACK_THRESHOLD = 3; // hours

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }
    const overrideDate = typeof body?.date === 'string' ? body.date as string : null;
    const today = overrideDate ?? getChicagoDate();
    const weekStart = getMonday(today);
    const candidatesPerState = typeof body?.candidates_per_state === 'number'
      ? body.candidates_per_state as number
      : 3;

    // SLA buffer
    let buffer = DEFAULT_SLA_BUFFER;
    const { data: cfg } = await supabase.from('system_config')
      .select('value').eq('key', 'sla_buffer_multiplier').maybeSingle();
    if (cfg?.value) {
      const parsed = parseFloat(String(cfg.value));
      if (!Number.isNaN(parsed) && parsed > 0) buffer = parsed;
    }

    // Pull base data in parallel
    // Compute today's UTC bounds for shift overlap (Homebase stores TZ-aware timestamps)
    const todayStartUtc = new Date(`${today}T00:00:00-06:00`).toISOString(); // CT-ish lower bound
    const todayEndUtc = new Date(`${today}T23:59:59-06:00`).toISOString();

    const [activationsRes, slotsRes, forecastRes, snapshotsRes, licensesRes, profilesRes, cooldownRes, shiftsRes, apptsRes] = await Promise.all([
      supabase.from('state_activation').select('state_abbreviation, is_active'),
      supabase.from('state_leftover_slots')
        .select('state_abbreviation, unfilled_slots, window_type')
        .eq('slot_date', today).in('window_type', ['historical', 'forecast']),
      supabase.from('demand_forecast')
        .select('state_abbreviation, projected_visits').eq('week_start', weekStart),
      supabase.from('license_optimization_snapshots')
        .select('profile_id, state_abbreviation, quadrant, allocated_hours, estimated_demand_hours, sla_pct')
        .eq('snapshot_date', await getLatestSnapshotDate(supabase, today)),
      supabase.from('provider_licenses')
        .select('profile_id, state_abbreviation, status').eq('status', 'active'),
      supabase.from('profiles')
        .select('id, full_name, email, employment_status, profession')
        .eq('employment_status', 'active'),
      supabase.from('coverage_outreach_log')
        .select('profile_id, state_abbreviation, sent_at')
        .gte('sent_at', new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()),
      supabase.from('homebase_shifts')
        .select('homebase_employee_id, start_at, end_at, scheduled, published')
        .gte('start_at', todayStartUtc)
        .lte('start_at', todayEndUtc),
      supabase.from('provider_appointment_count')
        .select('provider_name_raw, appointment_count')
        .eq('report_date', today),
    ]);

    const activations = activationsRes.data ?? [];
    const profiles = profilesRes.data ?? [];
    const licenses = licensesRes.data ?? [];
    const snapshots = snapshotsRes.data ?? [];
    const cooldown = cooldownRes.data ?? [];
    const shifts = shiftsRes.data ?? [];
    const appts = apptsRes.data ?? [];

    // Need homebase_employees → profile_id linkage to map shifts to providers
    const homebaseEmployeeIds = Array.from(
      new Set(shifts.map(s => s.homebase_employee_id).filter(Boolean) as string[])
    );
    let workingTodayByProfile = new Map<string, { start: string; end: string }>();
    if (homebaseEmployeeIds.length > 0) {
      const { data: employees } = await supabase
        .from('homebase_employees')
        .select('id, profile_id')
        .in('id', homebaseEmployeeIds);
      const profileByEmpId = new Map((employees ?? []).map(e => [e.id, e.profile_id]));
      for (const sh of shifts) {
        if (!sh.homebase_employee_id || !sh.start_at || !sh.end_at) continue;
        if (sh.scheduled === false) continue;
        const pid = profileByEmpId.get(sh.homebase_employee_id);
        if (!pid) continue;
        // Keep the earliest-starting shift per profile
        const existing = workingTodayByProfile.get(pid);
        if (!existing || sh.start_at < existing.start) {
          workingTodayByProfile.set(pid, { start: sh.start_at, end: sh.end_at });
        }
      }
    }

    // Best-effort appointment count by normalized name
    const apptsByNormalizedName = new Map<string, number>();
    const norm = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    for (const a of appts) {
      if (!a.provider_name_raw) continue;
      apptsByNormalizedName.set(norm(a.provider_name_raw), Number(a.appointment_count ?? 0));
    }

    // Index
    const profileById = new Map(profiles.map(p => [p.id, p]));
    const licensesByState = new Map<string, Set<string>>(); // state → set of profile_ids with active license
    for (const lic of licenses) {
      if (!lic.profile_id) continue;
      if (!licensesByState.has(lic.state_abbreviation)) licensesByState.set(lic.state_abbreviation, new Set());
      licensesByState.get(lic.state_abbreviation)!.add(lic.profile_id);
    }

    // Provider state count (for drop recs): how many states is each provider licensed in?
    const stateCountByProvider = new Map<string, number>();
    for (const lic of licenses) {
      if (!lic.profile_id) continue;
      stateCountByProvider.set(lic.profile_id, (stateCountByProvider.get(lic.profile_id) ?? 0) + 1);
    }

    // Snapshot by (provider, state)
    type Snap = { quadrant: string; allocated_hours: number; estimated_demand_hours: number; sla_pct: number | null };
    const snapByProviderState = new Map<string, Snap>();
    for (const s of snapshots) {
      const key = `${s.profile_id}|${s.state_abbreviation}`;
      snapByProviderState.set(key, {
        quadrant: s.quadrant ?? 'UNKNOWN',
        allocated_hours: Number(s.allocated_hours ?? 0),
        estimated_demand_hours: Number(s.estimated_demand_hours ?? 0),
        sla_pct: s.sla_pct !== null ? Number(s.sla_pct) : null,
      });
    }

    // Cooldown lookup: most recent send per (profile, state)
    const cooldownByKey = new Map<string, string>(); // "profile|state" → ISO
    for (const c of cooldown) {
      const key = `${c.profile_id}|${c.state_abbreviation}`;
      const existing = cooldownByKey.get(key);
      if (!existing || c.sent_at > existing) cooldownByKey.set(key, c.sent_at);
    }

    // Slots per state
    const slotsByState = new Map<string, number>();
    for (const r of slotsRes.data ?? []) {
      const existing = slotsByState.get(r.state_abbreviation);
      if (existing === undefined || r.window_type === 'historical') {
        slotsByState.set(r.state_abbreviation, r.unfilled_slots);
      }
    }
    const forecastByState = new Map<string, number>(
      (forecastRes.data ?? []).map(r => [r.state_abbreviation, r.projected_visits])
    );

    // Compute state status & build recs
    const stateRecs: StateRec[] = [];

    for (const a of activations) {
      if (!a.is_active) continue;
      const state = a.state_abbreviation;
      const available = slotsByState.get(state) ?? null;
      const visits = forecastByState.get(state) ?? null;
      const target = visits !== null ? slaTargetSlots(visits, buffer) : null;

      let status: StateStatus = 'no_data';
      if (target !== null && available !== null) {
        if (available <= 0) status = 'zero';
        else {
          const ratio = available / target;
          if (ratio < 0.5) status = 'critical';
          else if (ratio < 1) status = 'low';
          else status = 'ok';
        }
      }

      // Only produce candidates for states needing help (zero / critical / low)
      const needsHelp = status === 'zero' || status === 'critical' || status === 'low';
      const gapSlots = target !== null && available !== null ? Math.max(0, target - available) : 0;
      const gapHours = slotsToHours(gapSlots);

      const candidates: OutreachCandidate[] = [];

      if (needsHelp) {
        const licensedProviders = licensesByState.get(state) ?? new Set();

        for (const profileId of licensedProviders) {
          const profile = profileById.get(profileId);
          if (!profile || !profile.email) continue;
          // MD-only state: skip NPs and other non-physician roles even if
          // they hold an active license — they cannot legally see patients here.
          if (!canPracticeInState(profile.profession, state)) continue;

          // Find their best surplus elsewhere
          let bestSurplusState: string | null = null;
          let bestSurplusHours = 0;
          let bestQuadrant: string | null = null;

          for (const [key, snap] of snapByProviderState.entries()) {
            if (!key.startsWith(`${profileId}|`)) continue;
            const otherState = key.split('|')[1];
            if (otherState === state) continue;
            const slack = snap.allocated_hours - snap.estimated_demand_hours;
            if (snap.quadrant === 'SURPLUS' && slack > bestSurplusHours) {
              bestSurplusHours = slack;
              bestSurplusState = otherState;
              bestQuadrant = 'SURPLUS';
            } else if (snap.quadrant === 'BALANCED' && bestQuadrant !== 'SURPLUS') {
              bestSurplusState = otherState;
              bestQuadrant = 'BALANCED';
              bestSurplusHours = Math.max(0, slack);
            }
          }

          // Rank: SURPLUS first (sorted by slack desc), then BALANCED, then no-snapshot
          let rankScore = 1000;
          if (bestQuadrant === 'SURPLUS') rankScore = 100 - bestSurplusHours;
          else if (bestQuadrant === 'BALANCED') rankScore = 500;

          const cooldownKey = `${profileId}|${state}`;
          const lastSent = cooldownByKey.get(cooldownKey) ?? null;

          const shift = workingTodayByProfile.get(profileId) ?? null;
          const apptCount = profile.full_name ? apptsByNormalizedName.get(norm(profile.full_name)) ?? null : null;

          candidates.push({
            profile_id: profileId,
            name: profile.full_name ?? 'Unknown',
            email: profile.email,
            current_state: bestSurplusState,
            current_state_status: bestQuadrant,
            surplus_hours: bestSurplusHours,
            rank_score: rankScore,
            on_cooldown: lastSent !== null,
            last_contacted_at: lastSent,
            working_today: shift !== null,
            shift_window: shift ? formatShiftWindow(shift.start, shift.end) : null,
            appointments_today: apptCount,
          });
        }

        // Working-today providers ranked first, then by rank_score
        candidates.sort((a, b) => {
          if (a.working_today !== b.working_today) return a.working_today ? -1 : 1;
          return a.rank_score - b.rank_score;
        });
      }

      if (needsHelp || candidates.length > 0) {
        stateRecs.push({
          state,
          status,
          gap_hours: gapHours,
          available_slots: available,
          target_slots: target !== null ? Math.round(target) : null,
          outreach_candidates: candidates.slice(0, candidatesPerState),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        snapshot_date: today,
        sla_buffer: buffer,
        state_recommendations: stateRecs,
        meta: {
          total_active_states: activations.filter(a => a.is_active).length,
          states_needing_attention: stateRecs.filter(s => s.status !== 'ok' && s.status !== 'no_data').length,
          total_outreach_candidates: stateRecs.reduce((acc, s) => acc + s.outreach_candidates.filter(c => !c.on_cooldown).length, 0),
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('compute-coverage-recommendations error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

async function getLatestSnapshotDate(supabase: any, fallback: string): Promise<string> {
  const { data } = await supabase
    .from('license_optimization_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.snapshot_date ?? fallback;
}

function formatShiftWindow(startIso: string, endIso: string): string {
  try {
    const fmt = (iso: string) => new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
    return `${fmt(startIso)} – ${fmt(endIso)} CT`;
  } catch {
    return '';
  }
}