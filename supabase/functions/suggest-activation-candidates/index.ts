/**
 * suggest-activation-candidates edge function
 *
 * Answers: "It's 8am today — who can I activate in a deficit state right now?"
 *
 * Input (POST body, all optional):
 *   {
 *     target_date?: string       // YYYY-MM-DD, defaults to today (UTC)
 *     state?: string             // restrict to one state (e.g. "PA")
 *     utilization_threshold?: number  // default 70 (percent); providers at or below are eligible
 *     limit?: number             // default 10 candidates per state
 *     persist?: boolean          // default true; writes an activation_candidate_runs row
 *   }
 *
 * Output:
 *   {
 *     target_date, utilization_threshold, data_source,
 *     deficit_states: [{state, unfilled_slots, candidates: [...]}]
 *   }
 *
 * Data sources (in priority order):
 *   1. provider_utilization_daily for target_date   ← live/today signal
 *   2. provider_utilization latest window           ← 5-week avg fallback
 *
 * Eligibility for a candidate in state X:
 *   - provider_licenses has (profile_id, state X, status='active')
 *   - provider_state_status for (profile_id, state X) is NOT 'active' (or missing)
 *   - utilization_pct ≤ threshold
 *
 * Ranking score per (provider, state):
 *   score = (threshold - utilization_pct) * log2(max(unfilled_slots, 1))
 * Lower utilization and bigger deficit both push candidates up.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { canonicalName, fuzzyScore, FUZZY_MATCH_THRESHOLD } from '../_shared/nameNormalization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  target_date?: string;
  state?: string;
  utilization_threshold?: number;
  limit?: number;
  persist?: boolean;
}

interface Candidate {
  profile_id: string;
  provider_name: string;
  state: string;
  utilization_pct: number;
  data_source: 'daily' | 'five_week_avg';
  readiness_status: string | null;
  ehr_activation_status: string | null;
  score: number;
  unfilled_slots: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body: RequestBody = await req.json().catch(() => ({}));
  const targetDate = body.target_date ?? new Date().toISOString().slice(0, 10);
  const stateFilter = body.state?.toUpperCase();
  const threshold = body.utilization_threshold ?? 70;
  const limit = body.limit ?? 10;
  const persist = body.persist !== false;

  // ── 1. Deficit states for target_date ──────────────────────────────────────
  // Prefer DEFICIT quadrant rows from license_optimization_snapshots for a
  // curated signal. Fall back to state_leftover_slots where unfilled_slots > 0.

  const { data: snapshots, error: snapshotErr } = await supabase
    .from('license_optimization_snapshots')
    .select('state_abbreviation, unfilled_slots, quadrant')
    .eq('snapshot_date', targetDate)
    .eq('quadrant', 'DEFICIT');
  if (snapshotErr) return json({ error: snapshotErr.message }, 500);

  const deficitByState = new Map<string, number>();
  for (const row of snapshots ?? []) {
    const st = row.state_abbreviation as string;
    const slots = (row.unfilled_slots as number | null) ?? 0;
    const prev = deficitByState.get(st) ?? 0;
    if (slots > prev) deficitByState.set(st, slots);
  }

  if (deficitByState.size === 0) {
    const { data: slotRows, error: slotErr } = await supabase
      .from('state_leftover_slots')
      .select('state_abbreviation, unfilled_slots, window_type')
      .eq('slot_date', targetDate)
      .gt('unfilled_slots', 0);
    if (slotErr) return json({ error: slotErr.message }, 500);
    for (const row of slotRows ?? []) {
      const st = row.state_abbreviation as string;
      const slots = (row.unfilled_slots as number) ?? 0;
      const prev = deficitByState.get(st) ?? 0;
      if (slots > prev) deficitByState.set(st, slots);
    }
  }

  let deficitStates = [...deficitByState.keys()];
  if (stateFilter) {
    deficitStates = deficitStates.filter((s) => s === stateFilter);
    // If caller asked for a specific state not flagged as deficit, still surface
    // it with zero slots so they get zero-state signal rather than silence.
    if (deficitStates.length === 0) {
      deficitStates = [stateFilter];
      deficitByState.set(stateFilter, 0);
    }
  }

  if (deficitStates.length === 0) {
    const runId = persist
      ? await logRun(supabase, req, targetDate, threshold, 'daily', 0, [])
      : null;
    return json({
      target_date: targetDate,
      utilization_threshold: threshold,
      data_source: 'daily',
      run_id: runId,
      deficit_states: [],
      note: 'No deficit states detected for this date.',
    });
  }

  // ── 2. Licensed-but-not-activated providers in these states ────────────────

  const { data: licenses, error: licErr } = await supabase
    .from('provider_licenses')
    .select('profile_id, state_abbreviation, status')
    .in('state_abbreviation', deficitStates)
    .eq('status', 'active')
    .not('profile_id', 'is', null);
  if (licErr) return json({ error: licErr.message }, 500);

  if (!licenses || licenses.length === 0) {
    const runId = persist
      ? await logRun(supabase, req, targetDate, threshold, 'daily', deficitStates.length, [])
      : null;
    return json({
      target_date: targetDate,
      utilization_threshold: threshold,
      data_source: 'daily',
      run_id: runId,
      deficit_states: deficitStates.map((s) => ({
        state: s,
        unfilled_slots: deficitByState.get(s) ?? 0,
        candidates: [],
      })),
    });
  }

  const candidateProfileIds = [...new Set(licenses.map((l) => l.profile_id as string))];

  const { data: statuses, error: statusErr } = await supabase
    .from('provider_state_status')
    .select('provider_id, state_abbreviation, ehr_activation_status, readiness_status')
    .in('provider_id', candidateProfileIds)
    .in('state_abbreviation', deficitStates);
  if (statusErr) return json({ error: statusErr.message }, 500);

  const statusLookup = new Map<string, { ehr_activation_status: string; readiness_status: string }>();
  for (const row of statuses ?? []) {
    statusLookup.set(
      `${row.provider_id}::${row.state_abbreviation}`,
      {
        ehr_activation_status: row.ehr_activation_status as string,
        readiness_status: row.readiness_status as string,
      },
    );
  }

  // Drop licenses where the provider is already 'active' in that state.
  const eligiblePairs: Array<{ profile_id: string; state: string; status: { ehr_activation_status: string | null; readiness_status: string | null } }> = [];
  for (const lic of licenses) {
    const key = `${lic.profile_id}::${lic.state_abbreviation}`;
    const s = statusLookup.get(key);
    if (s?.ehr_activation_status === 'active') continue;
    eligiblePairs.push({
      profile_id: lic.profile_id as string,
      state: lic.state_abbreviation as string,
      status: {
        ehr_activation_status: s?.ehr_activation_status ?? null,
        readiness_status: s?.readiness_status ?? null,
      },
    });
  }

  if (eligiblePairs.length === 0) {
    const runId = persist
      ? await logRun(supabase, req, targetDate, threshold, 'daily', deficitStates.length, [])
      : null;
    return json({
      target_date: targetDate,
      utilization_threshold: threshold,
      data_source: 'daily',
      run_id: runId,
      deficit_states: deficitStates.map((s) => ({
        state: s,
        unfilled_slots: deficitByState.get(s) ?? 0,
        candidates: [],
      })),
      note: 'All licensed providers are already activated in these deficit states.',
    });
  }

  // ── 3. Utilization per eligible profile: daily preferred, 5-week avg fallback ─

  const eligibleProfileIds = [...new Set(eligiblePairs.map((p) => p.profile_id))];

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, first_name, last_name')
    .in('id', eligibleProfileIds);
  if (profErr) return json({ error: profErr.message }, 500);

  const profileById = new Map<string, { name: string }>();
  for (const p of profiles ?? []) {
    const display =
      (p.full_name as string | null)
      || [p.first_name, p.last_name].filter(Boolean).join(' ')
      || (p.id as string).slice(0, 8);
    profileById.set(p.id as string, { name: display });
  }

  // Daily util: match by provider name (Metabase doesn't give us profile_id directly).
  // We fuzzy-match profile display name → daily row's provider_name.
  const { data: dailyRows } = await supabase
    .from('provider_utilization_daily')
    .select('provider_name, profile_id, utilization_pct')
    .eq('util_date', targetDate);

  const utilizationByProfile = new Map<string, { pct: number; source: 'daily' | 'five_week_avg' }>();

  // First pass: rows with explicit profile_id.
  for (const row of dailyRows ?? []) {
    if (row.profile_id && typeof row.utilization_pct === 'number') {
      utilizationByProfile.set(row.profile_id as string, {
        pct: Number(row.utilization_pct),
        source: 'daily',
      });
    }
  }

  // Second pass: name-match remaining daily rows to eligible profiles.
  const unmatchedDaily = (dailyRows ?? []).filter((r) => !r.profile_id && r.provider_name && typeof r.utilization_pct === 'number');
  for (const pid of eligibleProfileIds) {
    if (utilizationByProfile.has(pid)) continue;
    const profileName = profileById.get(pid)?.name;
    if (!profileName) continue;

    let bestScore = 0;
    let bestPct: number | null = null;
    for (const row of unmatchedDaily) {
      const score = fuzzyScore(profileName, row.provider_name as string);
      if (score > bestScore) {
        bestScore = score;
        bestPct = Number(row.utilization_pct);
      }
    }
    if (bestPct !== null && bestScore >= FUZZY_MATCH_THRESHOLD) {
      utilizationByProfile.set(pid, { pct: bestPct, source: 'daily' });
    }
  }

  // Fallback: 5-week average from provider_utilization.
  const missingIds = eligibleProfileIds.filter((pid) => !utilizationByProfile.has(pid));
  if (missingIds.length > 0) {
    const missingNames = missingIds
      .map((pid) => profileById.get(pid)?.name)
      .filter((n): n is string => !!n);

    if (missingNames.length > 0) {
      const { data: weekly } = await supabase
        .from('provider_utilization')
        .select('provider_name, avg_utilization_pct, window_end')
        .order('window_end', { ascending: false });

      // Group by canonical name, keep newest row per name.
      const byCanonical = new Map<string, { pct: number; raw: string }>();
      for (const row of weekly ?? []) {
        const raw = row.provider_name as string;
        const key = canonicalName(raw);
        if (!key || byCanonical.has(key)) continue;
        if (typeof row.avg_utilization_pct !== 'number') continue;
        byCanonical.set(key, { pct: Number(row.avg_utilization_pct), raw });
      }

      for (const pid of missingIds) {
        const profileName = profileById.get(pid)?.name;
        if (!profileName) continue;
        const canon = canonicalName(profileName);
        const exact = byCanonical.get(canon);
        if (exact) {
          utilizationByProfile.set(pid, { pct: exact.pct, source: 'five_week_avg' });
          continue;
        }
        let bestScore = 0;
        let bestPct: number | null = null;
        for (const entry of byCanonical.values()) {
          const score = fuzzyScore(profileName, entry.raw);
          if (score > bestScore) { bestScore = score; bestPct = entry.pct; }
        }
        if (bestPct !== null && bestScore >= FUZZY_MATCH_THRESHOLD) {
          utilizationByProfile.set(pid, { pct: bestPct, source: 'five_week_avg' });
        }
      }
    }
  }

  // ── 4. Build candidates, filter by threshold, rank ─────────────────────────

  const rawCandidates: Candidate[] = [];
  for (const pair of eligiblePairs) {
    const util = utilizationByProfile.get(pair.profile_id);
    if (!util) continue; // no utilization data — skip, don't penalize
    if (util.pct > threshold) continue;

    const unfilled = deficitByState.get(pair.state) ?? 0;
    const slack = Math.max(0, threshold - util.pct);
    const deficitWeight = Math.log2(Math.max(1, unfilled) + 1);
    const score = Math.round(slack * deficitWeight * 100) / 100;

    rawCandidates.push({
      profile_id: pair.profile_id,
      provider_name: profileById.get(pair.profile_id)?.name ?? '—',
      state: pair.state,
      utilization_pct: util.pct,
      data_source: util.source,
      readiness_status: pair.status.readiness_status,
      ehr_activation_status: pair.status.ehr_activation_status,
      score,
      unfilled_slots: unfilled,
    });
  }

  // Group by state, top N per state by score.
  const byState = new Map<string, Candidate[]>();
  for (const c of rawCandidates) {
    if (!byState.has(c.state)) byState.set(c.state, []);
    byState.get(c.state)!.push(c);
  }

  const deficitStatesOutput = deficitStates.map((state) => {
    const candidates = (byState.get(state) ?? [])
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return {
      state,
      unfilled_slots: deficitByState.get(state) ?? 0,
      candidates,
    };
  });

  // Data source summary
  const sourcesUsed = new Set(rawCandidates.map((c) => c.data_source));
  const dataSource: 'daily' | 'five_week_avg' | 'mixed' =
    sourcesUsed.size === 0 ? 'daily' :
    sourcesUsed.size === 1 ? [...sourcesUsed][0] :
    'mixed';

  const runId = persist
    ? await logRun(supabase, req, targetDate, threshold, dataSource, deficitStates.length, deficitStatesOutput)
    : null;

  return json({
    target_date: targetDate,
    utilization_threshold: threshold,
    data_source: dataSource,
    run_id: runId,
    deficit_state_count: deficitStates.length,
    candidate_count: rawCandidates.length,
    deficit_states: deficitStatesOutput,
  });
});

async function logRun(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  targetDate: string,
  threshold: number,
  dataSource: 'daily' | 'five_week_avg' | 'mixed',
  deficitStateCount: number,
  candidates: unknown,
): Promise<string | null> {
  // Best-effort — don't fail the request if this fails.
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    let ranBy: string | null = null;
    const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
    if (jwt && jwt !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      const { data: userData } = await supabase.auth.getUser(jwt);
      ranBy = userData.user?.id ?? null;
    }

    const flat = Array.isArray(candidates)
      ? (candidates as Array<{ candidates: unknown[] }>).flatMap((s) => s.candidates)
      : [];

    const { data, error } = await supabase
      .from('activation_candidate_runs')
      .insert({
        ran_by: ranBy,
        target_date: targetDate,
        utilization_threshold: threshold,
        data_source: dataSource,
        deficit_state_count: deficitStateCount,
        candidate_count: flat.length,
        candidates,
      })
      .select('id')
      .single();
    if (error) return null;
    return (data?.id as string) ?? null;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
