/**
 * Deno-compatible copy of src/lib/scheduling/dailyCoverageRouting.ts.
 * Keep the two files in sync — the vitest suite tests the src/ copy.
 *
 * Same-day / next-day coverage routing allocator.
 *
 * Pure, deterministic engine shared by the `compute-daily-coverage-routing`
 * edge function (via the byte-identical copy in
 * `supabase/functions/_shared/dailyCoverageRouting.ts`) and the vitest suite.
 *
 * Unit of account is HOURS of provider availability. The caller assembles the
 * inputs (Homebase scheduled shifts, provider licensure, provider-state
 * active/EHR status, daily demand, booked appointments, Jotform availability)
 * and this function does the routing for a single calendar date.
 *
 * Routing order (mirrors the SOP):
 *   1. Lock booked appointments first. A matched + scheduled provider's booked
 *      appointments consume both their shift capacity AND the state's demand
 *      before any free capacity is routed. Unmatched booked rows are surfaced
 *      as data-quality warnings and are NOT locked to provider capacity.
 *   2. Allocate remaining CONFIRMED capacity greedily. Confirmed = the provider
 *      is scheduled, holds an active license, is scope-eligible for the state
 *      (MD-only state rule), and is active / EHR-live for that state.
 *   3. Compute TENTATIVE licensed-only upside separately. Tentative = scope/
 *      license eligible but not confirmed active/EHR-live. It never counts
 *      toward status — it is the headroom available if those provider-states
 *      were activated.
 *   4. Status is driven by CONFIRMED coverage only.
 */

export type RoutingStatus = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';

/** One booked appointment is assumed to be 0.5h unless Metabase supplies booked hours. */
export const SD_ND_BOOKED_APPOINTMENT_HOURS = 0.5;

/** States Vitable may only staff with physicians (NP scope restriction). */
export const MD_ONLY_STATES = new Set(['AL', 'IN', 'GA', 'MS', 'MO', 'SC', 'TN', 'LA']);

const PHYSICIAN_PROFESSIONS = new Set([
  'MD',
  'M_D',
  'DO',
  'D_O',
  'PHYSICIAN',
  'MEDICAL_DOCTOR',
  'DOCTOR_OF_OSTEOPATHY',
]);

const normProfession = (profession: string | null | undefined) =>
  (profession ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const isPhysicianProfession = (profession: string | null | undefined): boolean => {
  const norm = normProfession(profession);
  const tokens = norm.split('_');
  return (
    PHYSICIAN_PROFESSIONS.has(norm) ||
    tokens.includes('MD') ||
    tokens.includes('DO') ||
    tokens.includes('PHYSICIAN')
  );
};

/**
 * Same-day scope eligibility: any provider may cover a non-restricted state;
 * MD-only states may be covered by physicians only. This is intentionally the
 * "who can legally see a patient here today" rule, NOT the month-ahead
 * "reserve scarce MD capacity" policy used by the monthly evaluator.
 */
export const canCoverState = (profession: string | null | undefined, state: string): boolean => {
  const st = state.trim().toUpperCase();
  if (!MD_ONLY_STATES.has(st)) return true;
  return isPhysicianProfession(profession);
};

export type RoutingDemandInput = {
  state: string;
  /** null = no demand value available from any source → NO DATA */
  demand_hours: number | null;
  source: string;
};

export type RoutingProviderInput = {
  profile_id: string;
  name: string;
  profession: string | null;
  /** Total scheduled (Homebase) hours for this provider on this date. */
  scheduled_hours: number;
  /** States with an active license on file. */
  licensed_states: string[];
  /** States where the provider-state is active / EHR-live. */
  ehr_active_states: string[];
};

export type RoutingBookedInput = {
  /** Matched provider profile id, or null when the row could not be matched. */
  profile_id: string | null;
  provider_name: string;
  state: string;
  appointment_count: number;
  /** Metabase booked hours when present; otherwise null → estimate from count. */
  booked_hours: number | null;
};

export type RoutingUnmatchedShiftInput = {
  name: string;
  scheduled_hours: number;
};

export type RoutingAddCandidateInput = {
  profile_id: string;
  name: string;
  profession: string | null;
  /** Hours the provider indicated they are available (Jotform) or null. */
  available_hours: number | null;
  licensed_states: string[];
  ehr_active_states: string[];
  source: 'jotform_availability' | 'low_utilization';
  utilization_pct?: number | null;
};

export type RoutingInput = {
  date: string;
  demand: RoutingDemandInput[];
  providers: RoutingProviderInput[];
  booked: RoutingBookedInput[];
  unmatchedShifts?: RoutingUnmatchedShiftInput[];
  addCandidates?: RoutingAddCandidateInput[];
  bookedAppointmentHours?: number;
};

export type StateCoverageRow = {
  state: string;
  demand_hours: number | null;
  demand_source: string;
  booked_locked_hours: number;
  confirmed_assigned_hours: number;
  /** booked_locked + confirmed_assigned — the number that drives status. */
  confirmed_coverage_hours: number;
  tentative_upside_hours: number;
  coverage_ratio: number | null;
  gap_hours: number;
  status: RoutingStatus;
};

export type ProviderAssignmentRow = {
  profile_id: string;
  name: string;
  profession: string | null;
  scheduled_hours: number;
  booked_locked_hours: number;
  assignments: { state: string; hours: number }[];
  unassigned_free_hours: number;
};

export type BookedLockRow = {
  profile_id: string | null;
  provider_name: string;
  state: string;
  hours: number;
  source: 'metabase_booked_hours' | 'appointment_estimate';
  matched: boolean;
};

export type MoveRecommendation = {
  profile_id: string;
  name: string;
  state: string;
  hours: number;
};

export type AddRecommendation = {
  state: string;
  gap_hours: number;
  profile_id: string;
  name: string;
  profession: string | null;
  source: 'tentative_scheduled' | 'jotform_availability' | 'low_utilization';
  available_hours: number | null;
  /** true when the provider-state is not confirmed active/EHR-live. */
  tentative: boolean;
  utilization_pct: number | null;
};

export type DataQualityWarning = {
  type:
    | 'unmatched_booked_appointment'
    | 'unmatched_homebase_employee'
    | 'booked_without_demand';
  state: string | null;
  detail: string;
  hours: number;
};

export type RoutingTotals = {
  states_total: number;
  ok: number;
  low: number;
  critical: number;
  zero: number;
  no_data: number;
  demand_hours: number;
  booked_locked_hours: number;
  confirmed_assigned_hours: number;
  confirmed_coverage_hours: number;
  tentative_upside_hours: number;
  gap_hours: number;
  scheduled_providers: number;
  scheduled_hours: number;
  free_hours_remaining: number;
};

export type RoutingResult = {
  date: string;
  stateCoverage: StateCoverageRow[];
  providerAssignments: ProviderAssignmentRow[];
  bookedLocks: BookedLockRow[];
  moves: MoveRecommendation[];
  adds: AddRecommendation[];
  warnings: DataQualityWarning[];
  totals: RoutingTotals;
};

type WorkingProvider = {
  profile_id: string;
  name: string;
  profession: string | null;
  scheduled_hours: number;
  free: number;
  eligible: Set<string>;
  confirmed: Set<string>;
  booked_locked: number;
  assignments: Map<string, number>;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function routeDailyCoverage(input: RoutingInput): RoutingResult {
  const bookedApptHours = input.bookedAppointmentHours ?? SD_ND_BOOKED_APPOINTMENT_HOURS;
  const warnings: DataQualityWarning[] = [];

  // ── 1. Demand state ──────────────────────────────────────────────────────
  const demandOriginal = new Map<string, number>();
  const demandRemaining = new Map<string, number>();
  const demandSource = new Map<string, string>();
  const bookedLockedByState = new Map<string, number>();
  const confirmedAssignedByState = new Map<string, number>();
  const tentativeByState = new Map<string, number>();
  const noDataStates = new Set<string>();

  for (const d of input.demand) {
    const st = d.state.trim().toUpperCase();
    demandSource.set(st, d.source ?? 'none');
    if (d.demand_hours == null || !Number.isFinite(d.demand_hours)) {
      noDataStates.add(st);
      continue;
    }
    const hours = Math.max(0, d.demand_hours);
    demandOriginal.set(st, hours);
    demandRemaining.set(st, hours);
    bookedLockedByState.set(st, 0);
    confirmedAssignedByState.set(st, 0);
    tentativeByState.set(st, 0);
  }

  // ── 2. Provider working set ────────────────────────────────────────────────
  const providers = new Map<string, WorkingProvider>();
  for (const pi of input.providers) {
    const scheduled = Math.max(0, pi.scheduled_hours);
    const eligible = new Set<string>();
    for (const s of pi.licensed_states) {
      const st = s.trim().toUpperCase();
      if (canCoverState(pi.profession, st)) eligible.add(st);
    }
    const confirmed = new Set<string>();
    for (const s of pi.ehr_active_states) {
      const st = s.trim().toUpperCase();
      if (eligible.has(st)) confirmed.add(st);
    }
    // Merge duplicate Homebase rows for the same provider by summing hours.
    const existing = providers.get(pi.profile_id);
    if (existing) {
      existing.scheduled_hours = round2(existing.scheduled_hours + scheduled);
      existing.free = round2(existing.free + scheduled);
      for (const s of eligible) existing.eligible.add(s);
      for (const s of confirmed) existing.confirmed.add(s);
      continue;
    }
    providers.set(pi.profile_id, {
      profile_id: pi.profile_id,
      name: pi.name,
      profession: pi.profession,
      scheduled_hours: scheduled,
      free: scheduled,
      eligible,
      confirmed,
      booked_locked: 0,
      assignments: new Map(),
    });
  }

  for (const u of input.unmatchedShifts ?? []) {
    warnings.push({
      type: 'unmatched_homebase_employee',
      state: null,
      detail: `${u.name}: ${round2(u.scheduled_hours)}h scheduled in Homebase but not matched to a provider profile — excluded from confirmed capacity`,
      hours: round2(Math.max(0, u.scheduled_hours)),
    });
  }

  // ── 3. Lock booked appointments first ──────────────────────────────────────
  const bookedLocks: BookedLockRow[] = [];
  for (const b of input.booked) {
    const st = b.state.trim().toUpperCase();
    const hasBookedHours = b.booked_hours != null && Number.isFinite(b.booked_hours);
    const hours = round2(hasBookedHours ? (b.booked_hours as number) : b.appointment_count * bookedApptHours);
    const source: BookedLockRow['source'] = hasBookedHours ? 'metabase_booked_hours' : 'appointment_estimate';
    const provider = b.profile_id ? providers.get(b.profile_id) : undefined;

    if (!provider) {
      warnings.push({
        type: 'unmatched_booked_appointment',
        state: st,
        detail: `${b.provider_name} has ${b.appointment_count} booked appointment(s) in ${st} but is not matched to a scheduled provider — not locked to capacity`,
        hours,
      });
      bookedLocks.push({ profile_id: b.profile_id ?? null, provider_name: b.provider_name, state: st, hours, source, matched: false });
      continue;
    }

    provider.free = round2(Math.max(0, provider.free - hours));
    provider.booked_locked = round2(provider.booked_locked + hours);
    // A real booked appointment is the strongest possible signal that the
    // provider is live in that state today, so it counts as confirmed.
    provider.eligible.add(st);
    provider.confirmed.add(st);
    bookedLocks.push({ profile_id: provider.profile_id, provider_name: b.provider_name, state: st, hours, source, matched: true });

    if (demandRemaining.has(st)) {
      demandRemaining.set(st, round2(Math.max(0, (demandRemaining.get(st) ?? 0) - hours)));
      bookedLockedByState.set(st, round2((bookedLockedByState.get(st) ?? 0) + hours));
    } else {
      warnings.push({
        type: 'booked_without_demand',
        state: st,
        detail: `${b.provider_name} has a booked appointment in ${st} but no daily demand is tracked for that state`,
        hours,
      });
    }
  }

  // ── 4. Greedy confirmed free-capacity allocation ───────────────────────────
  // Providers with the fewest confirmed shortage states go first so a single-
  // state provider is not crowded out by a flexible one. The option count is
  // snapshotted from initial demand for a deterministic, stable ordering.
  const initialShortage = new Set(
    [...demandRemaining.entries()].filter(([, h]) => h > 0).map(([s]) => s),
  );
  const optionCount = new Map<string, number>();
  for (const p of providers.values()) {
    let c = 0;
    for (const s of p.confirmed) if (initialShortage.has(s)) c++;
    optionCount.set(p.profile_id, c);
  }
  const orderedProviders = [...providers.values()].sort((a, b) => {
    const ca = optionCount.get(a.profile_id) ?? 0;
    const cb = optionCount.get(b.profile_id) ?? 0;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name) || a.profile_id.localeCompare(b.profile_id);
  });

  for (const p of orderedProviders) {
    if (p.free <= 0) continue;
    const confirmedSorted = [...p.confirmed].sort();
    // Fill the largest-gap confirmed state first, then the next, until the
    // provider's free hours run out or there is no remaining confirmed gap.
    while (p.free > 0) {
      let bestState: string | null = null;
      let bestGap = 0;
      for (const s of confirmedSorted) {
        const rem = demandRemaining.get(s) ?? 0;
        if (rem > bestGap) {
          bestGap = rem;
          bestState = s;
        }
      }
      if (!bestState || bestGap <= 0) break;
      const take = round2(Math.min(p.free, bestGap));
      if (take <= 0) break;
      p.free = round2(p.free - take);
      p.assignments.set(bestState, round2((p.assignments.get(bestState) ?? 0) + take));
      demandRemaining.set(bestState, round2(Math.max(0, bestGap - take)));
      confirmedAssignedByState.set(bestState, round2((confirmedAssignedByState.get(bestState) ?? 0) + take));
    }
  }

  // ── 5. Tentative licensed-only upside (does not affect status) ──────────────
  const tentativeRawByState = new Map<string, number>();
  const tentativeProvidersByState = new Map<
    string,
    { profile_id: string; name: string; profession: string | null; free: number }[]
  >();
  for (const p of providers.values()) {
    if (p.free <= 0) continue;
    for (const s of p.eligible) {
      if (p.confirmed.has(s)) continue;
      if (!demandRemaining.has(s)) continue;
      if ((demandRemaining.get(s) ?? 0) <= 0) continue;
      tentativeRawByState.set(s, round2((tentativeRawByState.get(s) ?? 0) + p.free));
      if (!tentativeProvidersByState.has(s)) tentativeProvidersByState.set(s, []);
      tentativeProvidersByState.get(s)!.push({ profile_id: p.profile_id, name: p.name, profession: p.profession, free: p.free });
    }
  }
  for (const [s, raw] of tentativeRawByState) {
    const rem = demandRemaining.get(s) ?? 0;
    tentativeByState.set(s, round2(Math.min(raw, rem)));
  }

  // ── 6. State coverage rows + status ─────────────────────────────────────────
  const stateCoverage: StateCoverageRow[] = [];
  const allStates = new Set<string>([...demandOriginal.keys(), ...noDataStates]);
  for (const st of [...allStates].sort()) {
    if (!demandOriginal.has(st)) {
      stateCoverage.push({
        state: st,
        demand_hours: null,
        demand_source: demandSource.get(st) ?? 'none',
        booked_locked_hours: 0,
        confirmed_assigned_hours: 0,
        confirmed_coverage_hours: 0,
        tentative_upside_hours: 0,
        coverage_ratio: null,
        gap_hours: 0,
        status: 'no_data',
      });
      continue;
    }
    const demand = demandOriginal.get(st) as number;
    const booked = round2(bookedLockedByState.get(st) ?? 0);
    const assigned = round2(confirmedAssignedByState.get(st) ?? 0);
    const confirmed = round2(booked + assigned);
    const tentative = round2(tentativeByState.get(st) ?? 0);
    const ratio = demand > 0 ? round2(confirmed / demand) : confirmed > 0 ? 999 : null;
    const gap = round2(Math.max(0, demand - confirmed));

    let status: RoutingStatus;
    if (demand <= 0) {
      status = 'ok';
    } else if (confirmed <= 0) {
      status = 'zero';
    } else if (confirmed / demand < 0.5) {
      status = 'critical';
    } else if (confirmed / demand < 1) {
      status = 'low';
    } else {
      status = 'ok';
    }

    stateCoverage.push({
      state: st,
      demand_hours: demand,
      demand_source: demandSource.get(st) ?? 'none',
      booked_locked_hours: booked,
      confirmed_assigned_hours: assigned,
      confirmed_coverage_hours: confirmed,
      tentative_upside_hours: tentative,
      coverage_ratio: ratio,
      gap_hours: gap,
      status,
    });
  }

  // ── 7. Provider assignment rows ─────────────────────────────────────────────
  const providerAssignments: ProviderAssignmentRow[] = [...providers.values()]
    .map((p) => ({
      profile_id: p.profile_id,
      name: p.name,
      profession: p.profession,
      scheduled_hours: round2(p.scheduled_hours),
      booked_locked_hours: round2(p.booked_locked),
      assignments: [...p.assignments.entries()]
        .filter(([, h]) => h > 0)
        .map(([state, hours]) => ({ state, hours: round2(hours) }))
        .sort((a, b) => a.state.localeCompare(b.state)),
      unassigned_free_hours: round2(p.free),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.profile_id.localeCompare(b.profile_id));

  // ── 8. Recommendations ──────────────────────────────────────────────────────
  const moves: MoveRecommendation[] = [];
  for (const p of providers.values()) {
    for (const [state, hours] of p.assignments.entries()) {
      if (hours > 0) moves.push({ profile_id: p.profile_id, name: p.name, state, hours: round2(hours) });
    }
  }
  moves.sort(
    (a, b) => a.state.localeCompare(b.state) || b.hours - a.hours || a.name.localeCompare(b.name),
  );

  const adds: AddRecommendation[] = [];
  for (const row of stateCoverage) {
    if (row.demand_hours == null || row.gap_hours <= 0) continue;
    const st = row.state;
    const tps = (tentativeProvidersByState.get(st) ?? [])
      .slice()
      .sort((a, b) => b.free - a.free || a.name.localeCompare(b.name));
    for (const tp of tps) {
      adds.push({
        state: st,
        gap_hours: row.gap_hours,
        profile_id: tp.profile_id,
        name: tp.name,
        profession: tp.profession,
        source: 'tentative_scheduled',
        available_hours: round2(tp.free),
        tentative: true,
        utilization_pct: null,
      });
    }
    for (const c of input.addCandidates ?? []) {
      if (providers.has(c.profile_id)) continue; // already scheduled today
      const licensedHere = c.licensed_states.some((s) => s.trim().toUpperCase() === st);
      if (!licensedHere || !canCoverState(c.profession, st)) continue;
      const confirmedHere = c.ehr_active_states.some((s) => s.trim().toUpperCase() === st);
      adds.push({
        state: st,
        gap_hours: row.gap_hours,
        profile_id: c.profile_id,
        name: c.name,
        profession: c.profession,
        source: c.source,
        available_hours: c.available_hours != null ? round2(c.available_hours) : null,
        tentative: !confirmedHere,
        utilization_pct: c.utilization_pct ?? null,
      });
    }
  }
  adds.sort((a, b) => {
    if (a.state !== b.state) return a.state.localeCompare(b.state);
    // tentative scheduled first, then jotform, then low utilization
    const order = (s: string) => (s === 'tentative_scheduled' ? 0 : s === 'jotform_availability' ? 1 : 2);
    if (order(a.source) !== order(b.source)) return order(a.source) - order(b.source);
    return (b.available_hours ?? 0) - (a.available_hours ?? 0) || a.name.localeCompare(b.name);
  });

  // ── 9. Totals ───────────────────────────────────────────────────────────────
  const sum = (arr: number[]) => round2(arr.reduce((s, n) => s + n, 0));
  const realStates = stateCoverage.filter((r) => r.demand_hours != null);
  const totals: RoutingTotals = {
    states_total: stateCoverage.length,
    ok: stateCoverage.filter((r) => r.status === 'ok').length,
    low: stateCoverage.filter((r) => r.status === 'low').length,
    critical: stateCoverage.filter((r) => r.status === 'critical').length,
    zero: stateCoverage.filter((r) => r.status === 'zero').length,
    no_data: stateCoverage.filter((r) => r.status === 'no_data').length,
    demand_hours: sum(realStates.map((r) => r.demand_hours as number)),
    booked_locked_hours: sum(realStates.map((r) => r.booked_locked_hours)),
    confirmed_assigned_hours: sum(realStates.map((r) => r.confirmed_assigned_hours)),
    confirmed_coverage_hours: sum(realStates.map((r) => r.confirmed_coverage_hours)),
    tentative_upside_hours: sum(realStates.map((r) => r.tentative_upside_hours)),
    gap_hours: sum(realStates.map((r) => r.gap_hours)),
    scheduled_providers: providers.size,
    scheduled_hours: sum([...providers.values()].map((p) => p.scheduled_hours)),
    free_hours_remaining: sum([...providers.values()].map((p) => p.free)),
  };

  return {
    date: input.date,
    stateCoverage,
    providerAssignments,
    bookedLocks,
    moves,
    adds,
    warnings,
    totals,
  };
}
