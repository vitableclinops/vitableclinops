export type CoverageStatus = 'Covered' | 'Watch' | 'Gap' | 'Critical';

export type CoverageDemandInput = {
  state: string | null;
  monthly_hours_target: number | string | null;
};

export type CoverageShiftInput = {
  assigned_state: string | null;
  hours: number | string | null;
  shift_type?: string | null;
  provider_name?: string | null;
};

export type CoverageProviderInput = {
  id: string;
  name?: string | null;
  profession?: string | null;
  active?: boolean | null;
};

export type CoverageLicenseInput = {
  provider_id: string | null;
  state: string | null;
  status: string | null;
};

export type CoverageSubmissionInput = {
  provider_id: string | null;
  decision_status: string | null;
};

export type StateCoverageComputedRow = {
  state: string;
  needed: number;
  filled: number;
  leftover: number;
  pct_filled: number;
  eligible_providers: number;
  missing_providers: number;
  status: CoverageStatus;
};

export type InHomeProviderHours = {
  provider_name: string;
  hours: number;
  shifts: number;
};

export type CoverageComputationResult = {
  rows: StateCoverageComputedRow[];
  inHomeHours: number;
  inHomeBreakdown: InHomeProviderHours[];
  otherUnassignedHours: number;
};

const VALID_LICENSE_STATUSES = new Set(['active', 'verified', 'pending_renewal']);
const MD_ONLY_STATES = new Set(['AL', 'IN', 'GA', 'MS', 'MO', 'SC', 'TN', 'LA']);
const MD_PROFESSIONS = new Set(['MD', 'DO', 'PHYSICIAN']);
const MH_PROFESSIONS = new Set([
  'MENTAL_HEALTH_COACH',
  'MH_COACH',
  'LPC',
  'THERAPIST',
  'HEALTH_COACH',
]);

const normProfession = (profession: string | null | undefined) =>
  (profession ?? '').trim().toUpperCase().replace(/\s+/g, '_');

export const isMentalHealthProfession = (profession: string | null | undefined) =>
  MH_PROFESSIONS.has(normProfession(profession));

export const isEligibleForState = (
  provider: Pick<CoverageProviderInput, 'profession'>,
  state: string,
) => {
  const profession = normProfession(provider.profession);
  if (MD_ONLY_STATES.has(state) && !MD_PROFESSIONS.has(profession)) return false;
  return true;
};

export function coverageStatusFor(pct: number): CoverageStatus {
  if (pct >= 95) return 'Covered';
  if (pct >= 80) return 'Watch';
  if (pct >= 60) return 'Gap';
  return 'Critical';
}

export function computeStateCoverage(input: {
  targets: CoverageDemandInput[];
  shifts: CoverageShiftInput[];
  providers: CoverageProviderInput[];
  licenses: CoverageLicenseInput[];
  submissions: CoverageSubmissionInput[];
}): CoverageComputationResult {
  const providersById = new Map(input.providers.map(p => [p.id, p]));
  const submittedProviderIds = new Set(
    input.submissions
      .filter(s => s.provider_id && s.decision_status !== 'superseded')
      .map(s => s.provider_id as string),
  );

  const needed = new Map<string, number>();
  for (const t of input.targets) {
    const state = String(t.state ?? '').trim().toUpperCase();
    if (!state) continue;
    needed.set(state, Number(t.monthly_hours_target ?? 0));
  }

  const filled = new Map<string, number>();
  let inHomeHours = 0;
  let otherUnassignedHours = 0;
  const inHomeByProvider = new Map<string, { hours: number; shifts: number }>();

  for (const s of input.shifts) {
    const hrs = Number(s.hours ?? 0);
    if (!Number.isFinite(hrs) || hrs <= 0) continue;
    const state = String(s.assigned_state ?? '').trim().toUpperCase();
    const isInHome = s.shift_type === 'in_home_clinic';

    if (isInHome) {
      inHomeHours += hrs;
      const key = s.provider_name ?? 'Unknown';
      const cur = inHomeByProvider.get(key) ?? { hours: 0, shifts: 0 };
      cur.hours += hrs;
      cur.shifts += 1;
      inHomeByProvider.set(key, cur);
    }

    if (state) {
      filled.set(state, (filled.get(state) ?? 0) + hrs);
    } else if (!isInHome) {
      otherUnassignedHours += hrs;
    }
  }

  const eligibleByState = new Map<string, Set<string>>();
  const missingByState = new Map<string, Set<string>>();
  for (const license of input.licenses) {
    const providerId = license.provider_id;
    const state = String(license.state ?? '').trim().toUpperCase();
    if (!providerId || !state) continue;
    if (license.status && !VALID_LICENSE_STATUSES.has(license.status)) continue;
    const provider = providersById.get(providerId);
    if (!provider || provider.active !== true) continue;
    if (isMentalHealthProfession(provider.profession)) continue;
    if (!isEligibleForState(provider, state)) continue;

    if (!eligibleByState.has(state)) eligibleByState.set(state, new Set());
    eligibleByState.get(state)!.add(providerId);
    if (!submittedProviderIds.has(providerId)) {
      if (!missingByState.has(state)) missingByState.set(state, new Set());
      missingByState.get(state)!.add(providerId);
    }
  }

  const allStates = new Set<string>([
    ...needed.keys(),
    ...filled.keys(),
    ...eligibleByState.keys(),
  ]);

  const rows = Array.from(allStates).map(state => {
    const need = needed.get(state) ?? 0;
    const fill = filled.get(state) ?? 0;
    const pct = need > 0 ? Math.min(999, (fill / need) * 100) : fill > 0 ? 999 : 0;
    return {
      state,
      needed: need,
      filled: fill,
      leftover: need - fill,
      pct_filled: pct,
      eligible_providers: eligibleByState.get(state)?.size ?? 0,
      missing_providers: missingByState.get(state)?.size ?? 0,
      status: coverageStatusFor(pct),
    };
  });

  rows.sort((a, b) => a.state.localeCompare(b.state));

  return {
    rows,
    inHomeHours,
    inHomeBreakdown: Array.from(inHomeByProvider.entries())
      .map(([provider_name, v]) => ({ provider_name, hours: v.hours, shifts: v.shifts }))
      .sort((a, b) => b.hours - a.hours),
    otherUnassignedHours,
  };
}
