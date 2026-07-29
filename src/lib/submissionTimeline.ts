/**
 * Shared pipeline that turns a group of `schedule_submissions` rows
 * (provider + target_month) into:
 *   - the canonical normalized slot timeline (post override / AM-PM
 *     correction, dedup, unavailable subtraction)
 *   - a forecast-only sub-timeline (telehealth kinds by default)
 *   - a deterministic set of shift_recommendations rows
 *
 * Both `evaluate-schedule-submissions` and `emit-shift-recommendations`
 * MUST call this module so the two stages produce the exact same slots
 * and shift rec rows. Drift between them previously caused decisions to
 * cite hours that didn't match what was emitted to Homebase.
 *
 * IMPORTANT: This file is mirrored at
 *   supabase/functions/_shared/submissionTimeline.ts
 * for Deno edge-function consumption. Keep the two in sync.
 */

import {
  findProviderOverride,
  normalizeProviderAvailability,
  type ExpandedSlot,
  type IntervalKind,
  type NormalizationInput,
  type NormalizationResult,
  type RawInterval,
  type ValidationConfig,
  type ProviderIdentity,
} from '@/lib/availabilityValidation';

/** Shape of `schedule_submissions.parsed_shifts` produced by sync-jotform-submissions. */
export interface ParsedShiftsBlob {
  recurring_virtual?: unknown;
  one_off_virtual?: unknown;
  in_home_clinic?: unknown;
  unavailable_dates?: unknown;
  email?: string;
  [k: string]: unknown;
}

export interface SubmissionRow {
  id: string;
  submitted_at: string;
  parsed_shifts: ParsedShiftsBlob | null;
}

/**
 * Default kinds counted toward `final_approvable_hours`. In-home/clinic
 * shifts are staffed under a separate scope and capacity model, so they
 * do not consume telehealth demand-hour gaps. Override via
 * `forecastKinds` when the caller knows otherwise.
 */
export const TELEHEALTH_FORECAST_KINDS: IntervalKind[] = ['recurring', 'one_off'];

export type ShiftType = 'virtual_recurring' | 'virtual_oneoff' | 'in_home_clinic';

export const LONG_SHIFT_BREAK_POLICY = 'mandatory_1_hour_break_for_12h_shift';
export const PROVIDER_MEETING_BLACKOUT_WINDOW =
  '2026-06-24T12:00:00-05:00/2026-06-24T13:00:00-05:00';
const LONG_SHIFT_BREAK_MINUTES = 60;
const LONG_SHIFT_BREAK_THRESHOLD_MINUTES = 12 * 60;
const PROVIDER_MEETING_BLACKOUT_DATE = '2026-06-24';
const PROVIDER_MEETING_BLACKOUT_START_MIN = 12 * 60;
const PROVIDER_MEETING_BLACKOUT_END_MIN = 13 * 60;
const PROVIDER_MEETING_BLACKOUT_REASON =
  'Monthly provider meeting; do not schedule providers during this hour.';
const LONG_SHIFT_BREAK_REASON =
  'Provider submitted 12-hour availability; system added a required 1-hour break.';

export type SchedulingAdjustmentType = 'long_shift_break' | 'provider_meeting_blackout';

export interface SchedulingAdjustment {
  type: SchedulingAdjustmentType;
  date: string;
  originalStartMin: number;
  originalEndMin: number;
  startMin: number;
  endMin: number;
  hoursRemoved: number;
  reason: string;
  policy?: string;
  blackoutWindow?: string;
  originalShiftHours?: number;
  scheduledHoursAfterBreak?: number;
}

export interface SchedulingAdjustmentSummary {
  all: SchedulingAdjustment[];
  longShiftBreaks: SchedulingAdjustment[];
  providerMeetingBlackouts: SchedulingAdjustment[];
  hours_removed_for_long_shift_breaks: number;
  hours_removed_for_provider_meeting_blackouts: number;
}

type AdjustedSlot = ExpandedSlot & {
  schedulingAdjustments?: SchedulingAdjustment[];
};

export interface ShiftRecommendationRow {
  submission_id: string;
  provider_id: string;
  provider_name: string;
  target_month: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  hours: number;
  shift_type: ShiftType;
  assigned_state: string | null;
  recommendation: 'publish' | 'cut';
  recommendation_reason: string;
  decision_run_id: string;
  publish_status: 'pending';
}

export interface BuildTimelineOptions {
  forecastKinds?: IntervalKind[];
  config?: ValidationConfig;
}

export interface BuildTimelineResult extends NormalizationResult {
  summary: NormalizationResult['summary'] & {
    hours_removed_for_long_shift_breaks: number;
    hours_removed_for_provider_meeting_blackouts: number;
  };
  /** Subset of `timeline` filtered by forecastKinds (default = telehealth). */
  forecastTimeline: ExpandedSlot[];
  /** Subset of `outOfHoursTimeline` filtered by forecastKinds. In-home /
   *  clinic shifts are not subject to the operating-hours window so they
   *  never appear here. */
  forecastOutOfHoursTimeline: ExpandedSlot[];
  /** Subset of `policyCutTimeline` filtered by forecastKinds. */
  forecastPolicyCutTimeline: ExpandedSlot[];
  /** Mandatory scheduling-layer removals applied after availability validation. */
  schedulingAdjustments: SchedulingAdjustmentSummary;
  /** Confirmed provider-specific unavailable ranges ignored before expansion. */
  unavailableDateOverrides: UnavailableDateOverrideUse[];
}

export interface UnavailableDateOverrideUse {
  startDate: string;
  endDate: string;
  reason?: string;
}

/**
 * Run a group of submissions through the validation/normalization pipeline.
 * Both consumers must use this so the timelines match.
 */
export function buildSubmissionTimeline(
  submissions: SubmissionRow[],
  identity: ProviderIdentity,
  targetMonth: string,
  options: BuildTimelineOptions = {},
): BuildTimelineResult {
  const forecastKinds = options.forecastKinds ?? TELEHEALTH_FORECAST_KINDS;

  // Sort chronologically (later wins on overlap inside the validator).
  const ordered = [...submissions].sort((a, b) =>
    a.submitted_at.localeCompare(b.submitted_at),
  );

  const unavailableDateResolution = collectUnavailableDateResolution(ordered, identity);
  const unavailableDates = unavailableDateResolution.dates;

  const input: NormalizationInput = {
    identity,
    submissions: ordered.map(s => ({
      submissionId: s.id,
      submittedAt: s.submitted_at,
      intervals: extractRawIntervalsFromParsedShifts(s.parsed_shifts),
    })),
    targetMonth,
    unavailableDates,
    forecastKinds,
    config: options.config,
  };

  const forecastSet = new Set(forecastKinds);
  const result = normalizeProviderAvailability(input);
  const adjusted = applySchedulingRules(result.timeline);
  const editedTimeline = applyPerDateShiftEdits(adjusted.timeline, identity);
  const summary = {
    ...result.summary,
    total_normalized_timeline_hours: roundSubmission2(sumHours(editedTimeline)),
    final_approvable_hours: roundSubmission2(editedTimeline.reduce(
      (sum, s) => forecastSet.has(s.source.kind)
        ? sum + (s.endMin - s.startMin) / 60
        : sum,
      0,
    )),
    hours_removed_for_long_shift_breaks:
      adjusted.summary.hours_removed_for_long_shift_breaks,
    hours_removed_for_provider_meeting_blackouts:
      adjusted.summary.hours_removed_for_provider_meeting_blackouts,
  };
  const forecastTimeline = editedTimeline.filter(s => forecastSet.has(s.source.kind));
  const forecastOutOfHoursTimeline = result.outOfHoursTimeline.filter(s =>
    forecastSet.has(s.source.kind),
  );
  const forecastPolicyCutTimeline = result.policyCutTimeline.filter(s =>
    forecastSet.has(s.source.kind),
  );
  return {
    ...result,
    timeline: editedTimeline,
    summary,
    forecastTimeline,
    forecastOutOfHoursTimeline,
    forecastPolicyCutTimeline,
    schedulingAdjustments: adjusted.summary,
    unavailableDateOverrides: unavailableDateResolution.ignoredRanges,
  };
}

/** Parse "10:00 AM" / "3:15 PM" / "14:30" into minutes-from-midnight. */
function parseClockToMinutes(s: string): number | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const ampm = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = parseInt(ampm[2], 10);
    const pm = ampm[3].toUpperCase() === 'PM';
    if (h === 12) h = 0;
    if (pm) h += 12;
    return h * 60 + min;
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
  return null;
}

/** Apply provider-specific per-date shift-window edits (admin overrides for
 *  a single calendar date). Replaces every slot on the matched date with the
 *  new window; preserves source linkage for audit/reporting. */
function applyPerDateShiftEdits(
  slots: ExpandedSlot[],
  identity: ProviderIdentity,
): ExpandedSlot[] {
  const override = findProviderOverride(identity);
  const edits = override?.perDateShiftEdits;
  if (!edits || edits.length === 0) return slots;
  const byDate = new Map<string, { startMin: number; endMin: number }>();
  for (const e of edits) {
    const startMin = parseClockToMinutes(e.newStart);
    const endMin = parseClockToMinutes(e.newEnd);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    byDate.set(e.date, { startMin, endMin });
  }
  if (byDate.size === 0) return slots;
  return slots.map(slot => {
    const edit = byDate.get(slot.date);
    if (!edit) return slot;
    return { ...slot, startMin: edit.startMin, endMin: edit.endMin };
  });
}

export function extractRawIntervalsFromParsedShifts(parsed: ParsedShiftsBlob | null): RawInterval[] {
  if (!parsed) return [];
  const out: RawInterval[] = [];
  for (const e of parseWidgetArray(parsed.recurring_virtual)) {
    if (!e['Start Time (ET)'] || !e['End Time (ET)']) continue;
    out.push({
      kind: 'recurring',
      dayOfWeek: e['Day of Week'],
      rawStart: e['Start Time (ET)'],
      rawEnd: e['End Time (ET)'],
    });
  }
  for (const e of parseWidgetArray(parsed.one_off_virtual)) {
    const date = parseFormDate(e['Date']);
    if (!date || !e['Start Time (ET)'] || !e['End Time (ET)']) continue;
    out.push({
      kind: 'one_off',
      date,
      rawStart: e['Start Time (ET)'],
      rawEnd: e['End Time (ET)'],
    });
  }
  for (const e of parseWidgetArray(parsed.in_home_clinic)) {
    const date = parseFormDate(e['Date']);
    if (!date || !e['Start Time (ET)'] || !e['End Time (ET)']) continue;
    out.push({
      kind: 'in_home',
      date,
      rawStart: e['Start Time (ET)'],
      rawEnd: e['End Time (ET)'],
    });
  }
  return out;
}

export function emailFromParsedShifts(parsed: ParsedShiftsBlob | null): string | null {
  if (!parsed) return null;
  const e = parsed.email;
  return typeof e === 'string' && e.trim() ? e.trim() : null;
}

export function collectUnavailableDates(
  submissions: SubmissionRow[],
  identity?: ProviderIdentity,
): string[] {
  return collectUnavailableDateResolution(submissions, identity).dates;
}

function collectUnavailableDateResolution(
  submissions: SubmissionRow[],
  identity?: ProviderIdentity,
): { dates: string[]; ignoredRanges: UnavailableDateOverrideUse[] } {
  // We take the union of all listed unavailable dates across submissions in
  // the group: a provider who lists 6/15 off in their first submission and
  // forgets to re-list it in a resubmission still shouldn't be scheduled
  // there. ClinOps confirmed this is the desired behavior.
  //
  // The Jotform "When will you be unavailable to work?" widget stores rows
  // with `Start Date` / `End Date` columns and supports inclusive date
  // ranges (e.g. 06-06-2026 → 06-08-2026 means three off days). We expand
  // each range and also accept a single `Date` value as a fallback for any
  // legacy entry shape.
  const out = new Set<string>();
  const ignoredRanges: UnavailableDateOverrideUse[] = [];
  const providerOverride = identity ? findProviderOverride(identity) : null;
  for (const sub of submissions) {
    const parsed = sub.parsed_shifts;
    if (!parsed) continue;
    for (const e of parseWidgetArray(parsed.unavailable_dates)) {
      const start = parseFormDate(e['Start Date'] ?? e['Date']);
      const end = parseFormDate(e['End Date']) ?? start;
      if (!start) continue;
      const ignored = matchIgnoredUnavailableRange(
        start,
        end ?? start,
        providerOverride?.ignoredUnavailableDateRanges,
      );
      if (ignored) {
        ignoredRanges.push(ignored);
        continue;
      }
      for (const d of expandDateRange(start, end ?? start)) out.add(d);
    }
  }
  return { dates: Array.from(out), ignoredRanges };
}

function matchIgnoredUnavailableRange(
  start: string,
  end: string,
  ignoredRanges?: Array<{ startDate: string; endDate?: string; reason?: string }>,
): UnavailableDateOverrideUse | null {
  for (const range of ignoredRanges ?? []) {
    const rangeStart = parseFormDate(range.startDate) ?? range.startDate;
    const rangeEnd = parseFormDate(range.endDate) ?? range.endDate ?? rangeStart;
    if (rangeStart === start && rangeEnd === end) {
      return { startDate: start, endDate: end, reason: range.reason };
    }
  }
  return null;
}

export function parseAllocationsFromNotes(notes: string): Array<{ state: string; hours: number }> {
  const allocStr = notes.match(/alloc=([^;]+)/);
  if (!allocStr) return [];
  const out: Array<{ state: string; hours: number }> = [];
  const re = /([A-Z]{2}):([0-9.]+)h/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allocStr[1])) !== null) {
    const hours = Number(m[2]);
    if (Number.isFinite(hours) && hours > 0) out.push({ state: m[1], hours });
  }
  return out;
}

export interface BuildShiftRecommendationsArgs {
  providerId: string;
  providerName: string;
  targetMonth: string;
  /** Full normalized timeline (all kinds). */
  timeline: ExpandedSlot[];
  /** Subset of timeline that participates in forecast cut budget. */
  forecastTimeline: ExpandedSlot[];
  /** Forecast slots protected from monthly oversupply trims. */
  protectedForecastTimeline?: ExpandedSlot[];
  /** Out-of-business-hours fragments (telehealth only). Each is emitted as
   *  its own `cut` row with reason "outside operating hours". They are
   *  not part of the forecast cut budget — they were already removed from
   *  `final_approvable_hours` upstream. */
  outOfHoursTimeline?: ExpandedSlot[];
  /** Policy-rejected fragments from configured hard validation rules. */
  policyCutTimeline?: ExpandedSlot[];
  policyCutReason?: string;
  unallocatedForecastPublishReason?: string;
  declinedHours: number;
  /** True if the entire forecast timeline should be cut (declined decision). */
  declineAll: boolean;
  allocations: Array<{ state: string; hours: number }>;
  decisionRunId: string;
}

const OUT_OF_HOURS_REASON =
  'Cut — outside operating hours window (9a–9p ET weekdays, 9a–12p ET weekends)';
const POLICY_CUT_REASON = 'Cut — below minimum shift length policy';

const FRIDAY_SCARCE_START_MIN = 12 * 60;
const OPERATIONAL_BLOCK_MINUTES = 30;

export function scarceCoverageWindowForSlot(slot: Pick<ExpandedSlot, 'date' | 'endMin'>): string | null {
  const day = dayOfWeekUtc(slot.date);
  if (day === 0) return 'sunday';
  if (day === 6) return 'saturday';
  if (day === 5 && slot.endMin > FRIDAY_SCARCE_START_MIN) return 'friday_pm';
  return null;
}

export function isScarceCoverageSlot(slot: Pick<ExpandedSlot, 'date' | 'endMin'>): boolean {
  return scarceCoverageWindowForSlot(slot) !== null;
}

function roundCutMinutesToOperationalBlock(cutMinutes: number, slotMinutes: number): number {
  if (cutMinutes <= 0) return 0;
  if (cutMinutes >= slotMinutes) return slotMinutes;
  const rounded = Math.round(cutMinutes / OPERATIONAL_BLOCK_MINUTES) * OPERATIONAL_BLOCK_MINUTES;
  if (rounded <= 0) return Math.min(OPERATIONAL_BLOCK_MINUTES, slotMinutes);
  if (rounded >= slotMinutes) return slotMinutes;
  return rounded;
}

function snapToOperationalWindow(
  startMin: number,
  endMin: number,
): { startMin: number; endMin: number } | null {
  const snappedStart = Math.ceil(startMin / OPERATIONAL_BLOCK_MINUTES) * OPERATIONAL_BLOCK_MINUTES;
  const snappedEnd = Math.floor(endMin / OPERATIONAL_BLOCK_MINUTES) * OPERATIONAL_BLOCK_MINUTES;
  if (snappedEnd <= snappedStart) return null;
  return { startMin: snappedStart, endMin: snappedEnd };
}

function dayOfWeekUtc(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Cut/publish row generator shared by evaluator and emitter.
 *
 * Forecast slots (recurring_virtual / virtual_oneoff) participate in the
 * cut budget: latest-first, cut until `declinedHours` is approximately
 * satisfied using 30-minute operational boundaries. Protected forecast slots
 * are skipped by monthly oversupply trims, which lets the evaluator preserve
 * scarce coverage windows before cutting less useful hours. In-home/clinic
 * slots are not in the forecast scope, so they are always `publish` and don't
 * consume the cut budget.
 *
 * Out-of-hours fragments (passed via `outOfHoursTimeline`) are emitted as
 * their own `cut` rows so the workbench surfaces hours declined for being
 * outside business hours alongside other cuts.
 */
export function buildShiftRecommendationRows(args: BuildShiftRecommendationsArgs): ShiftRecommendationRow[] {
  const outOfHours = args.outOfHoursTimeline ?? [];
  const policyCuts = args.policyCutTimeline ?? [];
  if (args.timeline.length === 0 && outOfHours.length === 0 && policyCuts.length === 0) return [];

  const forecastSlots = new Set(args.forecastTimeline);
  const protectedForecastSlots = new Set(args.protectedForecastTimeline ?? []);
  const cutBudgetTotal = args.declineAll
    ? sumHours(args.forecastTimeline)
    : Math.max(0, args.declinedHours);

  // Walk forecast slots latest-first to allocate cuts. For partial trims,
  // protected slots are skipped so scarce coverage windows survive the cut.
  const cutCandidates = args.declineAll
    ? args.forecastTimeline
    : args.forecastTimeline.filter(slot => !protectedForecastSlots.has(slot));
  const sortedDesc = [...cutCandidates].sort((a, b) =>
    b.date.localeCompare(a.date) || b.startMin - a.startMin,
  );
  const cutTailMinutes = new Map<ExpandedSlot, number>();
  let remainingCutMinutes = Math.max(0, Math.round(cutBudgetTotal * 60));
  for (const slot of sortedDesc) {
    if (remainingCutMinutes <= 0) break;
    const slotMinutes = Math.max(0, slot.endMin - slot.startMin);
    const cutMinutes = roundCutMinutesToOperationalBlock(
      Math.min(slotMinutes, remainingCutMinutes),
      slotMinutes,
    );
    if (cutMinutes > 0) {
      cutTailMinutes.set(slot, cutMinutes);
      remainingCutMinutes -= cutMinutes;
    }
  }

  // Buckets for state assignment, only consumed by published forecast slots.
  const buckets = new Map<string, number>(args.allocations.map(a => [a.state, a.hours]));

  const makeRow = (
    slot: ExpandedSlot,
    startMin: number,
    endMin: number,
    recommendation: 'publish' | 'cut',
    assignedState: string | null,
    reason: string,
  ): ShiftRecommendationRow => ({
    submission_id: slot.source.submissionId ?? '',
    provider_id: args.providerId,
    provider_name: args.providerName,
    target_month: args.targetMonth,
    shift_date: slot.date,
    start_min: startMin,
    end_min: endMin,
    hours: roundSubmission2((endMin - startMin) / 60),
    shift_type: kindToShiftType(slot.source.kind),
    assigned_state: assignedState,
    recommendation,
    recommendation_reason: appendSchedulingAdjustmentReasons(reason, slot),
    decision_run_id: args.decisionRunId,
    publish_status: 'pending',
  });

  const makePublishRows = (
    slot: ExpandedSlot,
    startMin: number,
    endMin: number,
    assignedState: string | null,
    reason: string,
  ): ShiftRecommendationRow[] => {
    const window = snapToOperationalWindow(startMin, endMin);
    if (!window) return [];
    return [
      makeRow(slot, window.startMin, window.endMin, 'publish', assignedState, reason),
    ];
  };

  const bestBucket = () => {
    let bestState: string | null = null;
    let bestRemaining = 0;
    for (const [state, remaining] of buckets) {
      if (remaining > bestRemaining) {
        bestState = state;
        bestRemaining = remaining;
      }
    }
    return { state: bestState, remaining: bestRemaining };
  };

  const publishForecastSegment = (
    slot: ExpandedSlot,
    startMin: number,
    endMin: number,
    isProtected: boolean,
  ): ShiftRecommendationRow[] => {
    const { state, remaining } = bestBucket();
    if (!state || remaining <= 0.001) {
      if (args.allocations.length === 0 && args.unallocatedForecastPublishReason) {
        return makePublishRows(slot, startMin, endMin, null, args.unallocatedForecastPublishReason);
      }
      const reason = isProtected
        ? (args.unallocatedForecastPublishReason ?? 'Publish (scarce coverage window; no state allocation, review manually)')
        : 'Cut as state-specific surplus — no remaining state allocation';
      return isProtected
        ? makePublishRows(slot, startMin, endMin, null, reason)
        : [makeRow(slot, startMin, endMin, 'cut', null, reason)];
    }

    const window = snapToOperationalWindow(startMin, endMin);
    if (!window) return [];
    const segmentHours = roundSubmission2((window.endMin - window.startMin) / 60);
    const overAllocatedHours = roundSubmission2(Math.max(0, segmentHours - remaining));
    const intactSuffix = overAllocatedHours > 0
      ? `; whole shift kept intact although it exceeds remaining ${state} allocation by ${overAllocatedHours}h`
      : '';
    const reason = isProtected
      ? `Publish to ${state} (scarce coverage window protected before monthly demand trim${intactSuffix})`
      : `Publish to ${state} (largest remaining state gap at time of allocation; state allocation is planning math only${intactSuffix})`;
    buckets.set(state, roundSubmission2(remaining - segmentHours));
    return makePublishRows(slot, window.startMin, window.endMin, state, reason);
  };

  const timelineRows = args.timeline.flatMap(slot => {
    const isForecastSlot = forecastSlots.has(slot);
    const isProtected = isForecastSlot && protectedForecastSlots.has(slot);

    if (!isForecastSlot) {
      return makePublishRows(
        slot,
        slot.startMin,
        slot.endMin,
        null,
        'Publish (in-home/clinic — not part of telehealth forecast scope)',
      );
    }

    const cutMinutes = cutTailMinutes.get(slot) ?? 0;
    const publishEndMin = Math.max(slot.startMin, slot.endMin - cutMinutes);
    const rows: ShiftRecommendationRow[] = [];

    if (publishEndMin > slot.startMin) {
      rows.push(...publishForecastSegment(slot, slot.startMin, publishEndMin, isProtected));
    }
    if (cutMinutes > 0) {
      const reason = args.declineAll
        ? 'Declined — no demand-hour gap remained in any licensed state when allocator processed this provider'
        : 'Trimmed as oversupply — accepted hours capped at network demand';
      rows.push(makeRow(slot, publishEndMin, slot.endMin, 'cut', null, reason));
    }
    return rows;
  });

  const outOfHoursRows: ShiftRecommendationRow[] = outOfHours.map(slot => ({
    submission_id: slot.source.submissionId ?? '',
    provider_id: args.providerId,
    provider_name: args.providerName,
    target_month: args.targetMonth,
    shift_date: slot.date,
    start_min: slot.startMin,
    end_min: slot.endMin,
    hours: roundSubmission2((slot.endMin - slot.startMin) / 60),
    shift_type: kindToShiftType(slot.source.kind),
    assigned_state: null,
    recommendation: 'cut',
    recommendation_reason: OUT_OF_HOURS_REASON,
    decision_run_id: args.decisionRunId,
    publish_status: 'pending',
  }));

  const policyCutRows: ShiftRecommendationRow[] = policyCuts.map(slot => ({
    submission_id: slot.source.submissionId ?? '',
    provider_id: args.providerId,
    provider_name: args.providerName,
    target_month: args.targetMonth,
    shift_date: slot.date,
    start_min: slot.startMin,
    end_min: slot.endMin,
    hours: roundSubmission2((slot.endMin - slot.startMin) / 60),
    shift_type: kindToShiftType(slot.source.kind),
    assigned_state: null,
    recommendation: 'cut',
    recommendation_reason: args.policyCutReason ?? POLICY_CUT_REASON,
    decision_run_id: args.decisionRunId,
    publish_status: 'pending',
  }));

  return [...timelineRows, ...outOfHoursRows, ...policyCutRows].sort((a, b) =>
    a.shift_date.localeCompare(b.shift_date) || a.start_min - b.start_min,
  );
}

export function kindToShiftType(kind: IntervalKind): ShiftType {
  if (kind === 'recurring') return 'virtual_recurring';
  if (kind === 'in_home') return 'in_home_clinic';
  return 'virtual_oneoff';
}

function applySchedulingRules(slots: ExpandedSlot[]): {
  timeline: ExpandedSlot[];
  summary: SchedulingAdjustmentSummary;
} {
  const longShiftBreaks: SchedulingAdjustment[] = [];
  const providerMeetingBlackouts: SchedulingAdjustment[] = [];
  const out: AdjustedSlot[] = [];

  for (const slot of slots) {
    const blackoutAdjusted = applyProviderMeetingBlackout(slot);
    if (blackoutAdjusted.adjustment) {
      providerMeetingBlackouts.push(blackoutAdjusted.adjustment);
    }

    for (const blackoutSlot of blackoutAdjusted.slots) {
      const breakAdjusted = applyLongShiftBreak(blackoutSlot);
      if (breakAdjusted.adjustment) {
        longShiftBreaks.push(breakAdjusted.adjustment);
      }
      out.push(...breakAdjusted.slots);
    }
  }

  const all = [...longShiftBreaks, ...providerMeetingBlackouts].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.startMin - b.startMin ||
    a.endMin - b.endMin ||
    a.type.localeCompare(b.type),
  );

  return {
    timeline: out.sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMin - b.startMin ||
      a.endMin - b.endMin,
    ),
    summary: {
      all,
      longShiftBreaks,
      providerMeetingBlackouts,
      hours_removed_for_long_shift_breaks: roundSubmission2(sumAdjustmentHours(longShiftBreaks)),
      hours_removed_for_provider_meeting_blackouts: roundSubmission2(sumAdjustmentHours(providerMeetingBlackouts)),
    },
  };
}

function applyProviderMeetingBlackout(slot: ExpandedSlot): {
  slots: AdjustedSlot[];
  adjustment: SchedulingAdjustment | null;
} {
  if (slot.date !== PROVIDER_MEETING_BLACKOUT_DATE) {
    return { slots: [slot as AdjustedSlot], adjustment: null };
  }
  const overlapStart = Math.max(slot.startMin, PROVIDER_MEETING_BLACKOUT_START_MIN);
  const overlapEnd = Math.min(slot.endMin, PROVIDER_MEETING_BLACKOUT_END_MIN);
  if (overlapEnd <= overlapStart) {
    return { slots: [slot as AdjustedSlot], adjustment: null };
  }

  const adjustment: SchedulingAdjustment = {
    type: 'provider_meeting_blackout',
    date: slot.date,
    originalStartMin: slot.startMin,
    originalEndMin: slot.endMin,
    startMin: overlapStart,
    endMin: overlapEnd,
    hoursRemoved: roundSubmission2((overlapEnd - overlapStart) / 60),
    reason: PROVIDER_MEETING_BLACKOUT_REASON,
    blackoutWindow: PROVIDER_MEETING_BLACKOUT_WINDOW,
  };

  const parts: AdjustedSlot[] = [];
  if (slot.startMin < overlapStart) {
    parts.push(withSchedulingAdjustment({ ...slot, endMin: overlapStart }, adjustment));
  }
  if (overlapEnd < slot.endMin) {
    parts.push(withSchedulingAdjustment({ ...slot, startMin: overlapEnd }, adjustment));
  }

  return { slots: parts, adjustment };
}

function applyLongShiftBreak(slot: ExpandedSlot): {
  slots: AdjustedSlot[];
  adjustment: SchedulingAdjustment | null;
} {
  const durationMin = slot.endMin - slot.startMin;
  if (durationMin < LONG_SHIFT_BREAK_THRESHOLD_MINUTES) {
    return { slots: [slot as AdjustedSlot], adjustment: null };
  }

  const firstWorkMinutes = Math.floor(((durationMin - LONG_SHIFT_BREAK_MINUTES) / 2) / 30) * 30;
  const breakStart = slot.startMin + firstWorkMinutes;
  const breakEnd = breakStart + LONG_SHIFT_BREAK_MINUTES;
  const adjustment: SchedulingAdjustment = {
    type: 'long_shift_break',
    date: slot.date,
    originalStartMin: slot.startMin,
    originalEndMin: slot.endMin,
    startMin: breakStart,
    endMin: breakEnd,
    hoursRemoved: 1,
    reason: LONG_SHIFT_BREAK_REASON,
    policy: LONG_SHIFT_BREAK_POLICY,
    originalShiftHours: roundSubmission2(durationMin / 60),
    scheduledHoursAfterBreak: roundSubmission2((durationMin - LONG_SHIFT_BREAK_MINUTES) / 60),
  };

  const slots: AdjustedSlot[] = [];
  if (slot.startMin < breakStart) {
    slots.push(withSchedulingAdjustment({ ...slot, endMin: breakStart }, adjustment));
  }
  if (breakEnd < slot.endMin) {
    slots.push(withSchedulingAdjustment({ ...slot, startMin: breakEnd }, adjustment));
  }

  return { slots, adjustment };
}

function withSchedulingAdjustment(slot: ExpandedSlot, adjustment: SchedulingAdjustment): AdjustedSlot {
  const prior = (slot as AdjustedSlot).schedulingAdjustments ?? [];
  return { ...slot, schedulingAdjustments: [...prior, adjustment] };
}

function appendSchedulingAdjustmentReasons(reason: string, slot: ExpandedSlot): string {
  const additions = schedulingAdjustmentReasonLines(slot);
  if (additions.length === 0) return reason;
  return [reason, ...additions].join('; ');
}

function schedulingAdjustmentReasonLines(slot: ExpandedSlot): string[] {
  const adjustments = (slot as AdjustedSlot).schedulingAdjustments ?? [];
  const lines: string[] = [];
  for (const adjustment of adjustments) {
    if (adjustment.type === 'long_shift_break') {
      lines.push(
        `Mandatory 1-hour break applied (${formatSubmissionClock24(adjustment.startMin)}-${formatSubmissionClock24(adjustment.endMin)} ET); ` +
        `${adjustment.scheduledHoursAfterBreak ?? 11} schedulable hours from the original ${adjustment.originalShiftHours ?? 12}-hour block`,
      );
    } else if (adjustment.type === 'provider_meeting_blackout') {
      lines.push(
        `Provider meeting blackout removed ${formatSubmissionClock24(adjustment.startMin)}-${formatSubmissionClock24(adjustment.endMin)} ET`,
      );
    }
  }
  return Array.from(new Set(lines));
}

// ─── Local widget helpers ────────────────────────────────────────────────

function parseWidgetArray(raw: unknown): Record<string, string>[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is Record<string, string> => e != null && typeof e === 'object');
}

function parseFormDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function expandDateRange(startISO: string, endISO: string): string[] {
  // Inclusive expansion in UTC to avoid DST drift.
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  let cur = Date.UTC(sy, sm - 1, sd);
  const last = Date.UTC(ey, em - 1, ed);
  if (!Number.isFinite(cur) || !Number.isFinite(last) || last < cur) {
    return [startISO];
  }
  const out: string[] = [];
  const DAY = 86_400_000;
  while (cur <= last) {
    const d = new Date(cur);
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    );
    cur += DAY;
  }
  return out;
}

function sumHours(slots: ExpandedSlot[]): number {
  return slots.reduce((s, x) => s + (x.endMin - x.startMin) / 60, 0);
}

function sumAdjustmentHours(adjustments: SchedulingAdjustment[]): number {
  return adjustments.reduce((sum, adjustment) => sum + adjustment.hoursRemoved, 0);
}

function formatSubmissionClock24(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function roundSubmission2(n: number): number {
  return Math.round(n * 100) / 100;
}
