import { mentalHealthServiceLineForProvider } from './mentalHealth';

export const COST_VISIT_SLOTS_PER_HOUR = 2;
export const COST_MH_VISIT_BLOCK_HOURS = 2.5;
export const COST_MH_VISITS_PER_BLOCK = 3;
export const COST_MH_VISIT_SLOTS_PER_HOUR =
  COST_MH_VISITS_PER_BLOCK / COST_MH_VISIT_BLOCK_HOURS;
export const COST_VISIT_TARGET_UTILIZATION = 0.7;

export type ProviderPayRateLike = {
  provider_id: string | null;
  hourly_rate: number | string | null;
  role?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  source?: string | null;
};

export type SchedulingCostInputRow = {
  provider_id: string;
  provider_name: string;
  profession?: string | null;
  employment_type?: string | null;
  provider_source?: string | null;
  decision_status?: string | null;
  accepted_hours?: number | string | null;
  declined_hours?: number | string | null;
  decision_notes?: string | null;
};

export type SchedulingCostRateSource = 'decision_note' | 'provider_pay_rates' | 'missing';

export type SchedulingCostProviderRow = SchedulingCostInputRow & {
  acceptedHours: number;
  declinedHours: number;
  hourlyRate: number | null;
  rateSource: SchedulingCostRateSource;
  rateSourceLabel: string;
  wageCost: number | null;
  visitSlotsPerHour: number;
  visitSlotModel: 'standard' | 'mental_health';
  visitSlotModelLabel: string;
  availableSlots: number;
  targetUtilizedVisits: number;
  costPerVisitAtTarget: number | null;
  routingTags: string[];
  decisionDetails: string;
};

export type SchedulingCostDecisionHighlights = {
  lowerRateAcceptedProviders: number;
  lowerRateAcceptedHours: number;
  higherRateDeprioritizedProviders: number;
  higherRateDeprioritizedHours: number;
  estimatedCutCost: number;
  clinicalLeadProviders: number;
  clinicalLeadHours: number;
  utilizationTieBreakProviders: number;
  protectedAccessProviders: number;
  protectedAccessHours: number;
  missingRateProviders: number;
  missingRateHours: number;
  directshiftsAccessProviders: number;
  directshiftsAccessHours: number;
  directshiftsAccessSharePct: number;
  directshiftsTargetSharePct: number;
  equityFloorMetProviders: number;
  equityFloorUnmetProviders: number;
  softCapExceededProviders: number;
  sameRateDirectshiftsGroups: number;
  sameRateDirectshiftsMaxSpreadPct: number;
};

export type SchedulingCostModel = {
  providerRows: SchedulingCostProviderRow[];
  missingRateRows: SchedulingCostProviderRow[];
  totalApprovedHours: number;
  telehealthApprovedHours: number;
  mentalHealthApprovedHours: number;
  mhCoachingApprovedHours: number;
  therapyApprovedHours: number;
  totalAvailableSlots: number;
  totalTargetUtilizedVisits: number;
  knownRateHours: number;
  knownRateSlots: number;
  knownRateTargetUtilizedVisits: number;
  totalKnownWageCost: number;
  costPerVisitAtTarget: number | null;
  missingRateHours: number;
  excludedProviders: number;
  targetUtilization: number;
  slotsPerHour: number;
  highlights: SchedulingCostDecisionHighlights;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normProviderName = (value: string | null | undefined) =>
  (value ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const MH_CAPACITY_EXCLUDED_PROVIDER_NAMES = new Set([
  'matthew vazquez',
  'matthew vasquez',
]);

export function decisionNoteValue(notes: string | null | undefined, key: string): string | null {
  const match = (notes ?? '').match(new RegExp(`${escapeRegExp(key)}=([^;\\n]+)`));
  return match?.[1]?.trim() || null;
}

export function numericValue(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = typeof raw === 'number'
    ? raw
    : Number(String(raw).replace(/[$,%]/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
  return Number.isFinite(n) ? n : 0;
}

export function rateFromDecisionNotes(notes: string | null | undefined): number | null {
  const raw = decisionNoteValue(notes, 'provider_hourly_rate');
  if (!raw || raw === 'missing') return null;
  const rate = numericValue(raw);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

export function selectRateForProviderMonth(
  rates: ProviderPayRateLike[],
  providerId: string,
  monthStart: string,
): ProviderPayRateLike | null {
  const monthIso = monthStart.length === 7 ? `${monthStart}-01` : monthStart.slice(0, 10);
  const candidates = rates
    .filter(row => row.provider_id === providerId)
    .filter(row => {
      const rate = numericValue(row.hourly_rate);
      if (!Number.isFinite(rate) || rate < 0) return false;
      const effectiveFrom = (row.effective_from ?? '0000-01-01').slice(0, 10);
      const effectiveTo = (row.effective_to ?? '9999-12-31').slice(0, 10);
      return effectiveFrom <= monthIso && effectiveTo >= monthIso;
    })
    .sort((a, b) => {
      const rateDiff = numericValue(a.hourly_rate) - numericValue(b.hourly_rate);
      if (rateDiff !== 0) return rateDiff;
      return (b.effective_from ?? '').localeCompare(a.effective_from ?? '');
    });
  return candidates[0] ?? null;
}

export function protectedAccessHoursFromDecisionNotes(notes: string | null | undefined): number {
  const scarceWindowHours = numericValue(decisionNoteValue(notes, 'scarce_window_hours'));
  const accessBufferUsedHours = numericValue(decisionNoteValue(notes, 'access_buffer_used_hours'));
  return Math.max(0, scarceWindowHours) + Math.max(0, accessBufferUsedHours);
}

export function visitSlotsPerHourForCost(row: Pick<SchedulingCostInputRow, 'provider_name' | 'profession'>): {
  slotsPerHour: number;
  model: 'standard' | 'mental_health';
  label: string;
} {
  const isExcluded = MH_CAPACITY_EXCLUDED_PROVIDER_NAMES.has(normProviderName(row.provider_name));
  const isMentalHealth = !isExcluded &&
    mentalHealthServiceLineForProvider(row.profession, row.provider_name) !== null;
  if (!isMentalHealth) {
    return {
      slotsPerHour: COST_VISIT_SLOTS_PER_HOUR,
      model: 'standard',
      label: '2 visits/hr',
    };
  }
  return {
    slotsPerHour: COST_MH_VISIT_SLOTS_PER_HOUR,
    model: 'mental_health',
    label: '3 visits/2.5h',
  };
}

export function routingSynopsisTags(
  notes: string | null | undefined,
  status: string | null | undefined,
  acceptedHours: number,
  declinedHours: number,
  rateSource: SchedulingCostRateSource,
): string[] {
  const raw = notes ?? '';
  const lower = raw.toLowerCase();
  const tags: string[] = [];
  const add = (label: string) => {
    if (!tags.includes(label)) tags.push(label);
  };

  const priority = decisionNoteValue(raw, 'provider_priority');
  const hasRatePolicy =
    decisionNoteValue(raw, 'provider_rate_policy') === 'clinical_leads_then_hourly_rate_then_directshifts_share' ||
    decisionNoteValue(raw, 'provider_rate_policy') === 'clinical_leads_then_lowest_hourly_rate' ||
    lower.includes('lowest current hourly rate') ||
    lower.includes('rate-ranked');

  if (rateSource === 'missing' && acceptedHours > 0) add('Missing rate');
  if (priority === 'clinical_supervisor' || priority === 'clinical_lead' || lower.includes('clinical lead')) {
    add('Clinical lead priority');
  }
  if (hasRatePolicy && acceptedHours > 0 && priority !== 'clinical_supervisor' && priority !== 'clinical_lead') {
    add('Lowest-rate routing');
  }
  if (declinedHours > 0 && (hasRatePolicy || lower.includes('oversupply') || lower.includes('surplus'))) {
    add('Higher-rate/capacity cut');
  }
  if (
    decisionNoteValue(raw, 'provider_utilization_policy') === 'lower_utilization_secondary_after_rate'
  ) {
    add('Utilization tiebreak');
  }
  if (lower.includes('scarce_window') || lower.includes('friday afternoon') || lower.includes('weekend access')) {
    add('Protected access');
  }
  if (lower.includes('access_growth_buffer') || lower.includes('access buffer')) add('Access buffer');
  if (decisionNoteValue(raw, 'cohort') === 'directshifts_access') add('DirectShifts/access target');
  if (decisionNoteValue(raw, 'equity_floor') === 'met') add('Equity floor');
  if (decisionNoteValue(raw, 'soft_cap_exceeded') === '1') add('Soft cap relaxed');
  if (lower.includes('license') || lower.includes('licensure') || lower.includes('state-coverage')) {
    add('License/state issue');
  }
  if (lower.includes('end time is at or before start') || lower.includes('overnight')) add('End before start');
  if (lower.includes('single shift duration') || lower.includes('max_single_shift_hours')) add('Shift too long');
  if ((status === 'declined' || declinedHours > 0) && tags.length === 0) add('Declined/cut hours');
  if (acceptedHours > 0 && tags.length === 0) add('Accepted hours');
  if (tags.length === 0) add('No cost signal');
  return tags;
}

export function buildSchedulingCostModel({
  rows,
  payRates,
  monthStart,
  targetUtilization = COST_VISIT_TARGET_UTILIZATION,
  slotsPerHour = COST_VISIT_SLOTS_PER_HOUR,
}: {
  rows: SchedulingCostInputRow[];
  payRates: ProviderPayRateLike[];
  monthStart: string;
  targetUtilization?: number;
  slotsPerHour?: number;
}): SchedulingCostModel {
  let totalApprovedHours = 0;
  let knownRateHours = 0;
  let totalKnownWageCost = 0;

  const providerRows = rows
    .filter(row => row.decision_status && row.decision_status !== 'superseded')
    .map(row => {
      const acceptedHours = Math.max(0, numericValue(row.accepted_hours));
      const declinedHours = Math.max(0, numericValue(row.declined_hours));
      const decisionRate = rateFromDecisionNotes(row.decision_notes);
      const payRate = selectRateForProviderMonth(payRates, row.provider_id, monthStart);
      const hourlyRate = decisionRate ?? (payRate ? numericValue(payRate.hourly_rate) : null);
      const rateSource: SchedulingCostRateSource =
        decisionRate != null ? 'decision_note' : payRate ? 'provider_pay_rates' : 'missing';
      const visitSlotCapacity = visitSlotsPerHourForCost(row);
      const availableSlots = acceptedHours * visitSlotCapacity.slotsPerHour;
      const targetUtilizedVisits = availableSlots * targetUtilization;
      const wageCost = hourlyRate != null ? acceptedHours * hourlyRate : null;
      const costPerVisitAtTarget =
        wageCost != null && targetUtilizedVisits > 0 ? wageCost / targetUtilizedVisits : null;
      const routingTags = routingSynopsisTags(
        row.decision_notes,
        row.decision_status,
        acceptedHours,
        declinedHours,
        rateSource,
      );

      totalApprovedHours += acceptedHours;
      if (wageCost != null && acceptedHours > 0) {
        knownRateHours += acceptedHours;
        totalKnownWageCost += wageCost;
      }

      return {
        ...row,
        acceptedHours,
        declinedHours,
        hourlyRate,
        rateSource,
        rateSourceLabel:
          rateSource === 'decision_note'
            ? 'Decision'
            : rateSource === 'provider_pay_rates'
              ? payRate?.source ?? 'Rate table'
              : 'Missing',
        wageCost,
        visitSlotsPerHour: visitSlotCapacity.slotsPerHour,
        visitSlotModel: visitSlotCapacity.model,
        visitSlotModelLabel: visitSlotCapacity.label,
        availableSlots,
        targetUtilizedVisits,
        costPerVisitAtTarget,
        routingTags,
        decisionDetails: row.decision_notes ?? '',
      };
    })
    .sort((a, b) => {
      if (a.acceptedHours !== b.acceptedHours) return b.acceptedHours - a.acceptedHours;
      if (a.declinedHours !== b.declinedHours) return b.declinedHours - a.declinedHours;
      return a.provider_name.localeCompare(b.provider_name, undefined, { sensitivity: 'base' });
    });

  const totalAvailableSlots = providerRows.reduce((sum, row) => sum + row.availableSlots, 0);
  const totalTargetUtilizedVisits = totalAvailableSlots * targetUtilization;
  const knownRateSlots = providerRows.reduce(
    (sum, row) => sum + (row.rateSource === 'missing' ? 0 : row.availableSlots),
    0,
  );
  const knownRateTargetUtilizedVisits = providerRows.reduce(
    (sum, row) => sum + (row.rateSource === 'missing' ? 0 : row.targetUtilizedVisits),
    0,
  );
  const costPerVisitAtTarget =
    knownRateTargetUtilizedVisits > 0 ? totalKnownWageCost / knownRateTargetUtilizedVisits : null;
  const missingRateRows = providerRows.filter(row => row.acceptedHours > 0 && row.rateSource === 'missing');
  const missingRateHours = missingRateRows.reduce((sum, row) => sum + row.acceptedHours, 0);

  const highlights: SchedulingCostDecisionHighlights = providerRows.reduce(
    (acc, row) => {
      const tagSet = new Set(row.routingTags);
      if (tagSet.has('Lowest-rate routing') && row.acceptedHours > 0) {
        acc.lowerRateAcceptedProviders += 1;
        acc.lowerRateAcceptedHours += row.acceptedHours;
      }
      if (tagSet.has('Higher-rate/capacity cut') && row.declinedHours > 0) {
        acc.higherRateDeprioritizedProviders += 1;
        acc.higherRateDeprioritizedHours += row.declinedHours;
        if (row.hourlyRate != null) acc.estimatedCutCost += row.hourlyRate * row.declinedHours;
      }
      if (tagSet.has('Clinical lead priority') && row.acceptedHours > 0) {
        acc.clinicalLeadProviders += 1;
        acc.clinicalLeadHours += row.acceptedHours;
      }
      if (tagSet.has('Utilization tiebreak')) acc.utilizationTieBreakProviders += 1;
      const protectedAccessHours = protectedAccessHoursFromDecisionNotes(row.decision_notes);
      if (protectedAccessHours > 0) {
        acc.protectedAccessProviders += 1;
        acc.protectedAccessHours += protectedAccessHours;
      }
      if (row.rateSource === 'missing' && row.acceptedHours > 0) {
        acc.missingRateProviders += 1;
        acc.missingRateHours += row.acceptedHours;
      }
      if (decisionNoteValue(row.decision_notes, 'cohort') === 'directshifts_access' && row.acceptedHours > 0) {
        acc.directshiftsAccessProviders += 1;
        acc.directshiftsAccessHours += row.acceptedHours;
      }
      if (decisionNoteValue(row.decision_notes, 'equity_floor') === 'met') {
        acc.equityFloorMetProviders += 1;
      } else if (decisionNoteValue(row.decision_notes, 'equity_floor')?.startsWith('unmet')) {
        acc.equityFloorUnmetProviders += 1;
      }
      if (decisionNoteValue(row.decision_notes, 'soft_cap_exceeded') === '1') {
        acc.softCapExceededProviders += 1;
      }
      const targetShare = numericValue(decisionNoteValue(row.decision_notes, 'directshifts_target_share'));
      if (targetShare > 0) acc.directshiftsTargetSharePct = targetShare;
      return acc;
    },
    {
      lowerRateAcceptedProviders: 0,
      lowerRateAcceptedHours: 0,
      higherRateDeprioritizedProviders: 0,
      higherRateDeprioritizedHours: 0,
      estimatedCutCost: 0,
      clinicalLeadProviders: 0,
      clinicalLeadHours: 0,
      utilizationTieBreakProviders: 0,
      protectedAccessProviders: 0,
      protectedAccessHours: 0,
      missingRateProviders: 0,
      missingRateHours: 0,
      directshiftsAccessProviders: 0,
      directshiftsAccessHours: 0,
      directshiftsAccessSharePct: 0,
      directshiftsTargetSharePct: 15,
      equityFloorMetProviders: 0,
      equityFloorUnmetProviders: 0,
      softCapExceededProviders: 0,
      sameRateDirectshiftsGroups: 0,
      sameRateDirectshiftsMaxSpreadPct: 0,
    },
  );
  highlights.directshiftsAccessSharePct = totalApprovedHours > 0
    ? round2((highlights.directshiftsAccessHours / totalApprovedHours) * 100)
    : 0;
  const directshiftsByRate = new Map<string, number[]>();
  for (const row of providerRows) {
    if (decisionNoteValue(row.decision_notes, 'cohort') !== 'directshifts_access') continue;
    if (row.acceptedHours <= 0 && row.declinedHours <= 0) continue;
    const rate = row.hourlyRate == null ? 'missing' : String(row.hourlyRate);
    const pct = numericValue(decisionNoteValue(row.decision_notes, 'provider_acceptance_pct'));
    const values = directshiftsByRate.get(rate) ?? [];
    values.push(pct);
    directshiftsByRate.set(rate, values);
  }
  for (const values of directshiftsByRate.values()) {
    if (values.length < 2) continue;
    highlights.sameRateDirectshiftsGroups += 1;
    highlights.sameRateDirectshiftsMaxSpreadPct = Math.max(
      highlights.sameRateDirectshiftsMaxSpreadPct,
      round2(Math.max(...values) - Math.min(...values)),
    );
  }

  return {
    providerRows,
    missingRateRows,
    totalApprovedHours,
    totalAvailableSlots,
    totalTargetUtilizedVisits,
    knownRateHours,
    knownRateSlots,
    knownRateTargetUtilizedVisits,
    totalKnownWageCost,
    costPerVisitAtTarget,
    missingRateHours,
    excludedProviders: missingRateRows.length,
    targetUtilization,
    slotsPerHour,
    highlights,
  };
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
