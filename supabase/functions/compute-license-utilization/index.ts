/**
 * compute-license-utilization edge function
 *
 * Algorithm (per day D):
 *
 * 1. Pull Homebase scheduled_hours per provider for each day in the window.
 * 2. Reconcile each provider's scheduled hours against provider_utilization
 *    actuals (avg_utilization_pct) so "effective supply" reflects real booked
 *    time, not just shifts on the calendar.
 * 3. For each provider, intersect their active licenses with active states.
 * 4. Even-split effective provider hours across those states → supply[state, day].
 * 5. Derive demand_hours per (state, day) using a 3-tier fallback:
 *      a) demand_forecast.projected_visits (weekly → daily / SLOTS_PER_HOUR)  ← preferred
 *      b) leftover_slots + SLA-derived demand                                  ← fallback
 *      c) SLA-only heuristic                                                   ← last resort
 *    coverage_ratio = supply_hours / demand_hours
 * 5. Classify each (state, day) into a quadrant:
 *      DEFICIT  – coverage_ratio < 1.0
 *      BALANCED – 1.0 ≤ coverage_ratio < 1.3
 *      SURPLUS  – coverage_ratio ≥ 1.3
 *      ANOMALY  – SLA < 85% but unfilled_slots > p75 (investigate)
 * 6. Flag wasted hours: provider whose ALL active-licensed states are either
 *    inactive or in SURPLUS with coverage_ratio > 2.
 * 7. Write license_optimization_snapshots (upsert on date+provider+state).
 * 8. Return ranked recommendations:
 *      - ACTIVATE: provider has inactive license in DEFICIT state
 *      - DEACTIVATE: provider's SURPLUS state license is diluting DEFICIT state coverage
 *
 * Body: { window_days?: number }  (defaults to 30, max 90)
 * Runs nightly via cron, also callable on-demand.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SLOTS_PER_HOUR = 2; // 30 min per slot (20 min visit + 10 min charting)
const SLA_LOW_THRESHOLD = 85;
const SLA_HIGH_THRESHOLD = 95;
const COVERAGE_SURPLUS_THRESHOLD = 1.3;
const COVERAGE_DEFICIT_THRESHOLD = 1.0;

// MD-only states: only physicians (MD/DO) may practice here.
// NPs (and other non-physician roles) holding licenses in these states must NOT
// have shift hours allocated here, even when "actively licensed".
const NP_PROHIBITED_STATES = new Set(['AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA']);
const PHYSICIAN_PROFESSIONS = new Set(['MD', 'DO']);
function canPracticeInState(profession: string | null | undefined, state: string): boolean {
  if (!NP_PROHIBITED_STATES.has(state)) return true;
  return profession ? PHYSICIAN_PROFESSIONS.has(profession.toUpperCase()) : false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let windowDays = 30;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.window_days) windowDays = Math.min(90, Math.max(1, Number(body.window_days)));
  } catch { /* ignore */ }

  const startedAt = Date.now();
  const { data: runRow } = await supabase
    .from('sync_runs')
    .insert({ function_name: 'compute-license-utilization', status: 'running' })
    .select('id')
    .single();
  const runId: string | null = (runRow?.id as string) ?? null;
  const finalizeRun = async (
    status: 'success' | 'partial' | 'error',
    extras: { rows_processed?: number; error_message?: string; details?: unknown } = {},
  ) => {
    if (!runId) return;
    await supabase.from('sync_runs').update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      rows_processed: extras.rows_processed ?? 0,
      error_message: extras.error_message ?? null,
      details: extras.details ?? {},
    }).eq('id', runId);
  };

  try {
    // ── Date window ───────────────────────────────────────────────────────────
    const today = new Date();
    const pastDate = new Date(today); pastDate.setDate(pastDate.getDate() - windowDays);
    const futureDate = new Date(today); futureDate.setDate(futureDate.getDate() + windowDays);
    const windowStart = pastDate.toISOString().slice(0, 10);
    const windowEnd = futureDate.toISOString().slice(0, 10);

    // ── Load active states ────────────────────────────────────────────────────
    const { data: activeStateRows } = await supabase
      .from('state_activation')
      .select('state_abbreviation')
      .eq('is_active', true);
    const activeStates = new Set((activeStateRows ?? []).map((r: any) => r.state_abbreviation));

    // ── Load SLA data (short window = 'past_2_weeks' preferred) ──────────────
    const { data: slaRows } = await supabase
      .from('state_sla_attainment')
      .select('state_abbreviation, sla_pct, window_label');

    // Prefer past_2_weeks, fall back to feb2026_current
    const slaByState = new Map<string, number>();
    for (const row of (slaRows ?? [])) {
      const existing = slaByState.get(row.state_abbreviation);
      // Overwrite with past_2_weeks if available; otherwise take first
      if (!existing || row.window_label === 'past_2_weeks') {
        slaByState.set(row.state_abbreviation, Number(row.sla_pct));
      }
    }

    // ── Load leftover slot data (historical preferred, forecast fallback) ────
    // Leftover visits = unfilled slots from the EMR/Metabase export.
    // These are used to infer actual demand (booked = supply - leftover).
    //
    // FALLBACK: If a (state, date) has no historical row (e.g. tomorrow, or
    // before today's Metabase ingest lands), use the forecast row instead so
    // the snapshot for that day isn't silently omitted. This mirrors what
    // OpsDashboard does when rendering coverage live.
    const { data: leftoverRows } = await supabase
      .from('state_leftover_slots')
      .select('state_abbreviation, slot_date, unfilled_slots, window_type')
      .gte('slot_date', windowStart)
      .lte('slot_date', windowEnd);

    // key = "state|date" → unfilled slots, preferring historical over forecast.
    const leftoverMap = new Map<string, number>();
    const leftoverSourceMap = new Map<string, 'historical' | 'forecast'>();
    for (const row of (leftoverRows ?? [])) {
      const key = `${row.state_abbreviation}|${row.slot_date}`;
      const isHistorical = row.window_type === 'historical';
      const existing = leftoverSourceMap.get(key);
      // Take historical if we don't have anything yet, or always overwrite
      // forecast with historical. Never downgrade historical → forecast.
      if (!existing || (isHistorical && existing === 'forecast')) {
        leftoverMap.set(key, Number(row.unfilled_slots));
        leftoverSourceMap.set(key, isHistorical ? 'historical' : 'forecast');
      }
    }

    // Per-state percentile thresholds for ANOMALY classification.
    // CORRECTNESS: Computing p25/p75 globally lets one outlier state (e.g.
    // CA having a 10× normal data day) shift the threshold for every other
    // state, masking real anomalies. Partition by state instead.
    const stateSlotValues = new Map<string, number[]>();
    for (const [key, val] of leftoverMap) {
      const [state] = key.split('|');
      if (!stateSlotValues.has(state)) stateSlotValues.set(state, []);
      stateSlotValues.get(state)!.push(val);
    }
    const statePercentiles = new Map<string, { p25: number; p75: number }>();
    for (const [state, values] of stateSlotValues) {
      const sorted = [...values].sort((a, b) => a - b);
      statePercentiles.set(state, { p25: percentile(sorted, 25), p75: percentile(sorted, 75) });
    }

    // ── Load demand_forecast (weekly projected_visits per state) ──────────────
    // Preferred demand signal. Stored as weekly projected_visits keyed by
    // (state, week_start). We convert to daily demand hours below.
    const { data: forecastRows } = await supabase
      .from('demand_forecast')
      .select('state_abbreviation, week_start, projected_visits')
      .gte('week_start', windowStart)
      .lte('week_start', windowEnd);

    // key = "state|week_start" → projected_visits (weekly)
    const forecastMap = new Map<string, number>();
    for (const row of (forecastRows ?? [])) {
      forecastMap.set(`${row.state_abbreviation}|${row.week_start}`, Number(row.projected_visits));
    }

    // ── Load provider_utilization actuals ─────────────────────────────────────
    // Per-provider avg_utilization_pct over a recent window. Used to scale
    // scheduled hours → effective (booked) hours so wasted-flag reflects reality.
    const { data: utilRows } = await supabase
      .from('provider_utilization')
      .select('profile_id, avg_utilization_pct, window_end')
      .not('profile_id', 'is', null)
      .order('window_end', { ascending: false });

    // Keep most-recent window per profile
    const utilByProfile = new Map<string, number>();
    for (const row of (utilRows ?? [])) {
      if (!utilByProfile.has(row.profile_id)) {
        utilByProfile.set(row.profile_id, Number(row.avg_utilization_pct));
      }
    }

    // ── Load provider active licenses ─────────────────────────────────────────
    const { data: licenseRows } = await supabase
      .from('provider_licenses')
      .select('profile_id, state_abbreviation, status')
      .not('profile_id', 'is', null);

    // profileId → { active: Set<state>, inactive: Set<state> }
    const licenseMap = new Map<string, { active: Set<string>; inactive: Set<string> }>();
    for (const lic of (licenseRows ?? [])) {
      if (!licenseMap.has(lic.profile_id)) {
        licenseMap.set(lic.profile_id, { active: new Set(), inactive: new Set() });
      }
      const entry = licenseMap.get(lic.profile_id)!;
      if (lic.status === 'active') {
        entry.active.add(lic.state_abbreviation);
      } else {
        entry.inactive.add(lic.state_abbreviation);
      }
    }

    // ── Load provider professions (to enforce MD-only state rules) ────────────
    const profileIds = [...licenseMap.keys()];
    const professionByProfile = new Map<string, string | null>();
    if (profileIds.length > 0) {
      const { data: profRows } = await supabase
        .from('profiles')
        .select('id, profession')
        .in('id', profileIds);
      for (const p of (profRows ?? [])) {
        professionByProfile.set(p.id, p.profession ?? null);
      }
    }

    // ── Load Homebase shifts in window ────────────────────────────────────────
    const { data: shiftRows } = await supabase
      .from('homebase_shifts')
      .select(`
        scheduled_hours,
        start_at,
        homebase_employee:homebase_employees!homebase_shifts_homebase_employee_id_fkey(profile_id)
      `)
      .gte('start_at', `${windowStart}T00:00:00Z`)
      .lte('start_at', `${windowEnd}T23:59:59Z`)
      .eq('scheduled', true)
      .not('scheduled_hours', 'is', null);

    // Aggregate hours: profileId|date → total hours
    const hoursMap = new Map<string, number>();
    for (const shift of (shiftRows ?? [])) {
      const profileId = (shift.homebase_employee as any)?.profile_id;
      if (!profileId) continue;
      const date = shift.start_at.slice(0, 10);
      const key = `${profileId}|${date}`;
      hoursMap.set(key, (hoursMap.get(key) ?? 0) + Number(shift.scheduled_hours));
    }

    // ── Even-split allocation: supply[state|date] ─────────────────────────────
    const supplyMap = new Map<string, number>(); // "state|date" → hours

    for (const [key, hours] of hoursMap) {
      const [profileId, date] = key.split('|');
      const licenses = licenseMap.get(profileId);
      if (!licenses) continue;
      const profession = professionByProfile.get(profileId) ?? null;

      // States this provider is actively licensed in AND which are operationally active
      const eligible = [...licenses.active]
        .filter(s => activeStates.has(s))
        .filter(s => canPracticeInState(profession, s));
      if (eligible.length === 0) continue;

      const perState = hours / eligible.length;
      for (const state of eligible) {
        const sk = `${state}|${date}`;
        supplyMap.set(sk, (supplyMap.get(sk) ?? 0) + perState);
      }
    }

    // ── Build snapshots ───────────────────────────────────────────────────────
    const snapshots: object[] = [];

    // We need snapshots per (provider, state, date) for the wasted-hours panel
    // and also per (state, date) for the heatmap.
    // Store both provider-level and aggregate.

    // First: per-provider-state-date snapshots
    for (const [key, hours] of hoursMap) {
      const [profileId, date] = key.split('|');
      const licenses = licenseMap.get(profileId);
      if (!licenses) continue;
      const profession = professionByProfile.get(profileId) ?? null;

      const eligible = [...licenses.active]
        .filter(s => activeStates.has(s))
        .filter(s => canPracticeInState(profession, s));
      if (eligible.length === 0) {
        // All provider hours going to zero-active states → fully wasted
        // We'll record one row with state='NONE' to represent this
        continue;
      }

      // Reconcile scheduled hours against actual utilization (when available).
      // utilPct of 70 means provider books ~70% of scheduled time → effective
      // supply = scheduled * 0.70. Falls back to 100% (raw scheduled) if missing.
      const utilPct = utilByProfile.get(profileId);
      const effectiveHours = utilPct !== undefined && utilPct > 0
        ? hours * (utilPct / 100)
        : hours;

      const perState = effectiveHours / eligible.length;
      const scheduledPerState = hours / eligible.length;

      for (const state of eligible) {
        const unfilled = leftoverMap.get(`${state}|${date}`) ?? null;
        const slaPct = slaByState.get(state) ?? null;
        const pct = statePercentiles.get(state) ?? { p25: 0, p75: 0 };
        // Find the Sunday of this date's week (forecast week_start convention).
        // demand_forecast.week_start is typically the Monday of the ISO week,
        // but our data shows YYYY-MM-DD aligned to the start; we match by
        // finding the most recent forecast row at or before this date.
        const forecastVisits = lookupWeeklyForecast(forecastMap, state, date);

        let estimatedDemandHours: number | null = null;
        let coverageRatio: number | null = null;
        let quadrant = 'UNKNOWN';
        let demandSource: 'forecast' | 'leftover_sla' | 'sla_only' | 'none' = 'none';

        // Tier A: demand_forecast (preferred)
        if (forecastVisits !== null && forecastVisits >= 0) {
          // weekly visits → daily visits → daily hours (1 visit = 1 slot = 1/SLOTS_PER_HOUR hr)
          estimatedDemandHours = (forecastVisits / 7) / SLOTS_PER_HOUR;
          coverageRatio = estimatedDemandHours > 0
            ? perState / estimatedDemandHours
            : (perState > 0 ? 999 : null);
          demandSource = 'forecast';
          quadrant = classifyQuadrant(slaPct ?? 100, unfilled ?? 0, pct.p25, pct.p75, coverageRatio);
        }
        // Tier B: leftover slots + SLA
        else if (unfilled !== null && slaPct !== null && slaPct > 0) {
          const supplySlots = perState * SLOTS_PER_HOUR;
          const bookedSlots = Math.max(0, supplySlots - unfilled);
          const demandSlots = bookedSlots / (slaPct / 100);
          estimatedDemandHours = demandSlots / SLOTS_PER_HOUR;
          coverageRatio = estimatedDemandHours > 0 ? perState / estimatedDemandHours : null;
          demandSource = 'leftover_sla';
          quadrant = classifyQuadrant(slaPct, unfilled, pct.p25, pct.p75, coverageRatio);
        }
        // Tier C: SLA-only heuristic
        else if (slaPct !== null) {
          // No slot data but have SLA
          quadrant = slaPct >= SLA_HIGH_THRESHOLD ? 'BALANCED' : slaPct < SLA_LOW_THRESHOLD ? 'DEFICIT' : 'BALANCED';
          demandSource = 'sla_only';
        }

        // Wasted: provider's hours going to a state that's SURPLUS (coverage >> 2x)
        const wasted = quadrant === 'SURPLUS' && (coverageRatio ?? 0) > 2;

        snapshots.push({
          snapshot_date: date,
          profile_id: profileId,
          state_abbreviation: state,
          provider_hours_total: Math.round(hours * 100) / 100,
          active_license_count: eligible.length,
          allocated_hours: Math.round(scheduledPerState * 100) / 100,
          unfilled_slots: unfilled,
          sla_pct: slaPct,
          estimated_demand_hours: estimatedDemandHours !== null
            ? Math.round(estimatedDemandHours * 100) / 100
            : null,
          coverage_ratio: coverageRatio !== null ? Math.round(coverageRatio * 1000) / 1000 : null,
          quadrant,
          wasted_flag: wasted,
        });
      }
    }

    // Upsert snapshots in batches of 500
    let snapshotsWritten = 0;
    for (let i = 0; i < snapshots.length; i += 500) {
      const batch = snapshots.slice(i, i + 500);
      const { error } = await supabase
        .from('license_optimization_snapshots')
        .upsert(batch, { onConflict: 'snapshot_date,profile_id,state_abbreviation' });
      if (error) throw new Error(`Snapshot upsert error: ${error.message}`);
      snapshotsWritten += batch.length;
    }

    // ── Build recommendations ─────────────────────────────────────────────────
    const recommendations = buildRecommendations(snapshots as any[], licenseMap, activeStates, hoursMap);

    await finalizeRun('success', {
      rows_processed: snapshotsWritten,
      details: {
        window: { start: windowStart, end: windowEnd },
        recommendations_count: recommendations.length,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      window: { start: windowStart, end: windowEnd },
      snapshots_written: snapshotsWritten,
      top_recommendations: recommendations.slice(0, 20),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeRun('error', { error_message: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * Find the projected_visits forecast for a given (state, date).
 * Forecast rows are weekly, keyed by week_start. We pick the most recent
 * week_start that is on or before the given date; if none, fall back to the
 * earliest available week (so future dates still match the latest forecast).
 */
function lookupWeeklyForecast(
  forecastMap: Map<string, number>,
  state: string,
  date: string,
): number | null {
  // Collect all week_starts for this state
  const stateWeeks: { week: string; visits: number }[] = [];
  for (const [key, visits] of forecastMap) {
    const [s, week] = key.split('|');
    if (s === state) stateWeeks.push({ week, visits });
  }
  if (stateWeeks.length === 0) return null;
  stateWeeks.sort((a, b) => a.week.localeCompare(b.week));

  // Most recent week_start <= date
  let chosen: number | null = null;
  for (const row of stateWeeks) {
    if (row.week <= date) chosen = row.visits;
    else break;
  }
  // Fallback: future date with no past forecast → use earliest
  if (chosen === null) chosen = stateWeeks[0].visits;
  return chosen;
}

function classifyQuadrant(
  slaPct: number,
  unfilled: number,
  p25: number,
  p75: number,
  coverageRatio: number | null
): string {
  const highSla = slaPct >= SLA_HIGH_THRESHOLD;
  const lowSla = slaPct < SLA_LOW_THRESHOLD;
  const highSlots = unfilled > p75;
  const lowSlots = unfilled < p25;

  if (highSla && highSlots) return 'SURPLUS';
  if (lowSla && lowSlots) return 'DEFICIT';
  if (lowSla && highSlots) return 'ANOMALY';
  if (coverageRatio !== null && coverageRatio >= COVERAGE_SURPLUS_THRESHOLD) return 'SURPLUS';
  if (coverageRatio !== null && coverageRatio < COVERAGE_DEFICIT_THRESHOLD) return 'DEFICIT';
  return 'BALANCED';
}

function buildRecommendations(
  snapshots: any[],
  licenseMap: Map<string, { active: Set<string>; inactive: Set<string> }>,
  activeStates: Set<string>,
  hoursMap: Map<string, number>
): object[] {
  const recs: { type: string; profile_id: string; state: string; impact_hours: number; rationale: string }[] = [];

  // Aggregate quadrant by state (majority vote across days)
  const stateQuadrantCounts = new Map<string, Record<string, number>>();
  for (const s of snapshots) {
    if (!stateQuadrantCounts.has(s.state_abbreviation)) {
      stateQuadrantCounts.set(s.state_abbreviation, {});
    }
    const counts = stateQuadrantCounts.get(s.state_abbreviation)!;
    counts[s.quadrant] = (counts[s.quadrant] ?? 0) + 1;
  }

  const stateQuadrant = new Map<string, string>();
  for (const [state, counts] of stateQuadrantCounts) {
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'BALANCED';
    stateQuadrant.set(state, dominant);
  }

  // Aggregate average daily provider hours
  const providerAvgHours = new Map<string, number>();
  const providerDayCounts = new Map<string, number>();
  for (const [key, hours] of hoursMap) {
    const profileId = key.split('|')[0];
    providerAvgHours.set(profileId, (providerAvgHours.get(profileId) ?? 0) + hours);
    providerDayCounts.set(profileId, (providerDayCounts.get(profileId) ?? 0) + 1);
  }
  for (const [pid, total] of providerAvgHours) {
    providerAvgHours.set(pid, total / (providerDayCounts.get(pid) ?? 1));
  }

  const deficitStates = [...stateQuadrant.entries()]
    .filter(([, q]) => q === 'DEFICIT')
    .map(([s]) => s);

  const surplusStates = [...stateQuadrant.entries()]
    .filter(([, q]) => q === 'SURPLUS')
    .map(([s]) => s);

  for (const [profileId, licenses] of licenseMap) {
    const avgHours = providerAvgHours.get(profileId) ?? 0;
    if (avgHours === 0) continue;
    const activeCount = [...licenses.active].filter(s => activeStates.has(s)).length;

    // ACTIVATE recommendations: inactive license in a deficit state
    for (const defState of deficitStates) {
      if (licenses.inactive.has(defState)) {
        const newCount = activeCount + 1;
        const impact = avgHours / newCount;
        recs.push({
          type: 'ACTIVATE',
          profile_id: profileId,
          state: defState,
          impact_hours: Math.round(impact * 100) / 100,
          rationale: `Activating license in ${defState} (DEFICIT) would route ~${impact.toFixed(1)} hrs/day there`,
        });
      }
    }

    // DEACTIVATE recommendations: active license in surplus, provider also licensed in deficit
    for (const surpState of surplusStates) {
      if (licenses.active.has(surpState) && activeCount > 1) {
        const deficitsProviderCovers = deficitStates.filter(d => licenses.active.has(d));
        if (deficitsProviderCovers.length > 0) {
          const gainPerDeficit = (avgHours / (activeCount - 1) - avgHours / activeCount);
          recs.push({
            type: 'DEACTIVATE',
            profile_id: profileId,
            state: surpState,
            impact_hours: Math.round(gainPerDeficit * 100) / 100,
            rationale: `Deactivating ${surpState} (SURPLUS) redistributes ~${gainPerDeficit.toFixed(1)} hrs/day to ${deficitsProviderCovers.join(', ')}`,
          });
        }
      }
    }
  }

  // Sort by impact descending
  return recs.sort((a, b) => b.impact_hours - a.impact_hours);
}
