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
  normalizeProviderAvailability,
  type ExpandedSlot,
  type IntervalKind,
  type NormalizationInput,
  type NormalizationResult,
  type RawInterval,
  type ValidationConfig,
  type ProviderIdentity,
} from './availabilityValidation.ts';

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
  /** Subset of `timeline` filtered by forecastKinds (default = telehealth). */
  forecastTimeline: ExpandedSlot[];
  /** Subset of `outOfHoursTimeline` filtered by forecastKinds. In-home /
   *  clinic shifts are not subject to the operating-hours window so they
   *  never appear here. */
  forecastOutOfHoursTimeline: ExpandedSlot[];
  /** Subset of `policyCutTimeline` filtered by forecastKinds. */
  forecastPolicyCutTimeline: ExpandedSlot[];
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

  const unavailableDates = collectUnavailableDates(ordered);

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

  const result = normalizeProviderAvailability(input);
  const forecastSet = new Set(forecastKinds);
  const forecastTimeline = result.timeline.filter(s => forecastSet.has(s.source.kind));
  const forecastOutOfHoursTimeline = result.outOfHoursTimeline.filter(s =>
    forecastSet.has(s.source.kind),
  );
  const forecastPolicyCutTimeline = result.policyCutTimeline.filter(s =>
    forecastSet.has(s.source.kind),
  );
  return { ...result, forecastTimeline, forecastOutOfHoursTimeline, forecastPolicyCutTimeline };
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

export function collectUnavailableDates(submissions: SubmissionRow[]): string[] {
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
  for (const sub of submissions) {
    const parsed = sub.parsed_shifts;
    if (!parsed) continue;
    for (const e of parseWidgetArray(parsed.unavailable_dates)) {
      const start = parseFormDate(e['Start Date'] ?? e['Date']);
      const end = parseFormDate(e['End Date']) ?? start;
      if (!start) continue;
      for (const d of expandDateRange(start, end ?? start)) out.add(d);
    }
  }
  return Array.from(out);
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
  /** Policy-rejected fragments, e.g. MH blocks shorter than 2.5h. */
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

function dayOfWeekUtc(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Cut/publish row generator shared by evaluator and emitter.
 *
 * Forecast slots (recurring_virtual / virtual_oneoff) participate in the
 * cut budget: latest-first, cut until `declinedHours` is satisfied. Protected
 * forecast slots are skipped by monthly oversupply trims, which lets the
 * evaluator preserve scarce coverage windows before cutting less useful hours.
 * In-home/clinic slots are not in the forecast scope, so they are always
 * `publish` and don't consume the cut budget.
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
  const cutSet = new Set<ExpandedSlot>();
  let remainingCut = round2(cutBudgetTotal);
  for (const slot of sortedDesc) {
    if (remainingCut <= 0.001) break;
    cutSet.add(slot);
    remainingCut = round2(remainingCut - (slot.endMin - slot.startMin) / 60);
  }

  // Buckets for state assignment, only consumed by published forecast slots.
  const buckets = new Map<string, number>(args.allocations.map(a => [a.state, a.hours]));

  const timelineRows = args.timeline.map(slot => {
    const slotHours = round2((slot.endMin - slot.startMin) / 60);
    const isForecastSlot = forecastSlots.has(slot);
    const isCut = isForecastSlot && cutSet.has(slot);
    const isProtected = isForecastSlot && protectedForecastSlots.has(slot);

    let assignedState: string | null = null;
    let reason: string;

    if (isCut) {
      reason = args.declineAll
        ? 'Declined — no demand-hour gap remained in any licensed state when allocator processed this provider'
        : 'Trimmed as oversupply — accepted hours capped at network demand';
    } else if (!isForecastSlot) {
      // In-home / clinic shifts: not part of the telehealth forecast.
      reason = 'Publish (in-home/clinic — not part of telehealth forecast scope)';
    } else {
      let bestState: string | null = null;
      let bestRemaining = -1;
      for (const [state, remaining] of buckets) {
        if (remaining > bestRemaining) {
          bestState = state;
          bestRemaining = remaining;
        }
      }
      assignedState = bestState;
      if (bestState) {
        buckets.set(bestState, round2((buckets.get(bestState) ?? 0) - slotHours));
      }
      if (isProtected) {
        reason = bestState
          ? `Publish to ${bestState} (scarce coverage window protected before monthly demand trim)`
          : (args.unallocatedForecastPublishReason ?? 'Publish (scarce coverage window; no state allocation, review manually)');
      } else {
        reason = bestState
          ? `Publish to ${bestState} (largest remaining state gap at time of allocation)`
          : (args.unallocatedForecastPublishReason ?? 'Publish (no state allocation; review manually)');
      }
    }

    return {
      submission_id: slot.source.submissionId ?? '',
      provider_id: args.providerId,
      provider_name: args.providerName,
      target_month: args.targetMonth,
      shift_date: slot.date,
      start_min: slot.startMin,
      end_min: slot.endMin,
      hours: slotHours,
      shift_type: kindToShiftType(slot.source.kind),
      assigned_state: assignedState,
      recommendation: (isCut ? 'cut' : 'publish') as 'cut' | 'publish',
      recommendation_reason: reason,
      decision_run_id: args.decisionRunId,
      publish_status: 'pending' as const,
    };
  });

  const outOfHoursRows: ShiftRecommendationRow[] = outOfHours.map(slot => ({
    submission_id: slot.source.submissionId ?? '',
    provider_id: args.providerId,
    provider_name: args.providerName,
    target_month: args.targetMonth,
    shift_date: slot.date,
    start_min: slot.startMin,
    end_min: slot.endMin,
    hours: round2((slot.endMin - slot.startMin) / 60),
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
    hours: round2((slot.endMin - slot.startMin) / 60),
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
