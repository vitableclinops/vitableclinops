/**
 * evaluate-schedule-submissions edge function
 *
 * Reads schedule_submissions and writes back a decision (accepted /
 * partial / declined) plus accepted_hours / declined_hours / decision_notes.
 *
 * Resubmission handling:
 *   When a provider submits multiple times for the same target_month, we
 *   group those submissions together and walk them chronologically. New
 *   submissions overwrite any overlapping date/time slots from earlier
 *   submissions; non-overlapping slots from earlier submissions remain.
 *   The latest submission in the group gets the decision based on the
 *   merged effective hours; earlier submissions get decision_status =
 *   'superseded' so the audit trail stays intact.
 *
 * Decision math (per group of submissions for the same provider + month):
 *   1. Run every submission's parsed_shifts through the validation /
 *      normalization pipeline (`_shared/availabilityValidation.ts`):
 *        - Apply provider-specific overrides (e.g. AM/PM corrections)
 *        - Apply default deterministic AM/PM corrections
 *        - Flag implausibly long shifts, full-day recurring availability,
 *          12 AM start/end paired with daytime end/start, etc.
 *        - Expand recurring entries to weekday occurrences in the month;
 *          one-off + in-home become single-date slots.
 *        - Reconcile across submissions: later submissions overwrite
 *          overlapping slots from earlier ones; duplicates collapse.
 *        - Subtract unavailable_dates the provider listed.
 *      The raw submission stays untouched on the row (raw_answers and the
 *      raw widget values inside parsed_shifts are preserved); only the
 *      *normalized* timeline drives the forecast decision.
 *   2. effective_hours = summary.final_approvable_hours from the pipeline
 *      (normalized + deduped + minus unavailable).
 *   3. eligible_states = provider's allocation-eligible states from
 *      v_provider_state_eligibility, which rolls up ClinOps manual licenses,
 *      Medallion API licenses, DirectShifts static licenses, and the live
 *      Metabase active-state overlay. Those states are then filtered by the
 *      scheduling policy: MD/DO/Physician providers are reserved for
 *      MD-only states (AL/IN/GA/MS/MO/SC/TN/LA), and non-physicians cannot
 *      be allocated to those MD-only states.
 *   4. For each eligible state, base_demand_hours = sum of demand_forecast
 *      values over the target month. July 2026 uses midpoint demand targets,
 *      so the forecast total is already the final planning target before
 *      subtracting committed hours from decisions made in prior runs for
 *      OTHER providers in same state+month.
 *      Note: demand_forecast.projected_visits stores hours of provider
 *      availability (not visits); column name is legacy. See
 *      compute-demand-forecast for the canonical methodology.
 *   5. total_gap = sum of demand-hour gaps across eligible states
 *      (clipped 0). Scarce access windows can still be protected before
 *      monthly oversupply trimming.
 *   6. Scarce coverage windows (Friday PM, Saturday, Sunday) are protected
 *      before monthly oversupply trimming. This keeps same-day / next-day
 *      access coverage from being rejected just because total monthly hours
 *      look full.
 *   7. Telehealth decisions are collected as monthly candidates, then a
 *      fairness-aware allocation pass assigns accepted hours:
 *        - Accept validated clinical lead hours in full before all demand
 *          trimming, rate, share, and soft-cap policies.
 *        - Protect scarce Friday/weekend access windows first.
 *        - Give each eligible submitter a no-zero floor when compatible
 *          demand remains.
 *        - Target DirectShifts/access at ~15% of accepted telehealth hours
 *          after clinical leads and hourly rate routing.
 *        - Keep same-rate DirectShifts/access providers close by accepted
 *          percentage of submitted forecastable hours.
 *        - Apply a 75% submitted-hours soft cap before relaxing the cap to
 *          cover otherwise-unfilled demand.
 *      accepted_hours = effective_hours     → accepted
 *      accepted_hours > 0                   → partial
 *      accepted_hours <= 0                  → declined
 *
 * Modes:
 *   POST /functions/v1/evaluate-schedule-submissions
 *     → evaluate every (provider, target_month) group with at least one
 *       pending submission
 *   POST /functions/v1/evaluate-schedule-submissions?target_month=YYYY-MM-01
 *     → evaluate every group for that month (re-runs supersedes too)
 *   POST /functions/v1/evaluate-schedule-submissions?provider_id=<uuid>
 *     → evaluate just that provider's pending groups
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildSubmissionTimeline,
  buildShiftRecommendationRows,
  emailFromParsedShifts,
  isScarceCoverageSlot,
  scarceCoverageWindowForSlot,
  type BuildTimelineResult,
  type ShiftRecommendationRow,
} from '../_shared/submissionTimeline.ts';
import { DEFAULT_VALIDATION_CONFIG } from '../_shared/availabilityValidation.ts';
import {
  allocateSchedulingEquity,
  AUGUST_2026_DIRECTSHIFTS_NP_MIN_HOURS,
  AUGUST_2026_DIRECTSHIFTS_NP_TARGET_HOURS,
  AUGUST_2026_FAIRNESS_POLICY_VERSION,
  AUGUST_2026_FAIRNESS_TOLERANCE_PCT,
  DIRECTSHIFTS_ACCESS_TARGET_SHARE,
  FAIRNESS_POLICY_VERSION,
  PROVIDER_SOFT_CAP_SHARE,
  type SchedulingEquityAllocation,
  type SchedulingEquityCandidate,
  type SchedulingEquityCohort,
  type SchedulingEquityPolicy,
  type SchedulingEquityStateGap,
} from '../_shared/equityAllocation.ts';
import {
  compareProviderAllocationPriority,
  isDirectShiftsProvider,
  isNamedClinicalLeadAdminProvider,
  providerHourlyRate,
  providerUtilizationPct,
  providerPriorityFor,
  type ProviderPriority,
} from '../_shared/providerPriority.ts';
import { canonicalName } from '../_shared/nameNormalization.ts';

// Supabase's generated client generics collapse table writes to `never`
// without an explicit broad schema here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientAny = ReturnType<typeof createClient<any, 'public', any>>;

// States that can only be served by physicians per Vitable scope-of-practice
// rules. For now, physician hours are also reserved for these states so broad
// state demand does not consume scarce MD/DO capacity.
const MD_ONLY_STATES = new Set(['AL', 'IN', 'GA', 'MS', 'MO', 'SC', 'TN', 'LA']);
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

const isPhysicianProfession = (profession: string | null | undefined) => {
  const norm = normProfession(profession);
  const tokens = norm.split('_');
  return (
    PHYSICIAN_PROFESSIONS.has(norm) ||
    tokens.includes('MD') ||
    tokens.includes('DO') ||
    tokens.includes('PHYSICIAN')
  );
};

const isSchedulableForState = (
  profession: string | null | undefined,
  state: string,
) => {
  const st = state.trim().toUpperCase();
  const isMdOnlyState = MD_ONLY_STATES.has(st);
  if (isPhysicianProfession(profession)) return isMdOnlyState;
  return !isMdOnlyState;
};

type MentalHealthServiceLine = 'mh_coaching' | 'therapy';

// Mental health professions use service-line forecasts, not the telehealth
// state-demand allocator. Coaching and therapy/LPC are separate demand pools.
const MH_COACHING_PROFESSIONS = new Set([
  'MENTAL_HEALTH_COACH',
  'MH_COACH',
  'HEALTH_COACH',
]);
const THERAPY_PROFESSIONS = new Set([
  'LPC',
  'LCSW',
  'LICSW',
  'LMFT',
  'MFT',
  'LMHC',
  'THERAPIST',
  'LICENSED_CLINICAL_SOCIAL_WORKER',
  'LICENSED_PROFESSIONAL_COUNSELOR',
]);
const MENTAL_HEALTH_PROVIDER_OVERRIDES = new Map<string, MentalHealthServiceLine>([
  ['matthew vazquez', 'mh_coaching'],
  ['matthew vasquez', 'mh_coaching'],
  ['jamie fuentes', 'mh_coaching'],
  ['jennifer yost', 'mh_coaching'],
  ['esha shah', 'mh_coaching'],
  ['liana griebsch', 'mh_coaching'],
  ['li griebsch', 'mh_coaching'],
  ['li greibsch', 'mh_coaching'],
  ['michelle diederich', 'mh_coaching'],
  ['margaret margo mulgrew', 'therapy'],
  ['margaret mulgrew', 'therapy'],
  ['margo mulgrew', 'therapy'],
  ['richard travis rash', 'therapy'],
  ['richard rash', 'therapy'],
  ['mishelle lockerby', 'therapy'],
  ['mishelle lockerby direct shifts', 'therapy'],
]);
const normProviderName = (name: string | null | undefined) =>
  (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const mentalHealthServiceLineForProfession = (
  p: string | null | undefined,
): MentalHealthServiceLine | null => {
  if (!p) return null;
  const norm = normProfession(p);
  if (MH_COACHING_PROFESSIONS.has(norm)) return 'mh_coaching';
  if (THERAPY_PROFESSIONS.has(norm)) return 'therapy';
  return null;
};
const mentalHealthServiceLineForProvider = (
  profession: string | null | undefined,
  ...providerNames: Array<string | null | undefined>
): MentalHealthServiceLine | null => {
  for (const providerName of providerNames) {
    const override = MENTAL_HEALTH_PROVIDER_OVERRIDES.get(normProviderName(providerName));
    if (override) return override;
  }
  return mentalHealthServiceLineForProfession(profession);
};
const isMentalHealthProvider = (
  profession: string | null | undefined,
  ...providerNames: Array<string | null | undefined>
) => mentalHealthServiceLineForProvider(profession, ...providerNames) !== null;
const mentalHealthServiceLineLabel = (serviceLine: MentalHealthServiceLine) =>
  serviceLine === 'mh_coaching' ? 'MH Coaching' : 'Therapy / LPC';

const MH_VISIT_MINUTES = 40;
const MH_CHARTING_BUFFER_MINUTES = 10;
const MH_EHR_SLOT_GAP_MINUTES = 0;
const MH_PREFERRED_SHIFT_HOURS = 2.5;
const MH_VISIT_CADENCE_MINUTES = MH_VISIT_MINUTES + MH_CHARTING_BUFFER_MINUTES;
// Policy (Jul 2026): MH providers no longer have a hard 2.5h minimum shift,
// and weekend after-hours shifts are approvable (weekend window extended to
// full day). Weekday operating-hours window remains 9a–9p ET.
const MH_MIN_SHIFT_HOURS = 0;
const MENTAL_HEALTH_VALIDATION_CONFIG = {
  ...DEFAULT_VALIDATION_CONFIG,
  min_single_shift_hours: MH_MIN_SHIFT_HOURS,
  weekend_window_start_min: 0,
  weekend_window_end_min: 24 * 60,
};
const OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG = {
  ...DEFAULT_VALIDATION_CONFIG,
  weekday_window_start_min: 0,
  weekday_window_end_min: 24 * 60,
  weekend_window_start_min: 0,
  weekend_window_end_min: 24 * 60,
};
const MH_OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG = {
  ...OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG,
};
const MH_POLICY_CUT_REASON =
  'Cut — mental health shift policy violation';
const MH_PUBLISH_REASON =
  'Publish (mental health service-line forecast; state allocator bypassed)';
const ACCESS_GROWTH_BUFFER_MULTIPLIER = 1;
const ACCESS_GROWTH_BUFFER_POLICY = 'midpoint_targets_no_extra_buffer';
const AUGUST_2026_MONTH = '2026-08-01';
const AUGUST_2026_JOTFORM_DEADLINE_UTC_MS = Date.parse('2026-07-08T04:59:59.999Z');
const AUGUST_2026_DIRECTSHIFTS_NP_NAMES = new Set([
  'abby grant',
  'akosua norgbey',
  'brittney afram',
  'cassondra hawkins',
  'jarrod nero',
  'nycole cox',
  'stacy lynn',
  'stephanie lumsden',
]);

const isAugust2026TargetMonth = (targetMonth: string | null | undefined) =>
  (targetMonth ?? '').slice(0, 10) === AUGUST_2026_MONTH;

const normalizedDecisionName = (name: string | null | undefined) =>
  (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isAugust2026DirectShiftsNp = (
  providerProfile: ProviderProfile | null | undefined,
  submissionName: string | null | undefined,
) =>
  AUGUST_2026_DIRECTSHIFTS_NP_NAMES.has(normalizedDecisionName(providerProfile?.name)) ||
  AUGUST_2026_DIRECTSHIFTS_NP_NAMES.has(normalizedDecisionName(submissionName));

const isSubmittedByAugust2026Deadline = (submittedAt: string | null | undefined) => {
  if (!submittedAt) return false;
  const parsed = Date.parse(submittedAt);
  return Number.isFinite(parsed) && parsed <= AUGUST_2026_JOTFORM_DEADLINE_UTC_MS;
};

type TelehealthAllocationCandidate = {
  key: string;
  groupSubs: Submission[];
  latest: Submission;
  olderIds: string[];
  providerId: string;
  targetMonth: string;
  providerProfile: ProviderProfile | undefined;
  providerPriority: ProviderPriority;
  allocationPolicy: SchedulingEquityPolicy;
  isAugustDirectShiftsNp: boolean;
  submittedOnTimeForAugust: boolean;
  isPhysician: boolean;
  validation: BuildTimelineResult;
  fullTimeline: BuildTimelineResult['timeline'];
  forecastTimeline: BuildTimelineResult['forecastTimeline'];
  forecastOutOfHoursTimeline: BuildTimelineResult['forecastOutOfHoursTimeline'];
  forecastPolicyCutTimeline: BuildTimelineResult['forecastPolicyCutTimeline'];
  effectiveHours: number;
  publishedLocks: PublishedShiftLockRow[];
  lockedPublishedHours: number;
  oohDeclined: number;
  policyDeclined: number;
  eligibleSourceSummary: string[];
  gapByState: Array<{
    state: string;
    gapHours: number;
    baseDemandHours: number;
    bufferedDemandHours: number;
    accessBufferHours: number;
    committedHours: number;
    baseGapHours: number;
    demandHours: number;
    missingDemand: boolean;
  }>;
  totalGap: number;
  baseTotalGap: number;
  baseTotalDemand: number;
  bufferedTotalDemand: number;
  accessBufferHours: number;
  missingDemandStates: string[];
  scarceCoverageTimeline: BuildTimelineResult['forecastTimeline'];
  scarceCoverageHours: number;
  scarceCoverageWindows: string[];
  equityCohort: SchedulingEquityCohort;
  equityFloorHours: number;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const parseBooleanFlag = (value: string | null | undefined): boolean => {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

type ParsedShifts = {
  requested_states?: string[];
  recurring_virtual?: unknown;
  one_off_virtual?: unknown;
  in_home_clinic?: unknown;
  unavailable_dates?: unknown;
  email?: string;
  [k: string]: unknown;
};

type Submission = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  parsed_shifts: ParsedShifts | null;
  decision_status: string;
  accepted_hours: number | null;
  declined_hours: number | null;
  decision_notes: string | null;
  decision_run_id: string | null;
  submitted_at: string;
  human_review_state: string | null;
};

const hasManualOutsideOperatingHoursException = (
  parsedShifts: Submission['parsed_shifts'],
) => {
  if (!parsedShifts || typeof parsedShifts !== 'object' || Array.isArray(parsedShifts)) {
    return false;
  }
  const correction = parsedShifts.clinops_manual_correction;
  return Boolean(
    correction &&
      typeof correction === 'object' &&
      !Array.isArray(correction) &&
      (correction as Record<string, unknown>).allow_outside_operating_hours === true,
  );
};

const validationOptionsForSubmission = (
  latest: Submission,
  isMentalHealth: boolean,
) => {
  const allowOutsideOperatingHours = hasManualOutsideOperatingHoursException(latest.parsed_shifts);
  if (allowOutsideOperatingHours) {
    return {
      allowOutsideOperatingHours,
      options: {
        config: isMentalHealth
          ? MH_OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG
          : OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG,
      },
    };
  }
  return {
    allowOutsideOperatingHours,
    options: isMentalHealth ? { config: MENTAL_HEALTH_VALIDATION_CONFIG } : {},
  };
};

type CommittedSubmission = {
  id: string;
  provider_id: string | null;
  target_month: string | null;
  parsed_shifts: ParsedShifts | null;
  accepted_hours: number | null;
  decision_status: string | null;
};

type PublishedShiftLockRow = {
  id: string;
  submission_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  target_month: string | null;
  shift_date: string | null;
  start_min: number | string | null;
  end_min: number | string | null;
  hours: number | string | null;
  shift_type: string | null;
  assigned_state: string | null;
  recommendation?: string | null;
  publish_status: string | null;
  published_at: string | null;
  published_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
  homebase_shift_id: string | null;
};

type TimelineSlot = BuildTimelineResult['timeline'][number];

const LOCKED_PUBLISH_STATUSES = new Set(['published_to_homebase', 'confirmed']);

const isLockedPublishStatus = (status: string | null | undefined) =>
  LOCKED_PUBLISH_STATUSES.has(status ?? '');

const numeric = (value: number | string | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const lockGroupKey = (row: PublishedShiftLockRow): string | null => {
  if (!row.provider_id || !row.target_month) return null;
  return `${row.provider_id}|${String(row.target_month).slice(0, 10)}`;
};

const lockOverlapsSlot = (
  lock: PublishedShiftLockRow,
  slot: Pick<TimelineSlot, 'date' | 'startMin' | 'endMin'>,
) => {
  if (!lock.shift_date) return false;
  if (String(lock.shift_date).slice(0, 10) !== slot.date) return false;
  const start = numeric(lock.start_min);
  const end = numeric(lock.end_min);
  return start < slot.endMin && slot.startMin < end;
};

function filterSlotsOutsidePublishedLocks<T extends Pick<TimelineSlot, 'date' | 'startMin' | 'endMin'>>(
  slots: T[],
  locks: PublishedShiftLockRow[],
): T[] {
  if (locks.length === 0) return slots;
  return slots.filter(slot => !locks.some(lock => lockOverlapsSlot(lock, slot)));
}

const sumLockedHours = (locks: PublishedShiftLockRow[]) =>
  roundEval2(locks.reduce((sum, row) => sum + numeric(row.hours), 0));

function pushPublishedLockNoteParts(noteParts: string[], locks: PublishedShiftLockRow[]) {
  if (locks.length === 0) return;
  noteParts.push('published_lock_policy=preserve_published_rows_fill_gaps_only');
  noteParts.push(`published_lock_shifts=${locks.length}`);
  noteParts.push(`published_lock_hours=${sumLockedHours(locks)}h`);
}

async function loadPublishedShiftLocks(
  supabase: SupabaseClientAny,
  providerIds: string[],
  months: string[],
): Promise<Map<string, PublishedShiftLockRow[]>> {
  const byGroup = new Map<string, PublishedShiftLockRow[]>();
  if (providerIds.length === 0 || months.length === 0) return byGroup;

  const { data, error } = await supabase
    .from('shift_recommendations')
    .select(
      'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, hours, shift_type, assigned_state, publish_status, published_at, published_by, ehr_posted_at, ehr_posted_by, homebase_shift_id',
    )
    .in('provider_id', providerIds)
    .in('target_month', months)
    .eq('recommendation', 'publish')
    .in('publish_status', Array.from(LOCKED_PUBLISH_STATUSES))
    .range(0, 49999);
  if (error) throw new Error(`published shift lock load failed: ${error.message}`);

  for (const row of (data ?? []) as PublishedShiftLockRow[]) {
    if (!isLockedPublishStatus(row.publish_status)) continue;
    const key = lockGroupKey(row);
    if (!key) continue;
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }

  return byGroup;
}

type ProviderStateEligibilityRow = {
  provider_id: string | null;
  state: string | null;
  allocation_eligible: boolean | null;
  eligibility_status: string | null;
  license_sources: string[] | null;
  metabase_active: boolean | null;
};

type ProviderProfile = {
  id: string;
  name: string | null;
  profession: string | null;
  employment_type: string | null;
  source: string | null;
  shift_types: string[] | null;
  hourly_rate?: number | null;
  utilization_pct?: number | null;
  utilization_source?: string | null;
  utilization_basis?: string | null;
  utilization_month?: string | null;
  utilization_state_count?: number | null;
  utilization_available_count?: number | null;
  utilization_booked_count?: number | null;
};

type ProviderPayRateRow = {
  provider_id: string | null;
  hourly_rate: number | string | null;
  effective_from: string | null;
  effective_to: string | null;
};

type ProviderUtilizationRow = {
  profile_id: string | null;
  avg_utilization_pct: number | string | null;
  window_start: string | null;
  window_end: string | null;
  imported_at: string | null;
};

type ProviderStateUtilizationRow = {
  provider_id: string | null;
  provider_name: string | null;
  month_date: string | null;
  state: string | null;
  available_count: number | string | null;
  booked_count: number | string | null;
  booking_rate_pct: number | string | null;
  imported_at: string | null;
  synced_at: string | null;
};

type ProviderUtilizationSummary = {
  pct: number;
  source: 'provider_state_utilization' | 'provider_utilization';
  basis: 'state_gap_weighted' | 'provider_latest';
  month?: string | null;
  stateCount?: number | null;
  availableCount?: number | null;
  bookedCount?: number | null;
};

type ServiceLineDemandTarget = {
  service_line: string | null;
  month: string | null;
  monthly_hours_target: number | null;
};

// Stable signature of a parsed_shifts blob for "did anything material change
// vs the prior submission?" gating. We canonicalize the four widget arrays
// into ordered tuple lists and serialize. JSON-string blobs are tolerated.
function shiftsSignature(parsed: ParsedShifts | null): string {
  if (!parsed) return '';
  const arr = (raw: unknown): Record<string, unknown>[] => {
    if (raw == null) return [];
    let v: unknown = raw;
    if (typeof raw === 'string') {
      try { v = JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(v)
      ? v.filter((e): e is Record<string, unknown> => e != null && typeof e === 'object')
      : [];
  };
  const fmt = (label: string, rows: Record<string, unknown>[], keys: string[]) => {
    const tuples = rows
      .map(r => keys.map(k => String(r[k] ?? '').trim()).join('|'))
      .sort();
    return `${label}:[${tuples.join(';')}]`;
  };
  return [
    fmt('rec', arr(parsed.recurring_virtual), ['Day of Week', 'Start Time (ET)', 'End Time (ET)']),
    fmt('one', arr(parsed.one_off_virtual), ['Date', 'Start Time (ET)', 'End Time (ET)']),
    fmt('home', arr(parsed.in_home_clinic), ['Date', 'Start Time (ET)', 'End Time (ET)']),
    fmt('off', arr(parsed.unavailable_dates), ['Start Date', 'End Date', 'Date']),
  ].join('||');
}

type ForecastSlot = BuildTimelineResult['forecastTimeline'][number];

function slotHours(slot: ForecastSlot): number {
  return (slot.endMin - slot.startMin) / 60;
}

function sumSlotHours(slots: ForecastSlot[]): number {
  return roundEval2(slots.reduce((sum, slot) => sum + slotHours(slot), 0));
}

function pushProviderPriorityNotes(
  noteParts: string[],
  priority: ProviderPriority,
  providerProfile?: ProviderProfile | null,
  useUtilizationTieBreak = false,
  policy: SchedulingEquityPolicy = 'legacy_2026_07',
) {
  noteParts.push(`provider_priority=${priority.key}`);
  noteParts.push(
    policy === 'august_2026'
      ? 'provider_rate_policy=august_2026_clinical_leads_then_lowest_hourly_rate'
      : 'provider_rate_policy=clinical_leads_then_hourly_rate_then_directshifts_share',
  );
  const hourlyRate = providerHourlyRate(providerProfile);
  if (hourlyRate == null) {
    noteParts.push('provider_hourly_rate=missing');
  } else {
    noteParts.push(`provider_hourly_rate=${hourlyRate}`);
  }
  noteParts.push(
    policy === 'august_2026'
      ? 'provider_utilization_policy=higher_recent_utilization_tiebreak_after_rate'
      : useUtilizationTieBreak
      ? 'provider_utilization_policy=lower_utilization_secondary_after_rate'
      : 'provider_utilization_policy=not_used_for_scheduling',
  );
  const utilizationPct = providerUtilizationPct(providerProfile);
  if (utilizationPct == null) {
    noteParts.push('provider_utilization_pct=missing');
  } else {
    noteParts.push(`provider_utilization_pct=${utilizationPct}`);
    if (providerProfile?.utilization_source) {
      noteParts.push(`provider_utilization_source=${providerProfile.utilization_source}`);
    }
    if (providerProfile?.utilization_basis) {
      noteParts.push(`provider_utilization_basis=${providerProfile.utilization_basis}`);
    }
    if (providerProfile?.utilization_month) {
      noteParts.push(`provider_utilization_month=${providerProfile.utilization_month}`);
    }
    if (providerProfile?.utilization_state_count != null) {
      noteParts.push(`provider_utilization_state_count=${providerProfile.utilization_state_count}`);
    }
    if (providerProfile?.utilization_available_count != null) {
      noteParts.push(`provider_utilization_available_count=${providerProfile.utilization_available_count}`);
    }
    if (providerProfile?.utilization_booked_count != null) {
      noteParts.push(`provider_utilization_booked_count=${providerProfile.utilization_booked_count}`);
    }
  }
  if (priority.key === 'directshifts_brittany_priority') {
    if (policy === 'august_2026') {
      noteParts.push(
        'provider_priority_reason=Brittney Afram is a DirectShifts NP in scope; August still ranks by clinical lead flag then hourly rate.',
      );
    } else {
      noteParts.push(
        'provider_priority_reason=Brittney Afram keeps the DirectShifts compatibility key; lowest hourly rate still decides before this tie-break.',
        'directshifts_priority_tiebreak=1',
      );
    }
  } else if (priority.key === 'clinical_supervisor' && isNamedClinicalLeadAdminProvider(providerProfile)) {
    noteParts.push('provider_priority_reason=named_clinical_lead_admin_override');
  }
}

function equityCohortForProvider(
  priority: ProviderPriority,
  providerProfile?: ProviderProfile | null,
): SchedulingEquityCohort {
  if (priority.key === 'clinical_supervisor') return 'clinical_lead';
  return isDirectShiftsProvider(providerProfile) ? 'directshifts_access' : 'standard';
}

function firstForecastBlockHours(slots: BuildTimelineResult['forecastTimeline']): number {
  const first = [...slots].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.startMin - b.startMin ||
    a.endMin - b.endMin,
  )[0];
  if (!first) return 0;
  return roundEval2((first.endMin - first.startMin) / 60);
}

function pushEquityAllocationNotes(
  noteParts: string[],
  allocation: SchedulingEquityAllocation,
  cohort: SchedulingEquityCohort,
  policy: SchedulingEquityPolicy = 'legacy_2026_07',
) {
  noteParts.push(`cohort=${cohort}`);
  if (policy === 'august_2026') {
    noteParts.push(`fairness_policy_version=${AUGUST_2026_FAIRNESS_POLICY_VERSION}`);
    noteParts.push(`proportional_fairness_tolerance_pct=${allocation.fairnessTolerancePct ?? AUGUST_2026_FAIRNESS_TOLERANCE_PCT}`);
    noteParts.push('directshifts_share_policy=removed_for_august_2026');
    noteParts.push(`provider_acceptance_pct=${allocation.providerAcceptancePct}`);
    if (allocation.directShiftsFloorHours && allocation.directShiftsFloorHours > 0) {
      noteParts.push(`directshifts_np_minimum_hours=${AUGUST_2026_DIRECTSHIFTS_NP_MIN_HOURS}`);
      noteParts.push(`directshifts_np_floor_applied_hours=${allocation.directShiftsFloorHours}`);
      noteParts.push(`directshifts_np_target_hours=${allocation.directShiftsTargetHours ?? AUGUST_2026_DIRECTSHIFTS_NP_TARGET_HOURS}`);
    }
    if (allocation.overflowHours && allocation.overflowHours > 0) {
      noteParts.push(`overflow_hours=${allocation.overflowHours}h`);
    }
    if (allocation.manualReviewReason) {
      noteParts.push(`manual_review_reason=${allocation.manualReviewReason}`);
    }
    if (cohort === 'clinical_lead') {
      noteParts.push('clinical_lead_full_accept=1');
    }
    return;
  }

  noteParts.push(`fairness_policy_version=${FAIRNESS_POLICY_VERSION}`);
  noteParts.push(`directshifts_target_share=${Math.round(DIRECTSHIFTS_ACCESS_TARGET_SHARE * 100)}`);
  noteParts.push(`directshifts_actual_share=${allocation.directshiftsShareAfter}`);
  noteParts.push(`provider_acceptance_pct=${allocation.providerAcceptancePct}`);
  noteParts.push(`soft_cap_policy=${Math.round(PROVIDER_SOFT_CAP_SHARE * 100)}pct_submitted`);
  noteParts.push(`soft_cap_hours=${allocation.softCapHours}h`);
  noteParts.push(`soft_cap_exceeded=${allocation.softCapExceeded ? 1 : 0}`);
  noteParts.push(`equity_floor=${allocation.equityFloor}`);
  if (cohort === 'directshifts_access') {
    noteParts.push(`directshifts_same_rate_tolerance_pct=10`);
  } else if (cohort === 'clinical_lead') {
    noteParts.push('clinical_lead_full_accept=1');
  }
}

function schedulingAdjustmentNoteParts(validation: BuildTimelineResult): string[] {
  const noteParts: string[] = [];
  const longBreaks = validation.schedulingAdjustments.longShiftBreaks;
  if (longBreaks.length > 0) {
    const first = longBreaks[0];
    noteParts.push(
      'long_shift_break_policy=mandatory_1_hour_break_for_12h_shift',
      `long_shift_break_count=${longBreaks.length}`,
      `long_shift_break_hours=${roundEval2(validation.schedulingAdjustments.hours_removed_for_long_shift_breaks)}h`,
      `original_shift_hours=${first.originalShiftHours ?? roundEval2((first.originalEndMin - first.originalStartMin) / 60)}`,
      `scheduled_hours_after_break=${first.scheduledHoursAfterBreak ?? roundEval2(((first.originalEndMin - first.originalStartMin) / 60) - 1)}`,
      `break_start=${formatEvalClock24(first.startMin)}`,
      `break_end=${formatEvalClock24(first.endMin)}`,
      `break_reason=${first.reason}`,
    );
  }

  const meetingBlackouts = validation.schedulingAdjustments.providerMeetingBlackouts;
  if (meetingBlackouts.length > 0) {
    const first = meetingBlackouts[0];
    noteParts.push(
      `provider_meeting_blackout=${first.blackoutWindow ?? '2026-06-24T12:00:00-05:00/2026-06-24T13:00:00-05:00'}`,
      `provider_meeting_blackout_hours=${roundEval2(validation.schedulingAdjustments.hours_removed_for_provider_meeting_blackouts)}`,
      `provider_meeting_blackout_reason=${first.reason}`,
    );
  }

  if (validation.unavailableDateOverrides.length > 0) {
    const first = validation.unavailableDateOverrides[0];
    noteParts.push(
      `unavailable_override_count=${validation.unavailableDateOverrides.length}`,
      `unavailable_override_ranges=${validation.unavailableDateOverrides.map(r => `${r.startDate}..${r.endDate}`).join(',')}`,
    );
    if (first.reason) {
      noteParts.push(`unavailable_override_reason=${first.reason}`);
    }
  }

  return noteParts;
}

function formatEvalClock24(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const monthFilter = url.searchParams.get('target_month');
  const providerFilter = url.searchParams.get('provider_id');
  const useUtilizationTieBreak = parseBooleanFlag(
    url.searchParams.get('use_utilization') ??
      Deno.env.get('SCHEDULING_USE_UTILIZATION_TIEBREAK'),
  );

  const decisionRunId = crypto.randomUUID();
  const counters = {
    groups: 0,
    accepted: 0,
    partial: 0,
    declined: 0,
    needs_review: 0,
    superseded: 0,
    skipped_unmatched_provider: 0,
    skipped_no_hours: 0,
    skipped_no_licensed_states: 0,
    skipped_awaiting_review: 0,
    published_locks: 0,
    published_lock_hours: 0,
    errors: 0,
  };
  const decisions: Array<Record<string, unknown>> = [];

  try {
    // ── Find groups (provider, target_month) that need work ─────────────
    let pendingQuery = supabase
      .from('schedule_submissions')
      .select('provider_id, target_month, decision_status');

    if (monthFilter) pendingQuery = pendingQuery.eq('target_month', monthFilter);
    if (providerFilter) pendingQuery = pendingQuery.eq('provider_id', providerFilter);
    if (!monthFilter && !providerFilter) {
      // Pick up new pending rows AND previously-flagged needs_review rows so
      // a re-run after fixing the override config or raw entry decides them.
      pendingQuery = pendingQuery.in('decision_status', ['pending', 'needs_review']);
    }
    pendingQuery = pendingQuery.range(0, 49999);

    const { data: pendingRows, error: pErr } = await pendingQuery;
    if (pErr) throw new Error(`Pending lookup failed: ${pErr.message}`);

    // Skip historical submissions in the default eval — past months can't be
    // re-decided operationally, and demand_forecast doesn't have rows for
    // them. An explicit ?target_month= bypass remains for backfill.
    const currentMonth = (() => {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    })();

    const groupKeys = new Set<string>();
    for (const r of pendingRows ?? []) {
      if (!r.provider_id || !r.target_month) continue;
      if (!monthFilter && !providerFilter && r.target_month < currentMonth) continue;
      groupKeys.add(`${r.provider_id}|${r.target_month}`);
    }

    if (groupKeys.size === 0) {
      return json({
        ok: true, decision_run_id: decisionRunId, ...counters,
        message: 'No groups with pending submissions',
      });
    }

    // ── Load every submission in those groups ──────────────────────────
    const providerIds = Array.from(new Set(
      Array.from(groupKeys).map(k => k.split('|')[0])
    ));
    const months = Array.from(new Set(
      Array.from(groupKeys).map(k => k.split('|')[1])
    ));
    const publishedLocksByGroup = await loadPublishedShiftLocks(
      supabase,
      providerIds,
      months,
    );
    for (const locks of publishedLocksByGroup.values()) {
      counters.published_locks += locks.length;
      counters.published_lock_hours = roundEval2(
        counters.published_lock_hours + sumLockedHours(locks),
      );
    }

    const { data: subsRaw, error: sErr } = await supabase
      .from('schedule_submissions')
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, decision_run_id, submitted_at, human_review_state')
      .in('provider_id', providerIds)
      .in('target_month', months);
    if (sErr) throw new Error(`Submissions load failed: ${sErr.message}`);

    const submissions = (subsRaw ?? []) as Submission[];
    const submissionsByGroup = new Map<string, Submission[]>();
    for (const s of submissions) {
      if (!s.provider_id) continue;
      const k = `${s.provider_id}|${s.target_month}`;
      if (!groupKeys.has(k)) continue;
      if (!submissionsByGroup.has(k)) submissionsByGroup.set(k, []);
      submissionsByGroup.get(k)!.push(s);
    }

    // ── Preload committed rows before eligibility ─────────────────────
    // Committed rows from providers outside this re-run still consume state
    // demand. Include those providers in the eligibility preload so their
    // accepted hours are split against the same canonical source set.
    let committedRows: CommittedSubmission[] = [];
    if (months.length > 0) {
      const { data: committed, error: cErr } = await supabase
        .from('schedule_submissions')
        .select('id, provider_id, target_month, parsed_shifts, accepted_hours, decision_status')
        .in('target_month', months)
        .in('decision_status', ['accepted', 'partial'])
        .range(0, 49999);
      if (cErr) throw new Error(`Committed submissions load failed: ${cErr.message}`);
      committedRows = (committed ?? []) as CommittedSubmission[];
    }

    const allEligibilityProviderIds = Array.from(new Set([
      ...providerIds,
      ...committedRows
        .map(row => row.provider_id)
        .filter((id): id is string => Boolean(id)),
    ]));

    // ── Preload provider roster metadata ───────────────────────────────
    // The evaluator uses the full license-state view for eligibility, then
    // orders providers by ClinOps priority: clinical leads first, then the
    // lowest active hourly rate regardless of Vitable vs DirectShifts source.
    // Brittney Afram keeps a compatibility key only as a DirectShifts tie-break
    // when rates do not decide. Within each tier, constrained providers still
    // go first.
    const providerProfileByProvider = new Map<string, ProviderProfile>();
    const professionByProvider = new Map<string, string | null>();
    if (allEligibilityProviderIds.length > 0) {
      const { data: provs } = await supabase
        .from('providers')
        .select('id, name, profession, employment_type, source, shift_types')
        .in('id', allEligibilityProviderIds);
      for (const p of (provs ?? []) as ProviderProfile[]) {
        providerProfileByProvider.set(p.id, p);
        professionByProvider.set(p.id, p.profession ?? null);
      }
    }

    const providerRateRowsByProvider = new Map<string, ProviderPayRateRow[]>();
    if (allEligibilityProviderIds.length > 0) {
      const { data: rateRows, error: rateErr } = await supabase
        .from('provider_pay_rates')
        .select('provider_id, hourly_rate, effective_from, effective_to')
        .in('provider_id', allEligibilityProviderIds)
        .range(0, 49999);
      if (rateErr) {
        console.warn(`Provider pay rates load failed; continuing with missing rates: ${rateErr.message}`);
      } else {
        for (const row of (rateRows ?? []) as ProviderPayRateRow[]) {
          if (!row.provider_id) continue;
          if (!providerRateRowsByProvider.has(row.provider_id)) {
            providerRateRowsByProvider.set(row.provider_id, []);
          }
          providerRateRowsByProvider.get(row.provider_id)!.push(row);
        }
      }
    }

    const rateForProviderMonth = (providerId: string, targetMonth: string): number | null => {
      const rows = providerRateRowsByProvider.get(providerId) ?? [];
      let chosen: number | null = null;
      for (const row of rows) {
        const rate = providerHourlyRate({ hourly_rate: row.hourly_rate });
        if (rate == null) continue;
        const effectiveFrom = (row.effective_from ?? '0000-01-01').slice(0, 10);
        const effectiveTo = (row.effective_to ?? '9999-12-31').slice(0, 10);
        if (effectiveFrom > targetMonth || effectiveTo < targetMonth) continue;
        chosen = chosen == null ? rate : Math.min(chosen, rate);
      }
      return chosen;
    };

    const utilizationByProvider = new Map<string, ProviderUtilizationSummary>();
    if (allEligibilityProviderIds.length > 0) {
      const { data: utilizationRows, error: utilizationErr } = await supabase
        .from('provider_utilization')
        .select('profile_id, avg_utilization_pct, window_start, window_end, imported_at')
        .in('profile_id', allEligibilityProviderIds)
        .range(0, 49999);
      if (utilizationErr) {
        console.warn(`Provider utilization load failed; continuing with missing utilization: ${utilizationErr.message}`);
      } else {
        const latestByProvider = new Map<string, ProviderUtilizationRow>();
        for (const row of (utilizationRows ?? []) as ProviderUtilizationRow[]) {
          if (!row.profile_id) continue;
          const utilization = providerUtilizationPct({ utilization_pct: row.avg_utilization_pct });
          if (utilization == null) continue;
          const current = latestByProvider.get(row.profile_id);
          const currentStamp = current?.imported_at ?? current?.window_end ?? current?.window_start ?? '';
          const rowStamp = row.imported_at ?? row.window_end ?? row.window_start ?? '';
          if (!current || rowStamp > currentStamp) latestByProvider.set(row.profile_id, row);
        }
        for (const [providerId, row] of latestByProvider) {
          const utilization = providerUtilizationPct({ utilization_pct: row.avg_utilization_pct });
          if (utilization != null) {
            utilizationByProvider.set(providerId, {
              pct: utilization,
              source: 'provider_utilization',
              basis: 'provider_latest',
              month: row.window_end ?? row.window_start ?? null,
            });
          }
        }
      }
    }

    const providerStateUtilizationRowsByProvider = new Map<string, ProviderStateUtilizationRow[]>();
    const providerStateUtilizationRowsByName = new Map<string, ProviderStateUtilizationRow[]>();
    const providerNameKeysInScope = new Set<string>();
    for (const profile of providerProfileByProvider.values()) {
      const key = canonicalName(profile.name);
      if (key) providerNameKeysInScope.add(key);
    }
    if (providerNameKeysInScope.size > 0 || allEligibilityProviderIds.length > 0) {
      const { data: stateUtilizationRows, error: stateUtilizationErr } = await supabase
        .from('provider_state_utilization')
        .select('provider_id, provider_name, month_date, state, available_count, booked_count, booking_rate_pct, imported_at, synced_at')
        .range(0, 49999);
      if (stateUtilizationErr) {
        console.warn(`Provider-state utilization load failed; falling back to provider utilization: ${stateUtilizationErr.message}`);
      } else {
        for (const row of (stateUtilizationRows ?? []) as ProviderStateUtilizationRow[]) {
          if (row.provider_id && allEligibilityProviderIds.includes(row.provider_id)) {
            if (!providerStateUtilizationRowsByProvider.has(row.provider_id)) {
              providerStateUtilizationRowsByProvider.set(row.provider_id, []);
            }
            providerStateUtilizationRowsByProvider.get(row.provider_id)!.push(row);
          }
          const key = canonicalName(row.provider_name);
          if (key && providerNameKeysInScope.has(key)) {
            if (!providerStateUtilizationRowsByName.has(key)) {
              providerStateUtilizationRowsByName.set(key, []);
            }
            providerStateUtilizationRowsByName.get(key)!.push(row);
          }
        }
      }
    }

    // ── Preload provider-state eligibility from canonical view ─────────
    // The view rolls up ClinOps manual licenses, Medallion API licenses,
    // DirectShifts static licenses, and the Metabase active-state overlay.
    // State scheduling policy still lives here in the evaluator because it is
    // an allocation constraint rather than a license-source fact.
    const licensedStatesByProvider = new Map<string, Set<string>>();
    const licenseSourcesByProviderState = new Map<string, string[]>();
    if (allEligibilityProviderIds.length > 0) {
      const { data: eligibilityRows, error: eligErr } = await supabase
        .from('v_provider_state_eligibility')
        .select('provider_id, state, allocation_eligible, eligibility_status, license_sources, metabase_active')
        .in('provider_id', allEligibilityProviderIds)
        .eq('allocation_eligible', true)
        .range(0, 49999);
      if (eligErr) throw new Error(`Provider-state eligibility load failed: ${eligErr.message}`);

      for (const row of (eligibilityRows ?? []) as ProviderStateEligibilityRow[]) {
        if (!row.provider_id || !row.state || row.allocation_eligible !== true) continue;
        const st = String(row.state).trim().toUpperCase();
        const profession = professionByProvider.get(row.provider_id);
        if (!isSchedulableForState(profession, st)) continue;
        if (!licensedStatesByProvider.has(row.provider_id)) {
          licensedStatesByProvider.set(row.provider_id, new Set());
        }
        licensedStatesByProvider.get(row.provider_id)!.add(st);
        licenseSourcesByProviderState.set(
          `${row.provider_id}|${st}`,
          Array.isArray(row.license_sources) ? row.license_sources : [],
        );
      }
    }

    // ── Preload baseline demand per (state, month) ──────────────────────
    // Reads from v_monthly_demand which pre-aggregates demand_forecast to one
    // row per (state, month). Querying the raw demand_forecast directly hits
    // PostgREST's silent row truncation at ~1,000 rows (a full month is 1,410
    // rows), which previously dropped PA from the result set entirely.
    const demandByKey = new Map<string, number>(); // `${state}_${month}` → total visits
    if (months.length > 0) {
      const { data: rows, error: dErr } = await supabase
        .from('v_monthly_demand')
        .select('state, month, total_visits')
        .in('month', months);
      if (dErr) throw new Error(`Demand load failed: ${dErr.message}`);
      for (const r of rows ?? []) {
        const st = String(r.state).trim().toUpperCase();
        const month = String(r.month);
        const k = `${st}_${month}`;
        demandByKey.set(k, Number(r.total_visits ?? 0));
      }
    }

    // ── Preload MH service-line demand targets ─────────────────────────
    // These are separate from telehealth state demand: MH Coaching and
    // Therapy/LPC each get their own nationwide service-line forecast.
    const serviceLineDemandByKey = new Map<string, number>(); // `${service_line}_${month}` → monthly hours
    if (months.length > 0) {
      const { data: rows, error: slErr } = await supabase
        .from('service_line_demand_targets')
        .select('service_line, month, monthly_hours_target')
        .in('month', months)
        .in('service_line', ['mh_coaching', 'therapy']);
      if (slErr) throw new Error(`Service-line demand load failed: ${slErr.message}`);
      for (const r of (rows ?? []) as ServiceLineDemandTarget[]) {
        if (!r.service_line || !r.month) continue;
        serviceLineDemandByKey.set(
          `${r.service_line}_${r.month}`,
          Number(r.monthly_hours_target ?? 0),
        );
      }
    }

    // ── Preload committed hours from OTHER groups (not in scope) ────────
    const groupKeysInScope = groupKeys;
    const committedByKey = new Map<string, number>(); // `${state}_${month}` → committed hours
    const serviceLineCommittedByKey = new Map<string, number>(); // `${service_line}_${month}` → committed hours
    // Sum accepted_hours per (state, month) for groups NOT being re-evaluated.
    // Best-effort even-split across the provider's canonical eligible states
    // for that month.
    for (const c of committedRows) {
      if (!c.provider_id || !c.target_month) continue;
      const k = `${c.provider_id}|${c.target_month}`;
      if (groupKeysInScope.has(k)) continue;
      const hours = typeof c.accepted_hours === 'number' ? c.accepted_hours : 0;
      if (hours <= 0) continue;
      const committedProfile = providerProfileByProvider.get(c.provider_id);
      const serviceLine = mentalHealthServiceLineForProvider(
        committedProfile?.profession ?? professionByProvider.get(c.provider_id),
        committedProfile?.name,
      );
      if (serviceLine) {
        const serviceLineKey = `${serviceLine}_${c.target_month}`;
        serviceLineCommittedByKey.set(
          serviceLineKey,
          (serviceLineCommittedByKey.get(serviceLineKey) ?? 0) + hours,
        );
        continue;
      }
      const states = licensedStatesByProvider.get(c.provider_id);
      if (!states || states.size === 0) continue;
      const perState = hours / states.size;
      for (const st of states) {
        const key = `${st}_${c.target_month}`;
        committedByKey.set(key, (committedByKey.get(key) ?? 0) + perState);
      }
    }
    // Already-published rows in the groups being re-evaluated are hard locks:
    // they stay on the schedule and consume demand before the allocator fills
    // any remaining gaps. Out-of-scope accepted submissions are still counted
    // through committedRows above, so only add locks for in-scope groups here.
    for (const [lockedGroupKey, lockedRows] of publishedLocksByGroup) {
      if (!groupKeysInScope.has(lockedGroupKey) || lockedRows.length === 0) continue;
      const [lockedProviderId, lockedMonth] = lockedGroupKey.split('|');
      const lockedProfile = providerProfileByProvider.get(lockedProviderId);
      const serviceLine = mentalHealthServiceLineForProvider(
        lockedProfile?.profession ?? professionByProvider.get(lockedProviderId),
        lockedProfile?.name,
      );
      if (serviceLine) {
        const serviceLineKey = `${serviceLine}_${lockedMonth}`;
        serviceLineCommittedByKey.set(
          serviceLineKey,
          roundEval2((serviceLineCommittedByKey.get(serviceLineKey) ?? 0) + sumLockedHours(lockedRows)),
        );
        continue;
      }

      let unassignedHours = 0;
      for (const locked of lockedRows) {
        const hours = numeric(locked.hours);
        if (hours <= 0) continue;
        const state = (locked.assigned_state ?? '').trim().toUpperCase();
        if (state) {
          const demandKey = `${state}_${lockedMonth}`;
          committedByKey.set(demandKey, roundEval2((committedByKey.get(demandKey) ?? 0) + hours));
        } else {
          unassignedHours += hours;
        }
      }

      if (unassignedHours > 0) {
        const states = licensedStatesByProvider.get(lockedProviderId);
        if (states && states.size > 0) {
          const perState = unassignedHours / states.size;
          for (const state of states) {
            const demandKey = `${state}_${lockedMonth}`;
            committedByKey.set(
              demandKey,
              roundEval2((committedByKey.get(demandKey) ?? 0) + perState),
            );
          }
        }
      }
    }

    const stateWeightedUtilizationForProviderMonth = (
      providerId: string,
      targetMonth: string,
    ): ProviderUtilizationSummary | null => {
      const profile = providerProfileByProvider.get(providerId);
      const nameKey = canonicalName(profile?.name);
      const combined = [
        ...(providerStateUtilizationRowsByProvider.get(providerId) ?? []),
        ...(nameKey ? providerStateUtilizationRowsByName.get(nameKey) ?? [] : []),
      ];
      if (combined.length === 0) return null;

      const dedupedByKey = new Map<string, ProviderStateUtilizationRow>();
      for (const row of combined) {
        const state = (row.state ?? '').trim().toUpperCase();
        const month = (row.month_date ?? '').slice(0, 10);
        if (!/^[A-Z]{2}$/.test(state) || !month) continue;
        const providerKey = row.provider_id ?? canonicalName(row.provider_name) ?? '';
        dedupedByKey.set(
          `${providerKey}|${month}|${state}|${row.available_count ?? ''}|${row.booked_count ?? ''}|${row.booking_rate_pct ?? ''}`,
          row,
        );
      }

      const validRows = Array.from(dedupedByKey.values());
      if (validRows.length === 0) return null;
      const rowsBeforeTarget = validRows.filter(row => (row.month_date ?? '').slice(0, 10) <= targetMonth);
      const candidateRows = rowsBeforeTarget.length > 0 ? rowsBeforeTarget : validRows;
      const monthsForRows = candidateRows
        .map(row => (row.month_date ?? '').slice(0, 10))
        .filter(Boolean)
        .sort();
      const latestMonth = monthsForRows[monthsForRows.length - 1];
      if (!latestMonth) return null;

      const licensed = licensedStatesByProvider.get(providerId) ?? new Set<string>();
      const rowsForLatestMonth = candidateRows.filter(row => (row.month_date ?? '').slice(0, 10) === latestMonth);
      const licensedRows = rowsForLatestMonth.filter(row => licensed.has((row.state ?? '').trim().toUpperCase()));
      const rowsForWeighting = licensedRows.length > 0 ? licensedRows : rowsForLatestMonth;

      const byState = new Map<string, { available: number; booked: number; rateSum: number; rateCount: number }>();
      for (const row of rowsForWeighting) {
        const state = (row.state ?? '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(state)) continue;
        const available = Math.max(0, Number(row.available_count ?? 0) || 0);
        const booked = Math.max(0, Number(row.booked_count ?? 0) || 0);
        const pct = providerUtilizationPct({ utilization_pct: row.booking_rate_pct });
        const current = byState.get(state) ?? { available: 0, booked: 0, rateSum: 0, rateCount: 0 };
        current.available += available;
        current.booked += booked;
        if (pct != null) {
          current.rateSum += pct;
          current.rateCount += 1;
        }
        byState.set(state, current);
      }

      let weightedPctSum = 0;
      let totalWeight = 0;
      let totalAvailable = 0;
      let totalBooked = 0;
      for (const [state, stateRow] of byState) {
        const pct = stateRow.available > 0
          ? (stateRow.booked / stateRow.available) * 100
          : stateRow.rateCount > 0
            ? stateRow.rateSum / stateRow.rateCount
            : null;
        if (pct == null || !Number.isFinite(pct)) continue;
        const demandKey = `${state}_${targetMonth}`;
        const demandHours = demandByKey.get(demandKey) ?? 0;
        const committedHours = committedByKey.get(demandKey) ?? 0;
        const gapHours = Math.max(0, demandHours - committedHours);
        const weight = gapHours > 0
          ? gapHours
          : demandHours > 0
            ? demandHours
            : stateRow.available > 0
              ? stateRow.available
              : 1;
        weightedPctSum += pct * weight;
        totalWeight += weight;
        totalAvailable += stateRow.available;
        totalBooked += stateRow.booked;
      }

      if (totalWeight <= 0) return null;
      return {
        pct: roundEval2(weightedPctSum / totalWeight),
        source: 'provider_state_utilization',
        basis: 'state_gap_weighted',
        month: latestMonth,
        stateCount: byState.size,
        availableCount: Math.round(totalAvailable),
        bookedCount: Math.round(totalBooked),
      };
    };

    const utilizationForProviderMonth = (
      providerId: string,
      targetMonth: string,
    ): ProviderUtilizationSummary | null =>
      stateWeightedUtilizationForProviderMonth(providerId, targetMonth)
      ?? utilizationByProvider.get(providerId)
      ?? null;

    const providerProfileForMonth = (
      providerId: string,
      targetMonth: string,
    ): ProviderProfile | undefined => {
      const profile = providerProfileByProvider.get(providerId);
      if (!profile) return undefined;
      const utilization = utilizationForProviderMonth(providerId, targetMonth);
      return {
        ...profile,
        hourly_rate: rateForProviderMonth(providerId, targetMonth),
        utilization_pct: utilization?.pct ?? null,
        utilization_source: utilization?.source ?? null,
        utilization_basis: utilization?.basis ?? null,
        utilization_month: utilization?.month ?? null,
        utilization_state_count: utilization?.stateCount ?? null,
        utilization_available_count: utilization?.availableCount ?? null,
        utilization_booked_count: utilization?.bookedCount ?? null,
      };
    };

    // ── Sort groups by provider priority, then constrained coverage ─────
    // Clinical supervisors get first pass at demand, then lower-rate providers
    // across both internal and DirectShifts/access sources. Utilization is
    // available as an explicit opt-in tie-break, but is off by default. Within each tier, process providers
    // with the fewest licensed-states-with-demand first so single-state
    // providers are not displaced by flexible providers with alternatives.
    const groupKeysSorted = Array.from(submissionsByGroup.keys()).sort((a, b) => {
      const [provA, monthA] = a.split('|');
      const [provB, monthB] = b.split('|');
      const priorityOrder = compareProviderAllocationPriority(
        providerProfileForMonth(provA, monthA),
        providerProfileForMonth(provB, monthB),
        { useUtilization: useUtilizationTieBreak },
      );
      if (priorityOrder !== 0) return priorityOrder;
      const licA = licensedStatesByProvider.get(provA) ?? new Set();
      const licB = licensedStatesByProvider.get(provB) ?? new Set();
      const countWithDemand = (states: Set<string>, month: string) =>
        Array.from(states).filter(s => (demandByKey.get(`${s}_${month}`) ?? 0) > 0).length;
      const cA = countWithDemand(licA, monthA);
      const cB = countWithDemand(licB, monthB);
      if (cA !== cB) return cA - cB;        // fewer licensed-with-demand first
      const nameA = providerProfileByProvider.get(provA)?.name ?? provA;
      const nameB = providerProfileByProvider.get(provB)?.name ?? provB;
      return monthA.localeCompare(monthB) || nameA.localeCompare(nameB);
    });
    const beforeRecalculation = await loadRecalculationSnapshots(supabase, groupKeysSorted);
    const telehealthCandidates: TelehealthAllocationCandidate[] = [];

    // ── Evaluate each group ─────────────────────────────────────────────
    for (const key of groupKeysSorted) {
      const allGroupSubs = submissionsByGroup.get(key)!;
      try {
        counters.groups++;
        const [providerId, targetMonth] = key.split('|');
        const allocationPolicy: SchedulingEquityPolicy = isAugust2026TargetMonth(targetMonth)
          ? 'august_2026'
          : 'legacy_2026_07';

        // Parked/user-rejected and already-superseded submissions should not
        // participate in the "latest wins" computation. Keeping superseded
        // rows in the validation timeline can make a corrected latest
        // submission look broken again on a later full-month recalculation.
        const groupSubs = allGroupSubs.filter(s =>
          s.human_review_state !== 'parked' &&
          s.decision_status !== 'superseded'
        );
        if (groupSubs.length === 0) {
          decisions.push({ group: key, status: 'skipped', reason: 'all_parked' });
          continue;
        }

        // Sort chronologically; latest is the one that carries the decision
        groupSubs.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
        const latest = groupSubs[groupSubs.length - 1];
        const olderIds = groupSubs.slice(0, -1).map(s => s.id);

        if (!providerId) {
          counters.skipped_unmatched_provider++;
          decisions.push({ group: key, status: 'skipped', reason: 'unmatched_provider' });
          continue;
        }

        const providerProfile = providerProfileForMonth(providerId, targetMonth);
        const profession = providerProfile?.profession ?? professionByProvider.get(providerId);
        const providerPriority = providerPriorityFor(providerProfile);
        const isPhysician = isPhysicianProfession(profession);
        const isMentalHealth = isMentalHealthProvider(
          profession,
          providerProfile?.name,
          latest.provider_name,
        );

        // ── Resubmission inbox gating ─────────────────────────────────────
        // If the latest submission is awaiting human review, leave the group's
        // existing decision + shift_recommendations alone. ClinOps will
        // Approve or Park it via the Workbench Inbox tab, after which the
        // next evaluator run picks it up normally.
        if (latest.human_review_state === 'pending') {
          counters.skipped_awaiting_review++;
          decisions.push({
            group: key,
            provider: latest.provider_name,
            target_month: targetMonth,
            status: 'skipped',
            reason: 'awaiting_human_review',
          });
          continue;
        }

        // If the latest hasn't been reviewed yet AND it changes content vs the
        // prior decided submission, flag it for review and skip. The prior
        // submission's decision (and any Homebase-published shifts) are
        // preserved untouched.
        if (
          latest.human_review_state == null &&
          olderIds.length > 0
        ) {
          const prior = groupSubs[groupSubs.length - 2];
          const priorWasDecided =
            prior &&
            prior.decision_status &&
            prior.decision_status !== 'pending' &&
            prior.decision_status !== 'superseded';
          if (priorWasDecided) {
            const sigPrior = shiftsSignature(prior.parsed_shifts ?? null);
            const sigLatest = shiftsSignature(latest.parsed_shifts ?? null);
            if (sigPrior !== sigLatest) {
              const { error: flagErr } = await supabase
                .from('schedule_submissions')
                .update({ human_review_state: 'pending' })
                .eq('id', latest.id);
              if (flagErr) {
                console.warn(`Failed to flag ${latest.id} as pending: ${flagErr.message}`);
              }
              counters.skipped_awaiting_review++;
              decisions.push({
                group: key,
                provider: latest.provider_name,
                target_month: targetMonth,
                status: 'skipped',
                reason: 'flagged_for_review',
              });
              continue;
            }
          }
        }

        // Build merged slot timeline via the shared validation/normalization
        // pipeline. emit-shift-recommendations runs the SAME function with
        // the SAME inputs, so timelines match.
        // Raw submission data on the row is preserved verbatim — we only
        // read it here.
        const validationSelection = validationOptionsForSubmission(latest, isMentalHealth);
        const validation: BuildTimelineResult = buildSubmissionTimeline(
          groupSubs.map(s => ({
            id: s.id,
            submitted_at: s.submitted_at,
            parsed_shifts: s.parsed_shifts ?? null,
          })),
          {
            providerId,
            email: emailFromParsedShifts(latest.parsed_shifts),
            name: latest.provider_name,
          },
          targetMonth,
          validationSelection.options,
        );
        const publishedLocks = publishedLocksByGroup.get(key) ?? [];
        const fullTimeline = filterSlotsOutsidePublishedLocks(validation.timeline, publishedLocks);
        const forecastTimeline = filterSlotsOutsidePublishedLocks(
          validation.forecastTimeline,
          publishedLocks,
        );
        const forecastOutOfHoursTimeline = filterSlotsOutsidePublishedLocks(
          validation.forecastOutOfHoursTimeline,
          publishedLocks,
        );
        const forecastPolicyCutTimeline = filterSlotsOutsidePublishedLocks(
          validation.forecastPolicyCutTimeline,
          publishedLocks,
        );
        const effectiveHours = sumSlotHours(forecastTimeline);
        const lockedPublishedHours = sumLockedHours(publishedLocks);
        // Hours dropped because the slot fell outside the operating-hours
        // window (9a-9p ET weekdays, 9a-12p ET weekends). They count toward
        // declined_hours so the provider sees the full reason their submitted
        // time was not approved.
        const oohDeclined = roundEval2(validation.summary.hours_removed_for_operating_hours ?? 0);
        const policyDeclined = roundEval2(validation.summary.hours_removed_for_minimum_shift ?? 0);

        if (validation.report.length > 0) {
          console.log(`[validation] ${latest.provider_name} ${targetMonth}`,
            JSON.stringify({
              summary: validation.summary,
              report: validation.report,
            }));
        }

        // ── needs_review short-circuit ────────────────────────────────────
        // If validation surfaced intervals that need a human eyeball, do NOT
        // auto-decide the group. The latest submission gets decision_status
        // 'needs_review' with accepted=0 and declined=0; older submissions
        // are still superseded so the audit trail is intact. ClinOps can
        // re-run after the override config or raw entry is fixed.
        const needsReview = validation.summary.intervals_needing_review > 0
          || validation.summary.intervals_rejected > 0;
        if (needsReview) {
          if (olderIds.length) {
            await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by latest submission ${latest.id}`);
            counters.superseded += olderIds.length;
          }
          const reviewReasons = validation.report
            .filter(r => r.needs_manual_review)
            .map(r => `${r.day_of_week ?? r.date ?? ''} ${r.raw_time_range}: ${r.warnings.join('; ')}`)
            .slice(0, 8);
          const reviewNoteParts = [
            `decision=needs_review`,
            `intervals_needing_review=${validation.summary.intervals_needing_review}`,
            `intervals_rejected=${validation.summary.intervals_rejected}`,
            `raw_hours=${validation.summary.raw_total_hours}h`,
            `forecastable_hours=${effectiveHours}h`,
            `reasons=${reviewReasons.join(' | ') || '(see validation_report)'}`,
          ];
          pushProviderPriorityNotes(reviewNoteParts, providerPriority, providerProfile, useUtilizationTieBreak, allocationPolicy);
          pushPublishedLockNoteParts(reviewNoteParts, publishedLocks);
          reviewNoteParts.push(...schedulingAdjustmentNoteParts(validation));
          await writeDecision(supabase, latest.id, {
            status: 'needs_review',
            accepted_hours: 0,
            declined_hours: 0,
            notes: reviewNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          counters.needs_review++;
          decisions.push({
            group: key,
            provider: latest.provider_name,
            target_month: targetMonth,
            status: 'needs_review',
            superseded: olderIds.length,
            validation_summary: validation.summary,
            validation_report: validation.report,
          });
          continue;
        }

        if (effectiveHours <= 0) {
          counters.skipped_no_hours++;
          // Mark older as superseded; latest becomes 'declined' with note
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by ${latest.id}; group has 0 effective hours`);
          const noHoursNoteParts = ['No effective hours in any submission for this provider+month'];
          pushProviderPriorityNotes(noHoursNoteParts, providerPriority, providerProfile, useUtilizationTieBreak, allocationPolicy);
          pushPublishedLockNoteParts(noHoursNoteParts, publishedLocks);
          if (isMentalHealth) {
            noHoursNoteParts.push(
              `mh_preferred_shift_hours=${MH_PREFERRED_SHIFT_HOURS}`,
              `mh_visit_cadence=${MH_VISIT_MINUTES}m_visit+${MH_CHARTING_BUFFER_MINUTES}m_charting_buffer`,
              `mh_ehr_slot_gap_minutes=${MH_EHR_SLOT_GAP_MINUTES}`,
            );
          }
          if (validationSelection.allowOutsideOperatingHours) {
            noHoursNoteParts.push('manual_outside_operating_hours_exception=1');
          }
          if (oohDeclined > 0) {
            noHoursNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          if (policyDeclined > 0) {
            noHoursNoteParts.push(`hours_removed_below_minimum_shift=${policyDeclined}h`);
          }
          noHoursNoteParts.push(...schedulingAdjustmentNoteParts(validation));
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: roundEval2(oohDeclined + policyDeclined),
            notes: noHoursNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          if (
            oohDeclined > 0 ||
            policyDeclined > 0 ||
            forecastOutOfHoursTimeline.length > 0 ||
            validation.forecastPolicyCutTimeline.length > 0
          ) {
            const oohRecRows = buildShiftRecommendationRows({
              providerId,
              providerName: latest.provider_name,
              targetMonth,
              timeline: [],
              forecastTimeline: [],
              outOfHoursTimeline: forecastOutOfHoursTimeline,
              policyCutTimeline: forecastPolicyCutTimeline,
              policyCutReason: isMentalHealth ? MH_POLICY_CUT_REASON : undefined,
              unallocatedForecastPublishReason: isMentalHealth ? MH_PUBLISH_REASON : undefined,
              declinedHours: 0,
              declineAll: false,
              allocations: [],
              decisionRunId,
            });
            await writeShiftRecommendations(supabase, groupSubs.map(s => s.id), oohRecRows);
          }
          counters.declined++;
          counters.superseded += olderIds.length;
          decisions.push({ group: key, provider: latest.provider_name, target_month: targetMonth, status: 'declined', reason: 'no_hours', superseded: olderIds.length });
          continue;
        }

        // ── Mental health service-line allocation ──────────────────────────
        // MH coaching and therapy/LPC use separate service-line forecasts,
        // not the telehealth state-demand pipeline.
        if (isMentalHealth) {
          if (olderIds.length) {
            await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by latest submission ${latest.id}`);
            counters.superseded += olderIds.length;
          }
          const serviceLine = mentalHealthServiceLineForProvider(
            profession,
            providerProfile?.name,
            latest.provider_name,
          );
          if (!serviceLine) {
            throw new Error(`Mental health provider ${latest.provider_name} has no service-line mapping for profession=${profession}`);
          }
          const serviceLineKey = `${serviceLine}_${targetMonth}`;
          const targetHours = serviceLineDemandByKey.get(serviceLineKey);
          const committedHours = roundEval2(serviceLineCommittedByKey.get(serviceLineKey) ?? 0);
          const remainingGap = targetHours == null
            ? effectiveHours
            : roundEval2(Math.max(0, targetHours - committedHours));
          const accepted = targetHours == null
            ? effectiveHours
            : roundEval2(Math.min(effectiveHours, remainingGap));
          const forecastDeclined = roundEval2(Math.max(0, effectiveHours - accepted));
          const mhDeclined = roundEval2(forecastDeclined + oohDeclined + policyDeclined);
          let mhStatus: 'accepted' | 'partial' | 'declined';
          if (accepted <= 0) {
            mhStatus = 'declined';
          } else if (mhDeclined > 0) {
            mhStatus = 'partial';
          } else {
            mhStatus = 'accepted';
          }
          const mhVisitCapacity = Math.floor((accepted * 60) / MH_VISIT_CADENCE_MINUTES);
          const mhNoteParts = [
            `decision=${mhStatus} (mental_health_bypass)`,
            `service_line=${serviceLine}`,
            `service_line_label=${mentalHealthServiceLineLabel(serviceLine)}`,
            `profession=${profession}`,
            `effective_hours=${effectiveHours}h`,
            `accepted_hours=${accepted}h`,
            `raw_hours=${validation.summary.raw_total_hours}h`,
            `mh_visit_length_minutes=${MH_VISIT_MINUTES}`,
            `mh_charting_buffer_minutes=${MH_CHARTING_BUFFER_MINUTES}`,
            `mh_ehr_slot_gap_minutes=${MH_EHR_SLOT_GAP_MINUTES}`,
            `mh_visit_capacity=${mhVisitCapacity}`,
            `mh_preferred_shift_hours=${MH_PREFERRED_SHIFT_HOURS}`,
            'note=MH uses service-line forecast; bypasses telehealth state allocator',
          ];
          pushProviderPriorityNotes(mhNoteParts, providerPriority, providerProfile, useUtilizationTieBreak, allocationPolicy);
          pushPublishedLockNoteParts(mhNoteParts, publishedLocks);
          if (targetHours == null) {
            mhNoteParts.push('service_line_forecast=missing');
          } else {
            mhNoteParts.push(`service_line_target=${roundEval2(targetHours)}h`);
            mhNoteParts.push(`service_line_committed=${committedHours}h`);
            mhNoteParts.push(`service_line_gap=${remainingGap}h`);
            mhNoteParts.push(`forecast_declined_hours=${forecastDeclined}h`);
          }
          if (oohDeclined > 0) {
            mhNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          if (validationSelection.allowOutsideOperatingHours) {
            mhNoteParts.push('manual_outside_operating_hours_exception=1');
          }
          if (policyDeclined > 0) {
            mhNoteParts.push(`hours_removed_below_minimum_shift=${policyDeclined}h`);
          }
          mhNoteParts.push(...schedulingAdjustmentNoteParts(validation));
          await writeDecision(supabase, latest.id, {
            status: mhStatus,
            accepted_hours: accepted,
            declined_hours: mhDeclined,
            notes: mhNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          const mhRecRows = buildShiftRecommendationRows({
            providerId,
            providerName: latest.provider_name,
            targetMonth,
            timeline: fullTimeline,
            forecastTimeline,
            outOfHoursTimeline: forecastOutOfHoursTimeline,
            policyCutTimeline: forecastPolicyCutTimeline,
            policyCutReason: MH_POLICY_CUT_REASON,
            unallocatedForecastPublishReason: MH_PUBLISH_REASON,
            declinedHours: forecastDeclined,
            declineAll: mhStatus === 'declined',
            allocations: [],
            decisionRunId,
          });
          await writeShiftRecommendations(supabase, groupSubs.map(s => s.id), mhRecRows);
          if (mhStatus === 'accepted') counters.accepted++;
          else if (mhStatus === 'partial') counters.partial++;
          else counters.declined++;
          decisions.push({
            group: key,
            provider: latest.provider_name,
            target_month: targetMonth,
            status: mhStatus,
            accepted_hours: accepted,
            declined_hours: mhDeclined,
            mh_bypass: true,
            service_line: serviceLine,
            service_line_target_hours: targetHours ?? null,
            service_line_gap_hours: remainingGap,
            forecast_declined_hours: forecastDeclined,
            mh_visit_capacity: mhVisitCapacity,
            superseded: olderIds.length,
          });
          if (accepted > 0) {
            serviceLineCommittedByKey.set(serviceLineKey, committedHours + accepted);
          }
          continue;
        }

        // Eligible states = provider's licensed states (form has no state field)
        const licensed = licensedStatesByProvider.get(providerId) ?? new Set<string>();
        if (licensed.size === 0) {
          counters.skipped_no_licensed_states++;
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by ${latest.id}; provider has no active licenses`);
          const noLicNoteParts = ['Provider has no allocation-eligible states on file'];
          pushProviderPriorityNotes(noLicNoteParts, providerPriority, providerProfile, useUtilizationTieBreak, allocationPolicy);
          pushPublishedLockNoteParts(noLicNoteParts, publishedLocks);
          if (isPhysician) {
            noLicNoteParts.push('state_policy=physician_reserved_for_md_only');
          }
          if (oohDeclined > 0) {
            noLicNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          if (policyDeclined > 0) {
            noLicNoteParts.push(`hours_removed_below_minimum_shift=${policyDeclined}h`);
          }
          noLicNoteParts.push(...schedulingAdjustmentNoteParts(validation));
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: roundEval2(effectiveHours + oohDeclined + policyDeclined),
            notes: noLicNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          counters.declined++;
          counters.superseded += olderIds.length;
          decisions.push({ group: key, provider: latest.provider_name, target_month: targetMonth, status: 'declined', reason: 'no_licenses', superseded: olderIds.length });
          continue;
        }

        const eligibleSourceSummary = Array.from(licensed)
          .sort()
          .map(st => {
            const sources = licenseSourcesByProviderState.get(`${providerId}|${st}`) ?? [];
            return `${st}:${sources.length ? sources.join('+') : 'unknown'}`;
          });

        // Compute remaining demand-hour gap per state
        const gapByState: Array<{
          state: string;
          gapHours: number;
          baseDemandHours: number;
          bufferedDemandHours: number;
          accessBufferHours: number;
          committedHours: number;
          baseGapHours: number;
          demandHours: number;
          missingDemand: boolean;
        }> = [];
        for (const st of licensed) {
          const dKey = `${st}_${targetMonth}`;
          const visits = demandByKey.get(dKey);
          if (visits === undefined) {
            gapByState.push({
              state: st,
              gapHours: 0,
              baseDemandHours: 0,
              bufferedDemandHours: 0,
              accessBufferHours: 0,
              committedHours: 0,
              baseGapHours: 0,
              demandHours: 0,
              missingDemand: true,
            });
            continue;
          }
          // demand_forecast.projected_visits stores hours of provider
          // availability (column name is legacy/misleading), so the value
          // already IS the base demand hour figure — no conversion.
          const baseDemandHours = visits;
          const bufferedDemandHours = roundEval2(baseDemandHours * ACCESS_GROWTH_BUFFER_MULTIPLIER);
          const committed = committedByKey.get(dKey) ?? 0;
          const baseGapHours = Math.max(0, baseDemandHours - committed);
          gapByState.push({
            state: st,
            gapHours: Math.max(0, bufferedDemandHours - committed),
            baseDemandHours,
            bufferedDemandHours,
            accessBufferHours: Math.max(0, bufferedDemandHours - baseDemandHours),
            committedHours: committed,
            baseGapHours,
            demandHours: bufferedDemandHours,
            missingDemand: false,
          });
        }
        gapByState.sort((a, b) => b.gapHours - a.gapHours);
        const totalGap = roundEval2(gapByState.reduce((s, g) => s + g.gapHours, 0));
        const baseTotalGap = roundEval2(gapByState.reduce((s, g) => s + g.baseGapHours, 0));
        const baseTotalDemand = roundEval2(gapByState.reduce((s, g) => s + g.baseDemandHours, 0));
        const bufferedTotalDemand = roundEval2(gapByState.reduce((s, g) => s + g.bufferedDemandHours, 0));
        const accessBufferHours = roundEval2(Math.max(0, totalGap - baseTotalGap));
        const missingDemandStates = gapByState.filter(g => g.missingDemand).map(g => g.state);
        const scarceCoverageTimeline = forecastTimeline.filter(isScarceCoverageSlot);
        const scarceCoverageHours = sumSlotHours(scarceCoverageTimeline);
        const scarceCoverageWindows = Array.from(new Set(
          scarceCoverageTimeline
            .map(scarceCoverageWindowForSlot)
            .filter((window): window is string => Boolean(window)),
        )).sort();

        telehealthCandidates.push({
          key,
          groupSubs,
          latest,
          olderIds,
          providerId,
          targetMonth,
          providerProfile,
          providerPriority,
          allocationPolicy,
          isAugustDirectShiftsNp: allocationPolicy === 'august_2026' &&
            isAugust2026DirectShiftsNp(providerProfile, latest.provider_name),
          submittedOnTimeForAugust: allocationPolicy === 'august_2026' &&
            isSubmittedByAugust2026Deadline(latest.submitted_at),
          isPhysician,
          validation,
          fullTimeline,
          forecastTimeline,
          forecastOutOfHoursTimeline,
          forecastPolicyCutTimeline,
          effectiveHours,
          publishedLocks,
          lockedPublishedHours,
          oohDeclined,
          policyDeclined,
          eligibleSourceSummary,
          gapByState,
          totalGap,
          baseTotalGap,
          baseTotalDemand,
          bufferedTotalDemand,
          accessBufferHours,
          missingDemandStates,
          scarceCoverageTimeline,
          scarceCoverageHours,
          scarceCoverageWindows,
          equityCohort: equityCohortForProvider(providerPriority, providerProfile),
          equityFloorHours: firstForecastBlockHours(forecastTimeline),
        });
      } catch (e) {
        counters.errors++;
        const message = e instanceof Error ? e.message : String(e);
        decisions.push({ group: key, status: 'error', error: message });
        console.error('Evaluate error', key, message);
      }
    }

    const telehealthByMonth = new Map<string, TelehealthAllocationCandidate[]>();
    for (const candidate of telehealthCandidates) {
      const list = telehealthByMonth.get(candidate.targetMonth) ?? [];
      list.push(candidate);
      telehealthByMonth.set(candidate.targetMonth, list);
    }

    for (const [targetMonth, monthCandidates] of telehealthByMonth) {
      const stateGapMap = new Map<string, SchedulingEquityStateGap>();
      for (const candidate of monthCandidates) {
        for (const gap of candidate.gapByState) {
          if (gap.missingDemand) continue;
          const current = stateGapMap.get(gap.state);
          stateGapMap.set(gap.state, {
            state: gap.state,
            gapHours: roundEval2(Math.max(current?.gapHours ?? 0, gap.gapHours)),
            demandHours: roundEval2(Math.max(current?.demandHours ?? 0, gap.demandHours)),
          });
        }
      }

      const equityInput: SchedulingEquityCandidate[] = monthCandidates.map(candidate => ({
        id: candidate.key,
        providerName: candidate.latest.provider_name,
        cohort: candidate.equityCohort,
        priorityRank: candidate.providerPriority.rank,
        hourlyRate: providerHourlyRate(candidate.providerProfile),
        utilizationPct: candidate.allocationPolicy === 'august_2026'
          ? providerUtilizationPct(candidate.providerProfile)
          : null,
        effectiveHours: candidate.effectiveHours,
        scarceHours: candidate.allocationPolicy === 'august_2026' ? 0 : candidate.scarceCoverageHours,
        floorHours: candidate.allocationPolicy === 'august_2026' ? 0 : candidate.equityFloorHours,
        directShiftsNp: candidate.isAugustDirectShiftsNp,
        submittedOnTime: candidate.submittedOnTimeForAugust,
        eligibleStates: candidate.gapByState
          .filter(gap => !gap.missingDemand)
          .map(gap => ({
            state: gap.state,
            gapHours: gap.gapHours,
            demandHours: gap.demandHours,
          })),
      }));
      const equityAllocationsByKey = new Map(
        allocateSchedulingEquity({
          candidates: equityInput,
          stateGaps: Array.from(stateGapMap.values()),
          policy: isAugust2026TargetMonth(targetMonth) ? 'august_2026' : 'legacy_2026_07',
          fairnessTolerancePct: AUGUST_2026_FAIRNESS_TOLERANCE_PCT,
        }).map(allocation => [allocation.id, allocation]),
      );

      for (const candidate of monthCandidates) {
        try {
          const allocation = equityAllocationsByKey.get(candidate.key);
          if (!allocation) {
            throw new Error(`equity allocation missing for ${candidate.key}`);
          }
          const accepted = roundEval2(allocation.acceptedHours);
          const forecastDeclined = roundEval2(Math.max(0, candidate.effectiveHours - accepted));
          const declined = roundEval2(forecastDeclined + candidate.oohDeclined + candidate.policyDeclined);
          const needsManualReview = Boolean(allocation.manualReviewReason);
          const status: 'accepted' | 'partial' | 'declined' | 'needs_review' =
            needsManualReview ? 'needs_review' : accepted <= 0 ? 'declined' : forecastDeclined <= 0 ? 'accepted' : 'partial';
          const accessBufferUsedHours = roundEval2(Math.max(0, accepted - candidate.baseTotalGap));
          const demandAcceptedHours = roundEval2(Math.max(
            0,
            accepted - Math.min(accepted, candidate.scarceCoverageHours),
          ));

          const noteParts: string[] = [];
          noteParts.push(`decision=${status} (equity_allocation)`);
          noteParts.push(`group_size=${candidate.groupSubs.length}`);
          pushProviderPriorityNotes(
            noteParts,
            candidate.providerPriority,
            candidate.providerProfile,
            useUtilizationTieBreak,
            candidate.allocationPolicy,
          );
          pushPublishedLockNoteParts(noteParts, candidate.publishedLocks);
          pushEquityAllocationNotes(noteParts, allocation, candidate.equityCohort, candidate.allocationPolicy);
          if (candidate.isAugustDirectShiftsNp) {
            noteParts.push(
              `directshifts_np_in_scope=1`,
              `directshifts_np_on_time=${candidate.submittedOnTimeForAugust ? 1 : 0}`,
            );
          }
          if (candidate.isPhysician) {
            noteParts.push('state_policy=physician_reserved_for_md_only');
          }
          noteParts.push(`effective_hours=${candidate.effectiveHours}h`);
          noteParts.push(`raw_hours=${candidate.validation.summary.raw_total_hours}h`);
          if (candidate.validation.summary.intervals_auto_corrected > 0) {
            noteParts.push(`auto_corrected=${candidate.validation.summary.intervals_auto_corrected}`);
          }
          if (candidate.validation.summary.intervals_needing_review > 0) {
            noteParts.push(`needs_review=${candidate.validation.summary.intervals_needing_review}`);
          }
          if (candidate.validation.summary.intervals_rejected > 0) {
            noteParts.push(`rejected=${candidate.validation.summary.intervals_rejected}`);
          }
          if (candidate.validation.summary.hours_removed_for_unavailability > 0) {
            noteParts.push(`hours_removed_unavailable=${candidate.validation.summary.hours_removed_for_unavailability}h`);
          }
          if (candidate.validation.summary.hours_removed_for_duplicates > 0) {
            noteParts.push(`hours_removed_dup=${candidate.validation.summary.hours_removed_for_duplicates}h`);
          }
          if (candidate.oohDeclined > 0) {
            noteParts.push(`hours_removed_outside_business_hours=${candidate.oohDeclined}h`);
          }
          if (candidate.policyDeclined > 0) {
            noteParts.push(`hours_removed_below_minimum_shift=${candidate.policyDeclined}h`);
          }
          noteParts.push(...schedulingAdjustmentNoteParts(candidate.validation));
          if (candidate.scarceCoverageHours > 0) {
            noteParts.push('scarce_window_policy=protected_before_monthly_trim');
            noteParts.push(`scarce_window_hours=${candidate.scarceCoverageHours}h`);
            noteParts.push(`scarce_windows=${candidate.scarceCoverageWindows.join(',')}`);
            if (allocation.scarceOverflowHours > 0) {
              noteParts.push(`scarce_window_over_monthly_gap=${allocation.scarceOverflowHours}h`);
            }
          }
          if (candidate.eligibleSourceSummary.length) {
            noteParts.push(`eligible_sources=${candidate.eligibleSourceSummary.join(',')}`);
          }
          if (ACCESS_GROWTH_BUFFER_MULTIPLIER !== 1 || candidate.accessBufferHours > 0) {
            noteParts.push(`access_growth_buffer_policy=${ACCESS_GROWTH_BUFFER_POLICY}`);
            noteParts.push(`access_growth_buffer_multiplier=${ACCESS_GROWTH_BUFFER_MULTIPLIER}`);
          }
          noteParts.push(`base_total_demand=${candidate.baseTotalDemand}h`);
          noteParts.push(`buffered_total_demand=${candidate.bufferedTotalDemand}h`);
          noteParts.push(`base_total_gap=${candidate.baseTotalGap}h`);
          noteParts.push(`access_buffer_hours=${candidate.accessBufferHours}h`);
          if (accessBufferUsedHours > 0) {
            noteParts.push(`access_buffer_used_hours=${accessBufferUsedHours}h`);
          }
          noteParts.push(`total_gap=${candidate.totalGap}h`);
          noteParts.push(`demand_accepted_hours=${demandAcceptedHours}h`);
          noteParts.push(
            'state_gaps=' + candidate.gapByState.map(g => `${g.state}:${g.missingDemand ? 'no_data' : roundEval2(g.gapHours) + 'h'}`).join(','),
          );
          noteParts.push(
            'base_state_demand=' + candidate.gapByState.map(g => `${g.state}:${g.missingDemand ? 'no_data' : roundEval2(g.baseDemandHours) + 'h'}`).join(','),
          );
          if (allocation.allocations.length) {
            noteParts.push('alloc=' + allocation.allocations.map(a => `${a.state}:${a.hours}h`).join(','));
          }
          if (candidate.missingDemandStates.length) {
            noteParts.push(`missing_demand=${candidate.missingDemandStates.join(',')}`);
          }
          if (candidate.olderIds.length) noteParts.push(`supersedes=${candidate.olderIds.length}`);

          if (candidate.olderIds.length) {
            await markSuperseded(
              supabase,
              candidate.olderIds,
              decisionRunId,
              `Superseded by latest submission ${candidate.latest.id}`,
            );
            counters.superseded += candidate.olderIds.length;
          }

          await writeDecision(supabase, candidate.latest.id, {
            status,
            accepted_hours: needsManualReview ? 0 : accepted,
            declined_hours: needsManualReview ? 0 : declined,
            notes: noteParts.join('; '),
            decision_run_id: decisionRunId,
            validation: candidate.validation,
          });

          if (!needsManualReview) {
            const recRows = buildShiftRecommendationRows({
              providerId: candidate.providerId,
              providerName: candidate.latest.provider_name,
              targetMonth,
              timeline: candidate.fullTimeline,
              forecastTimeline: candidate.forecastTimeline,
              outOfHoursTimeline: candidate.forecastOutOfHoursTimeline,
              policyCutTimeline: candidate.forecastPolicyCutTimeline,
              protectedForecastTimeline: candidate.allocationPolicy === 'august_2026' ? [] : candidate.scarceCoverageTimeline,
              declinedHours: forecastDeclined,
              declineAll: status === 'declined',
              allocations: allocation.allocations,
              decisionRunId,
            });
            await writeShiftRecommendations(supabase, candidate.groupSubs.map(s => s.id), recRows);
          }

          if (status === 'accepted') counters.accepted++;
          else if (status === 'partial') counters.partial++;
          else if (status === 'needs_review') counters.needs_review++;
          else counters.declined++;

          decisions.push({
            group: candidate.key,
            provider: candidate.latest.provider_name,
            target_month: targetMonth,
            group_size: candidate.groupSubs.length,
            superseded: candidate.olderIds.length,
            effective_hours: candidate.effectiveHours,
            locked_published_hours: candidate.lockedPublishedHours,
            total_gap_hours: candidate.totalGap,
            base_total_demand_hours: candidate.baseTotalDemand,
            buffered_total_demand_hours: candidate.bufferedTotalDemand,
            base_total_gap_hours: candidate.baseTotalGap,
            access_buffer_used_hours: accessBufferUsedHours,
            access_growth_buffer_multiplier: ACCESS_GROWTH_BUFFER_MULTIPLIER,
            status,
            accepted_hours: accepted,
            declined_hours: declined,
            allocations: allocation.allocations,
            provider_priority: candidate.providerPriority.key,
            cohort: candidate.equityCohort,
            directshifts_target_share: allocation.directshiftsTargetShare,
            directshifts_actual_share: allocation.directshiftsShareAfter,
            provider_acceptance_pct: allocation.providerAcceptancePct,
            proportional_fairness_tolerance_pct: allocation.fairnessTolerancePct ?? null,
            directshifts_np_in_scope: candidate.isAugustDirectShiftsNp,
            directshifts_np_on_time: candidate.submittedOnTimeForAugust,
            overflow_hours: allocation.overflowHours ?? null,
            manual_review_reason: allocation.manualReviewReason ?? null,
            equity_floor: allocation.equityFloor,
            soft_cap_exceeded: allocation.softCapExceeded,
            fairness_policy_version: FAIRNESS_POLICY_VERSION,
            state_policy: candidate.isPhysician ? 'physician_reserved_for_md_only' : 'standard',
            scarce_window_hours: candidate.scarceCoverageHours,
            scarce_windows: candidate.scarceCoverageWindows,
            scarce_window_over_monthly_gap: allocation.scarceOverflowHours,
            validation_summary: candidate.validation.summary,
            validation_report: candidate.validation.report,
          });

          if (accepted > 0 && allocation.allocations.length) {
            for (const a of allocation.allocations) {
              const dKey = `${a.state}_${targetMonth}`;
              committedByKey.set(dKey, (committedByKey.get(dKey) ?? 0) + a.hours);
            }
          }
        } catch (e) {
          counters.errors++;
          const message = e instanceof Error ? e.message : String(e);
          decisions.push({ group: candidate.key, status: 'error', error: message });
          console.error('Evaluate equity allocation error', candidate.key, message);
        }
      }
    }

    try {
      const afterRecalculation = await loadRecalculationSnapshots(supabase, groupKeysSorted);
      await writeRecalculationHistory(supabase, {
        decisionRunId,
        groupKeys: groupKeysSorted,
        before: beforeRecalculation,
        after: afterRecalculation,
        counters,
        decisions,
      });
    } catch (historyErr) {
      console.warn(
        'scheduling_recalculation_history write failed:',
        historyErr instanceof Error ? historyErr.message : String(historyErr),
      );
    }

    return json({ ok: true, decision_run_id: decisionRunId, ...counters, decisions });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), decision_run_id: decisionRunId, ...counters }, 500);
  }
});

// ── Recalculation history ────────────────────────────────────────────────
type RecalculationSnapshot = {
  key: string;
  providerId: string;
  providerName: string;
  targetMonth: string;
  status: string | null;
  decisionAcceptedHours: number;
  decisionDeclinedHours: number;
  decisionNotes: string | null;
  publishableHours: number;
  cutHours: number;
  publishableShifts: number;
  cutShifts: number;
  allocations: Array<{ state: string; hours: number }>;
};

type RecalculationHistoryArgs = {
  decisionRunId: string;
  groupKeys: string[];
  before: Map<string, RecalculationSnapshot>;
  after: Map<string, RecalculationSnapshot>;
  counters: Record<string, number>;
  decisions: Array<Record<string, unknown>>;
};

type RecalculationShiftRow = {
  provider_id: string | null;
  provider_name: string | null;
  target_month: string | null;
  recommendation: string | null;
  hours: number | string | null;
  assigned_state: string | null;
};

const snapshotKeyFor = (providerId: string, targetMonth: string) =>
  `${providerId}|${targetMonth}`;

function emptySnapshot(providerId: string, targetMonth: string): RecalculationSnapshot {
  return {
    key: snapshotKeyFor(providerId, targetMonth),
    providerId,
    providerName: providerId,
    targetMonth,
    status: null,
    decisionAcceptedHours: 0,
    decisionDeclinedHours: 0,
    decisionNotes: null,
    publishableHours: 0,
    cutHours: 0,
    publishableShifts: 0,
    cutShifts: 0,
    allocations: [],
  };
}

function chooseActiveSubmission(rows: Submission[]): Submission | null {
  const sorted = [...rows].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  return sorted.find(row => row.decision_status !== 'superseded') ?? sorted[0] ?? null;
}

async function loadRecalculationSnapshots(
  supabase: SupabaseClientAny,
  groupKeys: string[],
): Promise<Map<string, RecalculationSnapshot>> {
  const snapshots = new Map<string, RecalculationSnapshot>();
  if (groupKeys.length === 0) return snapshots;

  const providerIds = Array.from(new Set(groupKeys.map(k => k.split('|')[0])));
  const months = Array.from(new Set(groupKeys.map(k => k.split('|')[1])));
  for (const key of groupKeys) {
    const [providerId, targetMonth] = key.split('|');
    snapshots.set(key, emptySnapshot(providerId, targetMonth));
  }

  const { data: submissionRows, error: subErr } = await supabase
    .from('schedule_submissions')
    .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, decision_run_id, submitted_at, human_review_state')
    .in('provider_id', providerIds)
    .in('target_month', months)
    .range(0, 49999);
  if (subErr) throw new Error(`history submissions snapshot failed: ${subErr.message}`);

  const submissionsByKey = new Map<string, Submission[]>();
  for (const row of (submissionRows ?? []) as Submission[]) {
    if (!row.provider_id || !row.target_month) continue;
    const key = snapshotKeyFor(row.provider_id, row.target_month);
    if (!snapshots.has(key)) continue;
    const list = submissionsByKey.get(key) ?? [];
    list.push(row);
    submissionsByKey.set(key, list);
  }

  for (const [key, rows] of submissionsByKey) {
    const active = chooseActiveSubmission(rows);
    if (!active || !active.provider_id) continue;
    const snapshot = snapshots.get(key) ?? emptySnapshot(active.provider_id, active.target_month);
    snapshot.providerName = active.provider_name || snapshot.providerName;
    snapshot.status = active.decision_status ?? null;
    snapshot.decisionAcceptedHours = roundEval2(Number(active.accepted_hours ?? 0));
    snapshot.decisionDeclinedHours = roundEval2(Number(active.declined_hours ?? 0));
    snapshot.decisionNotes = active.decision_notes ?? null;
    snapshots.set(key, snapshot);
  }

  const { data: shiftRows, error: shiftErr } = await supabase
    .from('shift_recommendations')
    .select('provider_id, provider_name, target_month, recommendation, hours, assigned_state')
    .in('provider_id', providerIds)
    .in('target_month', months)
    .range(0, 49999);
  if (shiftErr) throw new Error(`history shift snapshot failed: ${shiftErr.message}`);

  const allocationMaps = new Map<string, Map<string, number>>();
  for (const row of (shiftRows ?? []) as RecalculationShiftRow[]) {
    if (!row.provider_id || !row.target_month) continue;
    const key = snapshotKeyFor(row.provider_id, String(row.target_month));
    const snapshot = snapshots.get(key);
    if (!snapshot) continue;
    snapshot.providerName = row.provider_name || snapshot.providerName;
    const hours = Number(row.hours ?? 0);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    if (row.recommendation === 'publish') {
      snapshot.publishableHours = roundEval2(snapshot.publishableHours + hours);
      snapshot.publishableShifts += 1;
      const state = (row.assigned_state ?? '').trim().toUpperCase();
      if (state) {
        const stateMap = allocationMaps.get(key) ?? new Map<string, number>();
        stateMap.set(state, roundEval2((stateMap.get(state) ?? 0) + hours));
        allocationMaps.set(key, stateMap);
      }
    } else if (row.recommendation === 'cut') {
      snapshot.cutHours = roundEval2(snapshot.cutHours + hours);
      snapshot.cutShifts += 1;
    }
  }

  for (const [key, stateMap] of allocationMaps) {
    const snapshot = snapshots.get(key);
    if (!snapshot) continue;
    snapshot.allocations = Array.from(stateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([state, hours]) => ({ state, hours: roundEval2(hours) }));
  }

  return snapshots;
}

const allocationSignature = (allocations: Array<{ state: string; hours: number }>) =>
  allocations.map(a => `${a.state}:${roundEval2(a.hours)}`).join('|');

function recalculationSnapshotChanged(
  before: RecalculationSnapshot,
  after: RecalculationSnapshot,
): boolean {
  return (
    before.status !== after.status ||
    Math.abs(before.decisionAcceptedHours - after.decisionAcceptedHours) > 0.05 ||
    Math.abs(before.decisionDeclinedHours - after.decisionDeclinedHours) > 0.05 ||
    Math.abs(before.publishableHours - after.publishableHours) > 0.05 ||
    Math.abs(before.cutHours - after.cutHours) > 0.05 ||
    before.publishableShifts !== after.publishableShifts ||
    before.cutShifts !== after.cutShifts ||
    allocationSignature(before.allocations) !== allocationSignature(after.allocations)
  );
}

function summarizeDecisionForHistory(decision: Record<string, unknown>) {
  return {
    provider: decision.provider ?? null,
    target_month: decision.target_month ?? null,
    status: decision.status ?? null,
    reason: decision.reason ?? null,
    error: decision.error ?? null,
    accepted_hours: decision.accepted_hours ?? null,
    declined_hours: decision.declined_hours ?? null,
    service_line: decision.service_line ?? null,
  };
}

async function writeRecalculationHistory(
  supabase: SupabaseClientAny,
  args: RecalculationHistoryArgs,
) {
  const monthKeys = new Set(args.groupKeys.map(key => key.split('|')[1]));
  const allChanges = args.groupKeys
    .map(key => {
      const before = args.before.get(key);
      const after = args.after.get(key);
      if (!before || !after || !recalculationSnapshotChanged(before, after)) return null;
      return { before, after };
    })
    .filter((row): row is { before: RecalculationSnapshot; after: RecalculationSnapshot } => Boolean(row));

  for (const targetMonth of monthKeys) {
    const changes = allChanges.filter(change => change.after.targetMonth === targetMonth);
    const groupCount = args.groupKeys.filter(key => key.endsWith(`|${targetMonth}`)).length;
    const decisionAcceptedDelta = roundEval2(
      changes.reduce((sum, change) => sum + (change.after.decisionAcceptedHours - change.before.decisionAcceptedHours), 0),
    );
    const decisionDeclinedDelta = roundEval2(
      changes.reduce((sum, change) => sum + (change.after.decisionDeclinedHours - change.before.decisionDeclinedHours), 0),
    );
    const publishableDelta = roundEval2(
      changes.reduce((sum, change) => sum + (change.after.publishableHours - change.before.publishableHours), 0),
    );
    const cutDelta = roundEval2(
      changes.reduce((sum, change) => sum + (change.after.cutHours - change.before.cutHours), 0),
    );

    const { data: runRow, error: runErr } = await supabase
      .from('scheduling_recalculation_runs')
      .upsert(
        {
          decision_run_id: args.decisionRunId,
          target_month: targetMonth,
          groups_count: groupCount,
          changed_provider_count: changes.length,
          decision_accepted_delta_hours: decisionAcceptedDelta,
          decision_declined_delta_hours: decisionDeclinedDelta,
          publishable_delta_hours: publishableDelta,
          cut_delta_hours: cutDelta,
          result_summary: {
            counters: args.counters,
            decisions: args.decisions
              .filter(decision => decision.target_month === targetMonth)
              .map(summarizeDecisionForHistory),
          },
        },
        { onConflict: 'decision_run_id,target_month' },
      )
      .select('id')
      .single();
    if (runErr) throw new Error(`recalculation run history insert failed: ${runErr.message}`);
    const runId = (runRow as { id?: string } | null)?.id;
    if (!runId || changes.length === 0) continue;

    const rows = changes.map(({ before, after }) => ({
      run_id: runId,
      decision_run_id: args.decisionRunId,
      target_month: targetMonth,
      provider_id: after.providerId,
      provider_name: after.providerName,
      before_status: before.status,
      after_status: after.status,
      decision_accepted_before: before.decisionAcceptedHours,
      decision_accepted_after: after.decisionAcceptedHours,
      decision_accepted_delta: roundEval2(after.decisionAcceptedHours - before.decisionAcceptedHours),
      decision_declined_before: before.decisionDeclinedHours,
      decision_declined_after: after.decisionDeclinedHours,
      decision_declined_delta: roundEval2(after.decisionDeclinedHours - before.decisionDeclinedHours),
      publishable_hours_before: before.publishableHours,
      publishable_hours_after: after.publishableHours,
      publishable_hours_delta: roundEval2(after.publishableHours - before.publishableHours),
      cut_hours_before: before.cutHours,
      cut_hours_after: after.cutHours,
      cut_hours_delta: roundEval2(after.cutHours - before.cutHours),
      publishable_shifts_before: before.publishableShifts,
      publishable_shifts_after: after.publishableShifts,
      cut_shifts_before: before.cutShifts,
      cut_shifts_after: after.cutShifts,
      before_allocations: before.allocations,
      after_allocations: after.allocations,
      reason: after.decisionNotes ?? before.decisionNotes,
    }));

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error: changeErr } = await supabase
        .from('scheduling_recalculation_changes')
        .insert(chunk);
      if (changeErr) throw new Error(`recalculation change history insert failed: ${changeErr.message}`);
    }
  }
}

// ── DB writes ─────────────────────────────────────────────────────────────
async function writeDecision(
  supabase: SupabaseClientAny,
  submissionId: string,
  decision: {
    status: 'accepted' | 'partial' | 'declined' | 'needs_review';
    accepted_hours: number;
    declined_hours: number;
    notes: string;
    decision_run_id: string;
    validation: BuildTimelineResult;
  },
) {
  const { summary } = decision.validation;
  const normalizedSlots = decision.validation.timeline.map(s => ({
    date: s.date,
    start_min: s.startMin,
    end_min: s.endMin,
    hours: roundEval2((s.endMin - s.startMin) / 60),
    kind: s.source.kind,
    source_submission_id: s.source.submissionId ?? null,
    correction_reason: s.source.correction_reason,
    validation_status: s.source.validation_status,
    scheduling_adjustments: (s as { schedulingAdjustments?: unknown }).schedulingAdjustments ?? [],
  }));
  const validationWarnings = Array.from(new Set(
    decision.validation.report.flatMap(r => r.warnings),
  ));

  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      decision_status: decision.status,
      accepted_hours: decision.accepted_hours,
      declined_hours: decision.declined_hours,
      decision_notes: decision.notes,
      decided_at: new Date().toISOString(),
      decision_run_id: decision.decision_run_id,
      validation_status: validationStatusForGroup(decision.status, summary),
      raw_requested_hours: summary.raw_total_hours,
      normalized_requested_hours: summary.normalized_total_hours,
      effective_hours_used_for_forecast: summary.final_approvable_hours,
      validation_warnings: validationWarnings,
      normalized_slots: normalizedSlots,
      intervals_auto_corrected: summary.intervals_auto_corrected,
      intervals_needing_review: summary.intervals_needing_review,
      hours_removed_for_unavailability: summary.hours_removed_for_unavailability,
      hours_removed_for_duplicates: summary.hours_removed_for_duplicates,
      hours_changed_by_validation: summary.hours_changed_by_validation,
      validation_summary: summary,
    })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);
}

function validationStatusForGroup(
  decisionStatus: 'accepted' | 'partial' | 'declined' | 'needs_review',
  summary: BuildTimelineResult['summary'],
): string {
  if (decisionStatus === 'needs_review') return 'needs_review';
  if (summary.intervals_rejected > 0) return 'partially_rejected';
  if (summary.intervals_auto_corrected > 0) return 'auto_corrected';
  return 'valid';
}

type PreservedPublishState = {
  publish_status: string;
  published_at: string | null;
  published_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
  homebase_shift_id: string | null;
};

type ShiftRecommendationWriteRow = Omit<ShiftRecommendationRow, 'publish_status'> & {
  publish_status: string;
  published_at?: string | null;
  published_by?: string | null;
  ehr_posted_at?: string | null;
  ehr_posted_by?: string | null;
  homebase_shift_id?: string | null;
};

const shiftKey = (r: {
  submission_id: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  shift_type: string;
}) =>
  `${r.submission_id}|${r.shift_date}|${r.start_min}|${r.end_min}|${r.shift_type}`;

const recommendationOverlapsPublishedLock = (
  row: ShiftRecommendationRow,
  lock: PublishedShiftLockRow,
) => {
  if (!row.provider_id || row.provider_id !== lock.provider_id) return false;
  if (row.target_month !== String(lock.target_month ?? '').slice(0, 10)) return false;
  if (row.shift_date !== String(lock.shift_date ?? '').slice(0, 10)) return false;
  const lockStart = numeric(lock.start_min);
  const lockEnd = numeric(lock.end_min);
  return lockStart < row.end_min && row.start_min < lockEnd;
};

function assertUniqueShiftRecommendationRows(rows: ShiftRecommendationRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = shiftKey(row);
    if (seen.has(key)) {
      throw new Error(`duplicate shift_recommendations row generated for ${key}`);
    }
    seen.add(key);
  }
}

async function writeShiftRecommendations(
  supabase: SupabaseClientAny,
  submissionIds: string[],
  rows: ShiftRecommendationRow[],
) {
  assertUniqueShiftRecommendationRows(rows);

  // Snapshot the existing publish state for this group BEFORE we wipe, so a
  // re-run of the evaluator doesn't reset Sarabjeet's "Posted to Homebase /
  // EHR" progress. We carry the state forward onto any freshly emitted shift
  // whose natural identity (submission + date + start/end + type) matches.
  // Shifts that no longer exist in the new emission lose their state — that's
  // intentional: the schedule changed, and Sarabjeet would need to re-publish.
  const { data: priorRows, error: priorErr } = await supabase
    .from('shift_recommendations')
    .select(
      'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, hours, shift_type, assigned_state, recommendation, publish_status, published_at, published_by, ehr_posted_at, ehr_posted_by, homebase_shift_id',
    )
    .in('submission_id', submissionIds);
  if (priorErr) {
    throw new Error(`failed to read prior shift_recommendations: ${priorErr.message}`);
  }

  const priorByKey = new Map<string, typeof priorRows[number]>();
  for (const r of priorRows ?? []) priorByKey.set(shiftKey(r), r);
  const lockedPriorRows = ((priorRows ?? []) as PublishedShiftLockRow[])
    .filter(row => row.recommendation === 'publish' && isLockedPublishStatus(row.publish_status));

  const unlockedPriorIds = (priorRows ?? [])
    .filter(row => !isLockedPublishStatus(row.publish_status))
    .map(row => row.id)
    .filter(Boolean);
  if (unlockedPriorIds.length > 0) {
    const { error: deleteErr } = await supabase
      .from('shift_recommendations')
      .delete({ count: 'exact' })
      .in('id', unlockedPriorIds);
    if (deleteErr) {
      throw new Error(`shift_recommendations delete failed: ${deleteErr.message}`);
    }
  }

  if (rows.length === 0) return;

  // Preserve onto matching new rows.
  const preservedAuditEntries: Record<string, unknown>[] = [];
  const merged: ShiftRecommendationWriteRow[] = [];
  for (const row of rows) {
    const overlappingLock = lockedPriorRows.find(lock =>
      recommendationOverlapsPublishedLock(row, lock),
    );
    if (overlappingLock) {
      preservedAuditEntries.push({
        shift_recommendation_id: overlappingLock.id,
        submission_id: overlappingLock.submission_id,
        provider_id: overlappingLock.provider_id,
        provider_name: overlappingLock.provider_name,
        target_month: overlappingLock.target_month,
        shift_date: overlappingLock.shift_date,
        start_min: overlappingLock.start_min,
        end_min: overlappingLock.end_min,
        shift_type: overlappingLock.shift_type,
        step: 'homebase',
        action: 'preserved',
        actor_label: 'evaluator re-run',
        notes: `Locked published shift preserved; skipped overlapping recalculated row for submission ${row.submission_id}`,
      });
      if (overlappingLock.publish_status === 'confirmed' || overlappingLock.ehr_posted_at) {
        preservedAuditEntries.push({
          shift_recommendation_id: overlappingLock.id,
          submission_id: overlappingLock.submission_id,
          provider_id: overlappingLock.provider_id,
          provider_name: overlappingLock.provider_name,
          target_month: overlappingLock.target_month,
          shift_date: overlappingLock.shift_date,
          start_min: overlappingLock.start_min,
          end_min: overlappingLock.end_min,
          shift_type: overlappingLock.shift_type,
          step: 'ehr',
          action: 'preserved',
          actor_label: 'evaluator re-run',
          notes: `Locked EHR-confirmed shift preserved; skipped overlapping recalculated row for submission ${row.submission_id}`,
        });
      }
      continue;
    }
    const prior = priorByKey.get(shiftKey(row));
    if (!prior) {
      merged.push(row);
      continue;
    }
    const carry: PreservedPublishState = {
      publish_status: prior.publish_status,
      published_at: prior.published_at,
      published_by: prior.published_by,
      ehr_posted_at: prior.ehr_posted_at,
      ehr_posted_by: prior.ehr_posted_by,
      homebase_shift_id: prior.homebase_shift_id,
    };
    if (carry.publish_status === 'published_to_homebase' || carry.publish_status === 'confirmed') {
      preservedAuditEntries.push({
        submission_id: row.submission_id,
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        target_month: row.target_month,
        shift_date: row.shift_date,
        start_min: row.start_min,
        end_min: row.end_min,
        shift_type: row.shift_type,
        step: 'homebase',
        action: 'preserved',
        actor_label: 'evaluator re-run',
        notes: `Carried forward from prior shift ${prior.id}`,
      });
    }
    if (carry.publish_status === 'confirmed' || carry.ehr_posted_at) {
      preservedAuditEntries.push({
        submission_id: row.submission_id,
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        target_month: row.target_month,
        shift_date: row.shift_date,
        start_min: row.start_min,
        end_min: row.end_min,
        shift_type: row.shift_type,
        step: 'ehr',
        action: 'preserved',
        actor_label: 'evaluator re-run',
        notes: `Carried forward from prior shift ${prior.id}`,
      });
    }
    merged.push({ ...row, ...carry });
  }

  const CHUNK = 500;
  for (let i = 0; i < merged.length; i += CHUNK) {
    const chunk = merged.slice(i, i + CHUNK);
    const { error } = await supabase.from('shift_recommendations').insert(chunk);
    if (error) throw new Error(`shift_recommendations insert failed: ${error.message}`);
  }

  // Best-effort audit. We log preservation events so it's traceable when
  // someone wonders why a published-to-Homebase shift is still checked after
  // a re-evaluation (or, if it isn't, why not).
  if (preservedAuditEntries.length > 0) {
    for (let i = 0; i < preservedAuditEntries.length; i += CHUNK) {
      const chunk = preservedAuditEntries.slice(i, i + CHUNK);
      const { error: auditErr } = await supabase.from('publish_audit_log').insert(chunk);
      if (auditErr) {
        // Don't fail the whole evaluator on a logging failure.
        console.warn('publish_audit_log preservation insert failed:', auditErr.message);
      }
    }
  }
}

async function markSuperseded(
  supabase: SupabaseClientAny,
  ids: string[],
  decisionRunId: string,
  note: string,
) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      decision_status: 'superseded',
      accepted_hours: 0,
      declined_hours: 0,
      decision_notes: note,
      decided_at: new Date().toISOString(),
      decision_run_id: decisionRunId,
    })
    .in('id', ids);
  if (error) throw new Error(error.message);
  const { data: rows, error: rowErr } = await supabase
    .from('shift_recommendations')
    .select('id, publish_status')
    .in('submission_id', ids);
  if (rowErr) {
    throw new Error(`failed to read superseded shift_recommendations: ${rowErr.message}`);
  }
  const deletableIds = (rows ?? [])
    .filter(row => !isLockedPublishStatus(row.publish_status))
    .map(row => row.id)
    .filter(Boolean);
  if (deletableIds.length > 0) {
    const { error: recErr } = await supabase
      .from('shift_recommendations')
      .delete({ count: 'exact' })
      .in('id', deletableIds);
    if (recErr) {
      throw new Error(`failed to delete superseded shift_recommendations: ${recErr.message}`);
    }
  }
}

function roundEval2(n: number): number {
  return Math.round(n * 100) / 100;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
