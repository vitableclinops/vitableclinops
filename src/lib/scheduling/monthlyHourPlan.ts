/**
 * Monthly per-provider hour plan (tier model).
 *
 * Starting with October 2026, ClinOps allocates provider hours from a tiered
 * plan sheet rather than letting the equity allocator distribute freely:
 *
 *   Tier 1 - Core            guaranteed hours, held at each provider's stated
 *                            weekly minimum (or the highest their date
 *                            restrictions allow)
 *   Tier 1 - Clinical Admin  salaried leads, fixed admin hours
 *   Tier 1 - Other           guaranteed hours outside the core pod
 *   Tier 2                   performance-weighted hours (July fill rate)
 *   Tier 3 (ad hoc pool)     not guaranteed; small pooled allocation
 *
 * The plan target for each provider is a HARD CAP, and the stated survey
 * min/max per week are HARD BOUNDS: allocation never exceeds
 * `maxHoursPerWeek * WEEKS_PER_MONTH`, and never lands below
 * `minHoursPerWeek * WEEKS_PER_MONTH` unless the plan target or the
 * provider's own submitted availability is lower (which the plan notes flag).
 *
 * Source: "October Hours Allocation - Corrected.xlsx" +
 *         "October Schedule Availability Survey Responses.xlsx" (Sep 2026).
 */

import { canonicalName } from '@/lib/nameNormalization';

export const WEEKS_PER_MONTH = 4.33;

export type MonthlyHourPlanTier =
  | 'Tier 1 - Core'
  | 'Tier 1 - Clinical Admin'
  | 'Tier 1 - Other'
  | 'Tier 2'
  | 'Tier 3 (ad hoc pool)';

export type MonthlyHourPlanEntry = {
  name: string;
  tier: MonthlyHourPlanTier;
  /** 'NP' | 'MD' | 'NP - DS' (DirectShifts) | 'CONFIRM' (designation unverified) */
  designation: string;
  /** Stated survey minimum hours per week, null when the provider did not respond. */
  minHoursPerWeek: number | null;
  /** Stated survey maximum hours per week, null when the provider did not respond. */
  maxHoursPerWeek: number | null;
  /** Planned October hours for this provider. */
  targetHours: number;
  notes: string;
};

export type MonthlyHourPlan = {
  month: string;
  totalTargetHours: number;
  policyVersion: string;
  entries: MonthlyHourPlanEntry[];
};

const OCTOBER_2026_ENTRIES: MonthlyHourPlanEntry[] = [
  { name: 'Mandy Clement', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 30, maxHoursPerWeek: 35, targetHours: 130, notes: 'At stated min. No vacation reported' },
  { name: 'Rachel McLeod', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 30, maxHoursPerWeek: 35, targetHours: 130, notes: 'At stated min. No Fridays; Oct 19 off' },
  { name: 'Jonathan Luker', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 30, maxHoursPerWeek: 40, targetHours: 125, notes: 'Slightly below stated min - date restrictions cap here. NJ license pending' },
  { name: 'Antonia Jackson', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 28, maxHoursPerWeek: 33, targetHours: 121, notes: 'At stated min. 10/9 off; PA license renewal 10/31 (no practice impact)' },
  { name: 'Andrea Leffet', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 30, maxHoursPerWeek: 40, targetHours: 105, notes: '~11 days unavailable in Oct. NJ license pending' },
  { name: 'Lisa Brittmon', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 24, maxHoursPerWeek: 28, targetHours: 104, notes: 'At stated min. No Sun/Wed; CA license pending' },
  { name: 'Melissa Harris Perotti', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 18, maxHoursPerWeek: 24, targetHours: 78, notes: 'Moved from Tier 2. At stated min 18/wk x 4.33' },
  { name: 'Shannon Greco', tier: 'Tier 1 - Core', designation: 'NP', minHoursPerWeek: 8, maxHoursPerWeek: 15, targetHours: 33, notes: 'Reduced from 50. 10/wk x 3.3 wks. Unavailable Oct 1-8' },

  { name: 'Genevieve Teetie', tier: 'Tier 1 - Clinical Admin', designation: 'NP', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 32, notes: 'Salaried (Rippling)' },
  { name: 'Rebecca Keuch', tier: 'Tier 1 - Clinical Admin', designation: 'NP', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 32, notes: 'Salaried (Rippling)' },
  { name: 'Shanta Williams', tier: 'Tier 1 - Clinical Admin', designation: 'NP', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 24, notes: 'Salaried (Rippling)' },

  { name: 'Van Tu', tier: 'Tier 1 - Other', designation: 'NP', minHoursPerWeek: 30, maxHoursPerWeek: 40, targetHours: 130, notes: 'At stated min. Thursdays off' },
  { name: 'Kimberly Truong', tier: 'Tier 1 - Other', designation: 'MD', minHoursPerWeek: 15, maxHoursPerWeek: 15, targetHours: 65, notes: "Mon/Wed only. Confirmed returning from leave in October; directory status still 'On Leave'" },
  { name: 'Jarrod Nero', tier: 'Tier 1 - Other', designation: 'NP - DS', minHoursPerWeek: 12, maxHoursPerWeek: 20, targetHours: 52, notes: 'At stated min. DirectShifts' },
  { name: 'Risheet Patel', tier: 'Tier 1 - Other', designation: 'MD', minHoursPerWeek: 10, maxHoursPerWeek: 20, targetHours: 43, notes: 'At stated min. Schedule varies week to week' },
  { name: 'Andrea Shepherd', tier: 'Tier 1 - Other', designation: 'NP', minHoursPerWeek: 10, maxHoursPerWeek: 10, targetHours: 43, notes: 'Newly licensed DE DC WA OK VT CT; NC & AZ pending' },

  { name: 'Desire Brown', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 48, notes: '72% July fill - strong performer' },
  { name: 'Sara Hammond', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 47, notes: '' },
  { name: 'Nicole Shiko', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 44, notes: '69% July fill - strong performer' },
  { name: 'Steve Rutagarama', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 43, notes: '' },
  { name: 'Brittney Afram', tier: 'Tier 2', designation: 'NP - DS', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 40, notes: '74% July fill' },
  { name: 'Teika Takedai', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 37, notes: '' },
  { name: 'Khanh Hoang Tran', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 25, notes: 'Reduced from 43. 27% July fill. Raise mid-month if routing diagnosis resolves' },
  { name: 'Shadae McMillan', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 25, notes: 'Reduced from 40, held at 25/mo floor. Has PA license but no collab physician assigned' },
  { name: 'Daniyel Barton', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 24, notes: '' },
  { name: 'Ramon Taguba Trinidad', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 23, notes: '' },
  { name: 'Gina Charles', tier: 'Tier 2', designation: 'MD', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 21, notes: '' },
  { name: 'Rickeena Free', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 21, notes: '' },
  { name: 'Kelsie Hardy', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 20, notes: '' },
  { name: 'Tylene Williams', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 9, notes: '' },
  { name: 'Bee Chang', tier: 'Tier 2', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 0, notes: 'Offboarded' },

  { name: 'Stephanie Lumsden', tier: 'Tier 3 (ad hoc pool)', designation: 'NP - DS', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 0, notes: 'Offboarded' },
  { name: 'Anabel Garcia Gomez', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 11, notes: 'Not guaranteed hours' },
  { name: 'Jacqueline Veress', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 11, notes: 'Not guaranteed hours' },
  { name: 'Nora Lueth', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 11, notes: 'Not guaranteed hours' },
  { name: 'Moensania Phillips', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 11, notes: 'Not guaranteed hours' },
  { name: 'Elizabeth Davis', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 11, notes: 'Not guaranteed hours' },
  { name: 'Akosua Norgbey', tier: 'Tier 3 (ad hoc pool)', designation: 'NP - DS', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 11, notes: 'Not guaranteed hours. DirectShifts' },
  { name: 'Whitney Gibbs', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 10, notes: 'Not guaranteed hours. Flagged for review' },
  { name: 'Matia Kilgore', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 0, notes: 'Offboarded' },
  { name: 'Laura Maleknia', tier: 'Tier 3 (ad hoc pool)', designation: 'CONFIRM', minHoursPerWeek: null, maxHoursPerWeek: null, targetHours: 0, notes: 'Offboarded' },
];

export const OCTOBER_2026_HOUR_PLAN: MonthlyHourPlan = {
  month: '2026-10-01',
  totalTargetHours: 1765,
  policyVersion: 'tier_model_2026_10',
  entries: OCTOBER_2026_ENTRIES,
};

const PLANS_BY_MONTH = new Map<string, MonthlyHourPlan>([
  [OCTOBER_2026_HOUR_PLAN.month, OCTOBER_2026_HOUR_PLAN],
]);

const normalizeMonth = (month: string) =>
  month.length === 7 ? `${month}-01` : month.slice(0, 10);

export function monthlyHourPlanFor(month: string | null | undefined): MonthlyHourPlan | null {
  if (!month) return null;
  return PLANS_BY_MONTH.get(normalizeMonth(month)) ?? null;
}

const entryIndexCache = new WeakMap<MonthlyHourPlan, Map<string, MonthlyHourPlanEntry>>();

function entryIndex(plan: MonthlyHourPlan): Map<string, MonthlyHourPlanEntry> {
  let idx = entryIndexCache.get(plan);
  if (!idx) {
    idx = new Map();
    for (const entry of plan.entries) idx.set(canonicalName(entry.name), entry);
    entryIndexCache.set(plan, idx);
  }
  return idx;
}

export function planEntryFor(
  plan: MonthlyHourPlan | null,
  providerName: string | null | undefined,
): MonthlyHourPlanEntry | null {
  if (!plan || !providerName) return null;
  return entryIndex(plan).get(canonicalName(providerName)) ?? null;
}

// ── Clamping ────────────────────────────────────────────────────────────

export type PlanStateAllocation = { state: string; hours: number };

export type PlanClampInput = {
  /** Hours the provider actually made available (post-validation). */
  effectiveHours: number;
  /** Hours the equity allocator wanted to accept. */
  allocatedHours: number;
  /** Per-state split the equity allocator produced. */
  allocations: PlanStateAllocation[];
  /** Remaining demand gap per eligible state, used when raising to a floor. */
  stateGaps?: Array<{ state: string; gapHours: number }>;
};

export type PlanClampResult = {
  acceptedHours: number;
  allocations: PlanStateAllocation[];
  capHours: number;
  floorHours: number;
  adjustment: 'none' | 'capped' | 'raised';
  flags: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundQuarter = (n: number) => Math.round(n * 4) / 4;

/**
 * Plan caps are SOFT: when demand remains and the provider actually submitted
 * the hours, we allow the allocator to exceed the plan target by up to this
 * multiplier. Hard ceilings still apply (submitted hours, state demand).
 */
export const PLAN_SOFT_CAP_MULTIPLIER = 1.25;

/** Snap to the 0.25h scheduling grid without ever crossing the ceiling. */
const quantizeToQuarter = (value: number, cap: number) => {
  const q = roundQuarter(value);
  if (q > cap) return Math.max(0, Math.floor(cap * 4) / 4);
  return Math.max(0, q);
};


export function monthlyCapFor(entry: MonthlyHourPlanEntry): number {
  const surveyMax = entry.maxHoursPerWeek == null
    ? Number.POSITIVE_INFINITY
    : entry.maxHoursPerWeek * WEEKS_PER_MONTH;
  return round2(Math.min(entry.targetHours, surveyMax));
}

export function monthlyFloorFor(entry: MonthlyHourPlanEntry): number {
  if (entry.minHoursPerWeek == null) return 0;
  return round2(entry.minHoursPerWeek * WEEKS_PER_MONTH);
}

/**
 * Clamp an equity-allocator result to the provider's plan row.
 * The cap is hard; the floor is applied only up to the cap and the hours the
 * provider actually submitted, and any shortfall is flagged rather than
 * silently invented.
 */
export function clampToHourPlan(
  entry: MonthlyHourPlanEntry,
  input: PlanClampInput,
): PlanClampResult {
  const flags: string[] = [];
  const cap = monthlyCapFor(entry);
  const statedFloor = monthlyFloorFor(entry);

  if (entry.maxHoursPerWeek != null && entry.targetHours > entry.maxHoursPerWeek * WEEKS_PER_MONTH) {
    flags.push('plan_target_above_survey_max');
  }
  if (statedFloor > 0 && entry.targetHours < statedFloor) {
    flags.push('plan_target_below_survey_min');
  }

  const submitted = Math.max(0, round2(input.effectiveHours));
  const effectiveCap = round2(Math.min(cap, submitted));
  if (statedFloor > 0 && submitted < statedFloor) {
    flags.push('submitted_below_survey_min');
  }

  const floor = round2(Math.min(statedFloor, effectiveCap));
  const before = round2(Math.max(0, input.allocatedHours));
  let accepted = before;
  if (accepted > effectiveCap) accepted = effectiveCap;
  if (accepted < floor) accepted = floor;
  accepted = quantizeToQuarter(Math.max(0, accepted), effectiveCap);

  let adjustment: PlanClampResult['adjustment'] = 'none';
  if (accepted < before - 0.001) adjustment = 'capped';
  else if (accepted > before + 0.001) adjustment = 'raised';

  return {
    acceptedHours: accepted,
    allocations: rebalanceAllocations(input.allocations, accepted, input.stateGaps ?? []),
    capHours: effectiveCap,
    floorHours: floor,
    adjustment,
    flags,
  };
}

/** Scale a per-state allocation list to a new total, respecting remaining demand. */
export function rebalanceAllocations(
  allocations: PlanStateAllocation[],
  targetTotal: number,
  stateGaps: Array<{ state: string; gapHours: number }>,
): PlanStateAllocation[] {
  const target = roundQuarter(Math.max(0, targetTotal));
  if (target <= 0) return [];

  const current = allocations.filter(a => a.hours > 0);
  const currentTotal = round2(current.reduce((s, a) => s + a.hours, 0));

  if (currentTotal <= 0) {
    // Nothing allocated yet — place hours into the states with the most room.
    const ordered = [...stateGaps].sort((a, b) => b.gapHours - a.gapHours);
    return distribute(ordered.map(g => ({ state: g.state, room: g.gapHours })), target);
  }

  if (Math.abs(currentTotal - target) < 0.01) {
    return current.map(a => ({ state: a.state, hours: roundQuarter(a.hours) }));
  }

  if (target < currentTotal) {
    const factor = target / currentTotal;
    const scaled = current.map(a => ({ state: a.state, hours: roundQuarter(a.hours * factor) }));
    return settleRounding(scaled, target);
  }

  // Raising: fill remaining room per state, largest room first.
  const allocatedByState = new Map(current.map(a => [a.state, a.hours]));
  const rooms = [...stateGaps]
    .map(g => ({ state: g.state, room: Math.max(0, g.gapHours - (allocatedByState.get(g.state) ?? 0)) }))
    .sort((a, b) => b.room - a.room);
  const extra = round2(target - currentTotal);
  const added = distribute(rooms, extra, current[0]?.state);
  const merged = new Map(current.map(a => [a.state, a.hours]));
  for (const a of added) merged.set(a.state, round2((merged.get(a.state) ?? 0) + a.hours));
  const out = Array.from(merged, ([state, hours]) => ({ state, hours: roundQuarter(hours) }));
  return settleRounding(out, target);
}

function distribute(
  rooms: Array<{ state: string; room: number }>,
  amount: number,
  fallbackState?: string,
): PlanStateAllocation[] {
  let left = amount;
  const out: PlanStateAllocation[] = [];
  for (const r of rooms) {
    if (left <= 0.001) break;
    const give = Math.min(left, r.room);
    if (give <= 0.001) continue;
    out.push({ state: r.state, hours: roundQuarter(give) });
    left = round2(left - give);
  }
  if (left > 0.001) {
    const state = fallbackState ?? rooms[0]?.state;
    if (state) out.push({ state, hours: roundQuarter(left) });
  }
  return out;
}

function settleRounding(rows: PlanStateAllocation[], target: number): PlanStateAllocation[] {
  const kept = rows.filter(r => r.hours > 0);
  if (kept.length === 0) return [];
  const total = round2(kept.reduce((s, r) => s + r.hours, 0));
  const delta = roundQuarter(target - total);
  if (Math.abs(delta) >= 0.25) {
    kept.sort((a, b) => b.hours - a.hours);
    kept[0].hours = roundQuarter(Math.max(0, kept[0].hours + delta));
  }
  return kept.filter(r => r.hours > 0);
}
