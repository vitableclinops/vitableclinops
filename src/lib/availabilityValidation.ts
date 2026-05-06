/**
 * Availability validation & normalization for provider monthly Jotform
 * submissions. The raw submission is preserved verbatim by sync-jotform-
 * submissions; this module produces a normalized/corrected representation
 * that the evaluator (evaluate-schedule-submissions) consumes for
 * forecast-based approve/deny decisions.
 *
 * Why a separate normalized layer: providers occasionally enter AM/PM
 * mistakes on the Jotform widget (e.g. 12:00 AM–6:00 PM when they meant
 * 12:00 PM–6:00 PM, or 4:00 AM–9:00 PM when they meant 4:00 PM–9:00 PM).
 * Treating the raw entry as truth either over-approves a 17-hour shift
 * the provider never intended to work, or under-approves real availability
 * because the slot was filtered as nonsense. The normalization layer
 * applies deterministic corrections, records an audit trail (status,
 * warnings, reason, confidence), and the evaluator allocates demand-hour
 * gaps against the corrected values.
 *
 * IMPORTANT: This file is mirrored at
 *   supabase/functions/_shared/availabilityValidation.ts
 * for Deno edge-function consumption. Keep the two in sync.
 */

import {
  AVAILABILITY_OVERRIDES,
  DEFAULT_VALIDATION_CONFIG,
  type ProviderOverride,
  type ProviderOverrideRule,
  type ValidationConfig,
} from '@/config/availabilityOverrides';

export type {
  ProviderOverride,
  ProviderOverrideRule,
  ValidationConfig,
} from '@/config/availabilityOverrides';
export { AVAILABILITY_OVERRIDES, DEFAULT_VALIDATION_CONFIG } from '@/config/availabilityOverrides';

import { canonicalName } from '@/lib/nameNormalization';

export type ValidationStatus =
  | 'valid'
  | 'auto_corrected'
  | 'needs_review'
  | 'rejected_or_unusable';

export type CorrectionConfidence = 'high' | 'medium' | 'low' | 'none';

export type IntervalKind = 'recurring' | 'one_off' | 'in_home';

/** Input to validation; comes from the parsed Jotform widget. */
export interface RawInterval {
  kind: IntervalKind;
  /** Recurring entries identify a weekday (e.g. "Monday"). */
  dayOfWeek?: string;
  /** One-off and in-home entries identify a calendar date (YYYY-MM-DD). */
  date?: string;
  /** Raw "09:00 AM" / "5:00 PM" / "13:00" strings as submitted. */
  rawStart: string;
  rawEnd: string;
  /** Submission ID, for audit linkage. */
  submissionId?: string;
  /** Provider display name, for the report. */
  providerName?: string;
}

export interface NormalizedInterval {
  kind: IntervalKind;
  dayOfWeek?: string;
  date?: string;
  raw_start_time: string;
  raw_end_time: string;
  /** "HH:MM AM/PM" canonical form of the corrected start. */
  normalized_start_time: string;
  normalized_end_time: string;
  original_duration_hours: number | null;
  normalized_duration_hours: number | null;
  validation_status: ValidationStatus;
  validation_warnings: string[];
  correction_reason: string | null;
  correction_confidence: CorrectionConfidence;
  /** Whether the evaluator should use this interval when allocating demand. */
  used_in_forecast: boolean;
  needs_manual_review: boolean;
  submissionId?: string;
  providerName?: string;
  /** Internal: corrected time as minutes from midnight, for downstream merge. */
  normalized_start_min: number | null;
  normalized_end_min: number | null;
}

export interface ProviderIdentity {
  providerId?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface NormalizationSummary {
  raw_total_hours: number;
  normalized_total_hours: number;
  hours_removed_for_unavailability: number;
  hours_removed_for_duplicates: number;
  /** Hours dropped or trimmed because the slot fell outside the configured
   *  operating-hours window (default 9 AM - 9 PM ET weekdays, 9 AM - 12 PM ET
   *  weekends). */
  hours_removed_for_operating_hours: number;
  hours_changed_by_validation: number;
  intervals_auto_corrected: number;
  intervals_needing_review: number;
  intervals_rejected: number;
  /** Sum of timeline slots across ALL kinds (telehealth + in-home/clinic). */
  total_normalized_timeline_hours: number;
  /** Sum of timeline slots restricted to forecastKinds (default telehealth-only). */
  final_approvable_hours: number;
}

export interface ValidationReportRow {
  provider: string | null;
  submission_id: string | null;
  date: string | null;
  day_of_week: string | null;
  raw_time_range: string;
  corrected_time_range: string;
  raw_duration: number | null;
  corrected_duration: number | null;
  warnings: string[];
  correction_reason: string | null;
  used_in_forecast: boolean;
  needs_manual_review: boolean;
  validation_status: ValidationStatus;
}

// ─── Time parsing & formatting ────────────────────────────────────────────

interface ParsedTime {
  /** Minutes from midnight, 0..1440. 24:00 stays as 1440 only when input was 24:00. */
  totalMinutes: number;
  hour: number;
  minute: number;
  ampm: 'AM' | 'PM' | null;
}

/** Parses "09:00 AM", "5:00 PM", "13:00", "11:59 PM" → ParsedTime. */
export function parseTimeOfDay(raw: string | null | undefined): ParsedTime | null {
  if (raw == null) return null;
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampmRaw = (m[3] ?? '').toUpperCase();
  const ampm: 'AM' | 'PM' | null = ampmRaw === 'AM' ? 'AM' : ampmRaw === 'PM' ? 'PM' : null;
  if (ampm === 'AM') {
    if (h === 12) h = 0;
  } else if (ampm === 'PM') {
    if (h !== 12) h += 12;
  }
  if (h < 0 || h > 24 || min < 0 || min >= 60) return null;
  return { totalMinutes: h * 60 + min, hour: h, minute: min, ampm };
}

/** Format minutes-from-midnight as "h:mm AM/PM" canonical string. */
export function formatTime(totalMinutes: number): string {
  const safe = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(safe / 60);
  const m = safe % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Difference end - start, treating end <= start as overnight (+24h). */
export function intervalHours(startMin: number, endMin: number): number {
  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

// ─── Override matching ────────────────────────────────────────────────────

/**
 * Resolve a provider's override rules using the most stable identifier
 * available: email first (most stable), then provider UUID, then a
 * canonicalized full name match. Returns null if no override exists.
 */
export function findProviderOverride(
  identity: ProviderIdentity,
  overrides: ProviderOverride[] = AVAILABILITY_OVERRIDES,
): ProviderOverride | null {
  const email = (identity.email ?? '').trim().toLowerCase();
  if (email) {
    const byEmail = overrides.find(o => (o.email ?? '').toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  if (identity.providerId) {
    const byId = overrides.find(o => o.providerId === identity.providerId);
    if (byId) return byId;
  }
  const canon = canonicalName(identity.name ?? '');
  if (canon) {
    const byName = overrides.find(o => canonicalName(o.fullName ?? '') === canon);
    if (byName) return byName;
  }
  return null;
}

/**
 * Attempt to match a raw interval against one of a provider's override
 * rules. Match keys: rawStart + rawEnd, plus optional dayOfWeek and kind.
 */
function matchOverrideRule(
  raw: RawInterval,
  override: ProviderOverride | null,
): ProviderOverrideRule | null {
  if (!override) return null;
  const rawStartNorm = canonicalTimeKey(raw.rawStart);
  const rawEndNorm = canonicalTimeKey(raw.rawEnd);
  for (const rule of override.rules) {
    const ruleStart = canonicalTimeKey(rule.rawStart);
    const ruleEnd = canonicalTimeKey(rule.rawEnd);
    if (ruleStart !== rawStartNorm || ruleEnd !== rawEndNorm) continue;
    if (rule.kind && rule.kind !== raw.kind) continue;
    if (rule.dayOfWeek && (raw.dayOfWeek ?? '').toLowerCase() !== rule.dayOfWeek.toLowerCase()) {
      continue;
    }
    return rule;
  }
  return null;
}

function canonicalTimeKey(t: string | undefined | null): string {
  const p = parseTimeOfDay(t ?? '');
  if (!p) return String(t ?? '').trim().toLowerCase();
  return formatTime(p.totalMinutes).toLowerCase();
}

// ─── Per-interval validation ──────────────────────────────────────────────

interface DefaultCorrectionResult {
  correctedStartMin: number;
  correctedEndMin: number;
  reason: string;
  confidence: CorrectionConfidence;
}

/**
 * Apply built-in deterministic AM/PM corrections that don't need a
 * provider-specific override. These are intentionally conservative:
 * each rule combines a pattern in the raw entry with an additional
 * implausibility signal (oversize duration or full-day recurring) so
 * we don't silently rewrite legitimate shifts.
 */
function applyDefaultCorrection(
  raw: RawInterval,
  startMin: number,
  endMin: number,
  config: ValidationConfig,
): DefaultCorrectionResult | null {
  const rawDuration = intervalHours(startMin, endMin);

  // Rule: 12:00 AM start with afternoon/evening end → start was meant as 12 PM.
  // Examples: 12:00 AM–3:00 PM → 12:00 PM–3:00 PM; 12:00 AM–6:00 PM → 12:00 PM–6:00 PM.
  if (
    config.flag_midnight_start &&
    startMin === 0 &&
    endMin >= 12 * 60 + 1 && // anything past noon
    endMin <= 22 * 60 // sanity cap
  ) {
    return {
      correctedStartMin: 12 * 60,
      correctedEndMin: endMin,
      reason: '12:00 AM start with afternoon/evening end normalized to 12:00 PM (likely AM/PM entry error)',
      confidence: 'high',
    };
  }

  // Rule: very early AM start (1–5 AM) paired with evening end is almost
  // always an AM/PM error on the start. e.g. 4:00 AM–9:00 PM → 4:00 PM–9:00 PM.
  // Trigger only if the resulting raw shift would exceed the single-shift cap.
  if (
    startMin >= 60 && startMin < 5 * 60 &&
    endMin >= 17 * 60 &&
    rawDuration > config.max_single_shift_hours
  ) {
    return {
      correctedStartMin: startMin + 12 * 60,
      correctedEndMin: endMin,
      reason: `Early-AM start (${formatTime(startMin)}) with evening end exceeds ${config.max_single_shift_hours}h; normalized start to PM`,
      confidence: 'medium',
    };
  }

  // Rule: end at 12:00 AM with morning start almost always means 12:00 PM.
  // e.g. 9:00 AM–12:00 AM → 9:00 AM–12:00 PM. Only fires when overnight is
  // disallowed AND the overnight reading would exceed max_single_shift.
  if (
    !config.allow_overnight_shifts &&
    endMin === 0 &&
    startMin >= 6 * 60 && startMin <= 11 * 60
  ) {
    const overnightDuration = intervalHours(startMin, endMin); // wraps to next day
    if (overnightDuration > config.max_single_shift_hours) {
      return {
        correctedStartMin: startMin,
        correctedEndMin: 12 * 60,
        reason: `Morning start with 12:00 AM end would be ${overnightDuration.toFixed(1)}h overnight; normalized end to 12:00 PM`,
        confidence: 'medium',
      };
    }
  }

  return null;
}

/**
 * Validate and (if applicable) correct a single raw interval.
 *
 * Order of precedence:
 *   1. Provider-specific override rule (highest authority).
 *   2. Default deterministic AM/PM corrections.
 *   3. Otherwise: keep raw, but flag warnings.
 */
export function validateInterval(
  raw: RawInterval,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG,
  override: ProviderOverride | null = null,
): NormalizedInterval {
  const warnings: string[] = [];
  const startParsed = parseTimeOfDay(raw.rawStart);
  const endParsed = parseTimeOfDay(raw.rawEnd);

  // Malformed times are unusable.
  if (!startParsed || !endParsed) {
    return buildNormalized(raw, {
      startMin: 0,
      endMin: 0,
      normalizedStartMin: null,
      normalizedEndMin: null,
      originalDuration: null,
      normalizedDuration: null,
      status: 'rejected_or_unusable',
      warnings: ['Malformed or unparseable time string'],
      reason: null,
      confidence: 'none',
      usedInForecast: false,
      needsReview: true,
    });
  }

  const startMin = startParsed.totalMinutes;
  const endMin = endParsed.totalMinutes;

  // Original duration: we treat end <= start as overnight here for the audit
  // value (so we report what the provider literally typed).
  const originalDuration = intervalHours(startMin, endMin);

  // 1) Provider-specific override
  const overrideRule = matchOverrideRule(raw, override);
  if (overrideRule) {
    const ovStart = parseTimeOfDay(overrideRule.normalizedStart);
    const ovEnd = parseTimeOfDay(overrideRule.normalizedEnd);
    if (ovStart && ovEnd) {
      const newDuration = intervalHours(ovStart.totalMinutes, ovEnd.totalMinutes);
      const status: ValidationStatus = 'auto_corrected';
      warnings.push(`Provider-specific override applied: ${overrideRule.reason ?? 'configured rule'}`);
      return buildNormalized(raw, {
        startMin,
        endMin,
        normalizedStartMin: ovStart.totalMinutes,
        normalizedEndMin: ovEnd.totalMinutes,
        originalDuration,
        normalizedDuration: newDuration,
        status,
        warnings,
        reason: `provider_override: ${overrideRule.reason ?? `${formatTime(startMin)}-${formatTime(endMin)} → ${formatTime(ovStart.totalMinutes)}-${formatTime(ovEnd.totalMinutes)}`}`,
        confidence: 'high',
      });
    }
  }

  // Detect "full-day recurring availability" before default correction so we
  // can flag it for review when no override mapped it to a real window.
  const isFullDayRecurring =
    raw.kind === 'recurring' &&
    config.flag_full_day_availability &&
    isFullDayWindow(startMin, endMin);

  if (isFullDayRecurring) {
    warnings.push('Recurring availability spans nearly the entire day (e.g. 8 AM–11:59 PM); flagged for review unless a provider-specific override is configured');
  }

  // 2) Default deterministic correction
  const defaultCorrection = applyDefaultCorrection(raw, startMin, endMin, config);
  if (defaultCorrection && !isFullDayRecurring) {
    const newDuration = intervalHours(defaultCorrection.correctedStartMin, defaultCorrection.correctedEndMin);
    warnings.push(defaultCorrection.reason);
    // Re-run sanity checks against the corrected window
    const correctedWarnings = collectShiftWarnings(
      defaultCorrection.correctedStartMin,
      defaultCorrection.correctedEndMin,
      config,
    );
    for (const w of correctedWarnings) warnings.push(`(post-correction) ${w}`);
    return buildNormalized(raw, {
      startMin,
      endMin,
      normalizedStartMin: defaultCorrection.correctedStartMin,
      normalizedEndMin: defaultCorrection.correctedEndMin,
      originalDuration,
      normalizedDuration: newDuration,
      status: 'auto_corrected',
      warnings,
      reason: defaultCorrection.reason,
      confidence: defaultCorrection.confidence,
    });
  }

  // 3) No correction — apply raw checks
  for (const w of collectShiftWarnings(startMin, endMin, config)) warnings.push(w);

  // End <= start: overnight handling
  let status: ValidationStatus = 'valid';
  const normalizedStartMin: number | null = startMin;
  const normalizedEndMin: number | null = endMin;
  const normalizedDuration: number | null = originalDuration;
  const reason: string | null = null;
  const confidence: CorrectionConfidence = 'none';
  let usedInForecast = true;
  let needsReview = false;

  if (endMin <= startMin) {
    if (config.allow_overnight_shifts) {
      warnings.push('Overnight shift accepted (allow_overnight_shifts=true)');
    } else {
      warnings.push('End time is at or before start time and overnight shifts are not allowed; flagged for review');
      status = 'needs_review';
      needsReview = true;
      usedInForecast = false;
    }
  }

  if (isFullDayRecurring) {
    status = 'needs_review';
    needsReview = true;
    usedInForecast = false;
  }

  if (originalDuration > config.max_single_shift_hours) {
    warnings.push(`Single shift duration ${originalDuration.toFixed(2)}h exceeds max_single_shift_hours=${config.max_single_shift_hours}h`);
    if (status === 'valid') {
      status = 'needs_review';
      needsReview = true;
      usedInForecast = false;
    }
  }

  return buildNormalized(raw, {
    startMin,
    endMin,
    normalizedStartMin,
    normalizedEndMin,
    originalDuration,
    normalizedDuration,
    status,
    warnings,
    reason,
    confidence,
    usedInForecast,
    needsReview,
  });
}

function isFullDayWindow(startMin: number, endMin: number): boolean {
  // Treat any window covering >= 14 hours within a single day starting before
  // 9 AM and ending at/after 23:30 as "full-day" for review-flag purposes.
  if (endMin <= startMin) return false;
  const dur = (endMin - startMin) / 60;
  return startMin <= 9 * 60 && endMin >= 23 * 60 + 30 && dur >= 14;
}

function collectShiftWarnings(startMin: number, endMin: number, config: ValidationConfig): string[] {
  const out: string[] = [];
  if (config.flag_midnight_start && startMin === 0 && endMin > 0 && endMin <= 22 * 60) {
    out.push('Start time is 12:00 AM with non-overnight end — likely AM/PM entry error');
  }
  if (config.flag_full_day_availability && isFullDayWindow(startMin, endMin)) {
    out.push('Window spans nearly the entire day');
  }
  return out;
}

interface BuildArgs {
  startMin: number;
  endMin: number;
  normalizedStartMin: number | null;
  normalizedEndMin: number | null;
  originalDuration: number | null;
  normalizedDuration: number | null;
  status: ValidationStatus;
  warnings: string[];
  reason: string | null;
  confidence: CorrectionConfidence;
  usedInForecast?: boolean;
  needsReview?: boolean;
}

function buildNormalized(raw: RawInterval, args: BuildArgs): NormalizedInterval {
  const usedInForecast =
    args.usedInForecast ??
    (args.status === 'valid' || args.status === 'auto_corrected');
  const needsReview =
    args.needsReview ?? args.status === 'needs_review';
  return {
    kind: raw.kind,
    dayOfWeek: raw.dayOfWeek,
    date: raw.date,
    raw_start_time: raw.rawStart,
    raw_end_time: raw.rawEnd,
    normalized_start_time:
      args.normalizedStartMin == null ? raw.rawStart : formatTime(args.normalizedStartMin),
    normalized_end_time:
      args.normalizedEndMin == null ? raw.rawEnd : formatTime(args.normalizedEndMin),
    original_duration_hours:
      args.originalDuration == null ? null : round2(args.originalDuration),
    normalized_duration_hours:
      args.normalizedDuration == null ? null : round2(args.normalizedDuration),
    validation_status: args.status,
    validation_warnings: args.warnings,
    correction_reason: args.reason,
    correction_confidence: args.confidence,
    used_in_forecast: usedInForecast,
    needs_manual_review: needsReview,
    submissionId: raw.submissionId,
    providerName: raw.providerName,
    normalized_start_min: args.normalizedStartMin,
    normalized_end_min: args.normalizedEndMin,
  };
}

// ─── Pipeline-level helpers ───────────────────────────────────────────────

/**
 * Date-level expansion of a normalized interval into one (date, startMin, endMin)
 * tuple per matching weekday in the target month, with overnight crossings split.
 * Returns an empty array for intervals not used in forecast.
 */
export interface ExpandedSlot {
  date: string; // YYYY-MM-DD
  startMin: number;
  endMin: number; // > startMin
  source: NormalizedInterval;
}

const DAY_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

export function weekdayDatesInMonth(dayName: string, monthISO: string): string[] {
  const dayIdx = DAY_TO_INDEX[String(dayName).trim().toLowerCase()];
  if (dayIdx === undefined) return [];
  const [y, m] = monthISO.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (dayIdx - firstWeekday + 7) % 7;
  const out: string[] = [];
  for (let day = 1 + offset; day <= daysInMonth; day += 7) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return out;
}

export function nextDate(dateISO: string): string | null {
  const d = new Date(dateISO + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function expandNormalizedToSlots(
  normalized: NormalizedInterval,
  targetMonth: string,
): ExpandedSlot[] {
  if (!normalized.used_in_forecast) return [];
  if (normalized.normalized_start_min == null || normalized.normalized_end_min == null) return [];
  const startMin = normalized.normalized_start_min;
  const endMin = normalized.normalized_end_min;

  const dates: string[] = [];
  if (normalized.kind === 'recurring' && normalized.dayOfWeek) {
    dates.push(...weekdayDatesInMonth(normalized.dayOfWeek, targetMonth));
  } else if (normalized.date) {
    if (isInMonth(normalized.date, targetMonth)) dates.push(normalized.date);
  }

  const slots: ExpandedSlot[] = [];
  for (const date of dates) {
    if (endMin <= startMin) {
      slots.push({ date, startMin, endMin: 1440, source: normalized });
      const next = nextDate(date);
      if (next && isInMonth(next, targetMonth)) {
        slots.push({ date: next, startMin: 0, endMin, source: normalized });
      }
    } else {
      slots.push({ date, startMin, endMin, source: normalized });
    }
  }
  return slots;
}

/** Apply the operating-hours window to a stream of expanded slots, clamping
 *  partial overlaps and dropping fully out-of-window slots. Returns the
 *  surviving slots (possibly clamped), the original portions that were
 *  dropped/trimmed (so downstream can emit per-shift "declined: outside
 *  business hours" rows), and the total hours removed. The source
 *  NormalizedInterval is preserved for downstream linkage; in-home /
 *  clinic shifts are NOT subject to this filter (their location is fixed
 *  outside the telehealth ops window). */
export function applyOperatingHoursWindow(
  slots: ExpandedSlot[],
  config: ValidationConfig,
): { slots: ExpandedSlot[]; droppedSlots: ExpandedSlot[]; hoursRemoved: number } {
  const out: ExpandedSlot[] = [];
  const dropped: ExpandedSlot[] = [];
  let removed = 0;
  for (const s of slots) {
    if (s.source.kind === 'in_home') {
      out.push(s);
      continue;
    }
    const d = new Date(s.date + 'T00:00:00Z');
    const dow = d.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const winStart = isWeekend ? config.weekend_window_start_min : config.weekday_window_start_min;
    const winEnd = isWeekend ? config.weekend_window_end_min : config.weekday_window_end_min;

    const rawHours = (s.endMin - s.startMin) / 60;
    if (s.endMin <= winStart || s.startMin >= winEnd) {
      removed += rawHours;
      dropped.push(s);
      continue;
    }
    const newStart = Math.max(s.startMin, winStart);
    const newEnd = Math.min(s.endMin, winEnd);
    if (newEnd <= newStart) {
      removed += rawHours;
      dropped.push(s);
      continue;
    }
    if (newStart === s.startMin && newEnd === s.endMin) {
      out.push(s);
    } else {
      removed += ((newStart - s.startMin) + (s.endMin - newEnd)) / 60;
      out.push({ ...s, startMin: newStart, endMin: newEnd });
      if (newStart > s.startMin) {
        dropped.push({ ...s, startMin: s.startMin, endMin: newStart });
      }
      if (newEnd < s.endMin) {
        dropped.push({ ...s, startMin: newEnd, endMin: s.endMin });
      }
    }
  }
  return { slots: out, droppedSlots: dropped, hoursRemoved: round2(removed) };
}

function isInMonth(dateISO: string, monthISO: string): boolean {
  return dateISO >= monthISO && dateISO < nextMonth(monthISO);
}

function nextMonth(monthISO: string): string {
  const [y, m] = monthISO.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

// ─── Dedup / merge / unavailable subtraction ──────────────────────────────

export interface ReconciledTimeline {
  /** One slot per (date, start, end) — duplicates collapsed, later submissions
   *  overwrite earlier overlapping slots. */
  slots: ExpandedSlot[];
  hours_removed_for_duplicates: number;
  hours_removed_for_unavailability: number;
  intervals_overlapping_unavailable: ExpandedSlot[];
}

export interface DatedSlotInput extends ExpandedSlot {
  submittedAt?: string; // ISO; later wins
}

/**
 * Merge a stream of expanded slots from one or more submissions for the same
 * provider+month. Behaviour:
 *   - Slots are processed chronologically by submittedAt.
 *   - When a new slot overlaps an existing slot on the same date, the new
 *     slot wins; the existing slot is trimmed or dropped.
 *   - Identical (date, start, end) duplicates collapse silently.
 *   - hours_removed_for_duplicates accumulates the hours that were dropped
 *     because a later slot covered them.
 *   - Unavailable dates passed in are subtracted AFTER merge.
 */
export function reconcileTimeline(
  inputs: DatedSlotInput[],
  unavailableDates: string[] = [],
): ReconciledTimeline {
  const sorted = [...inputs].sort((a, b) =>
    (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') ||
    a.date.localeCompare(b.date) ||
    a.startMin - b.startMin,
  );

  let timeline: ExpandedSlot[] = [];
  let dupHours = 0;

  for (const incoming of sorted) {
    const before = totalHours(timeline);
    timeline = mergeSlot(timeline, incoming);
    const after = totalHours(timeline);
    const incomingHours = (incoming.endMin - incoming.startMin) / 60;
    const delta = before + incomingHours - after; // positive = displaced existing
    if (delta > 0.001) dupHours += delta;
  }

  const unavailable = new Set(unavailableDates);
  let unavailHours = 0;
  const overlappingUnavailable: ExpandedSlot[] = [];
  const filtered: ExpandedSlot[] = [];
  for (const s of timeline) {
    if (unavailable.has(s.date)) {
      unavailHours += (s.endMin - s.startMin) / 60;
      overlappingUnavailable.push(s);
      continue;
    }
    filtered.push(s);
  }

  return {
    slots: filtered,
    hours_removed_for_duplicates: round2(dupHours),
    hours_removed_for_unavailability: round2(unavailHours),
    intervals_overlapping_unavailable: overlappingUnavailable,
  };
}

function mergeSlot(timeline: ExpandedSlot[], incoming: ExpandedSlot): ExpandedSlot[] {
  const out: ExpandedSlot[] = [];
  for (const existing of timeline) {
    if (existing.date !== incoming.date || !overlaps(existing, incoming)) {
      out.push(existing);
      continue;
    }
    if (existing.startMin < incoming.startMin) {
      out.push({ ...existing, endMin: incoming.startMin });
    }
    if (existing.endMin > incoming.endMin) {
      out.push({ ...existing, startMin: incoming.endMin });
    }
  }
  out.push(incoming);
  return out;
}

function overlaps(a: ExpandedSlot, b: ExpandedSlot): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

function totalHours(slots: ExpandedSlot[]): number {
  return slots.reduce((sum, s) => sum + (s.endMin - s.startMin) / 60, 0);
}

// ─── Top-level pipeline ───────────────────────────────────────────────────

export interface NormalizationInput {
  identity: ProviderIdentity;
  /** Each submission contributes intervals tagged with submittedAt. */
  submissions: Array<{
    submissionId: string;
    submittedAt: string; // ISO
    intervals: RawInterval[];
  }>;
  targetMonth: string; // YYYY-MM-01
  unavailableDates?: string[];
  config?: ValidationConfig;
  overrides?: ProviderOverride[];
  /**
   * Interval kinds that count toward `summary.final_approvable_hours`.
   * Default: ['recurring', 'one_off'] — i.e. telehealth only. In-home /
   * clinic shifts are scoped separately and do not consume telehealth
   * demand-hour gaps. Pass ['recurring','one_off','in_home'] to opt in.
   * The full normalized `timeline` always contains every kind so downstream
   * shift recommendations can still publish in-home shifts.
   */
  forecastKinds?: IntervalKind[];
}

export interface NormalizationResult {
  identity: ProviderIdentity;
  targetMonth: string;
  normalized: NormalizedInterval[];
  timeline: ExpandedSlot[];
  /** Original portions of slots that were dropped/trimmed by the operating-
   *  hours window (9a-9p ET weekdays, 9a-12p ET weekends). Each entry is
   *  the original out-of-window fragment with its source NormalizedInterval
   *  preserved, so downstream can emit "declined: outside business hours"
   *  per-shift rows. */
  outOfHoursTimeline: ExpandedSlot[];
  summary: NormalizationSummary;
  report: ValidationReportRow[];
  override_used: ProviderOverride | null;
}

/**
 * Full pipeline: validate → normalize → expand → reconcile (dedup/unavail) →
 * summarize. The slots/timeline output is what evaluate-schedule-submissions
 * should consume for forecast approve/deny — they reflect corrected times.
 */
export function normalizeProviderAvailability(input: NormalizationInput): NormalizationResult {
  const config = input.config ?? DEFAULT_VALIDATION_CONFIG;
  const overrides = input.overrides ?? AVAILABILITY_OVERRIDES;
  const override = findProviderOverride(input.identity, overrides);

  const normalized: NormalizedInterval[] = [];
  const slotInputs: DatedSlotInput[] = [];
  let rawTotal = 0;

  for (const sub of input.submissions) {
    for (const raw of sub.intervals) {
      const tagged: RawInterval = { ...raw, submissionId: sub.submissionId, providerName: input.identity.name ?? raw.providerName };
      const norm = validateInterval(tagged, config, override);
      normalized.push(norm);
      if (norm.original_duration_hours != null) rawTotal += norm.original_duration_hours;

      const slots = expandNormalizedToSlots(norm, input.targetMonth);
      for (const s of slots) slotInputs.push({ ...s, submittedAt: sub.submittedAt });

      // Out-of-month detection for one-off / in-home with explicit dates
      if ((norm.kind === 'one_off' || norm.kind === 'in_home') && norm.date) {
        if (!isInMonth(norm.date, input.targetMonth)) {
          norm.validation_warnings.push(`Date ${norm.date} is outside target month ${input.targetMonth}`);
          if (norm.validation_status === 'valid' || norm.validation_status === 'auto_corrected') {
            norm.validation_status = 'needs_review';
            norm.needs_manual_review = true;
            norm.used_in_forecast = false;
          }
        }
      }
    }
  }

  const windowed = applyOperatingHoursWindow(slotInputs, config);
  const windowedSlotInputs: DatedSlotInput[] = windowed.slots.map(s => {
    const orig = slotInputs.find(
      o => o.date === s.date && o.source === s.source,
    );
    return { ...s, submittedAt: orig?.submittedAt };
  });
  const reconciled = reconcileTimeline(windowedSlotInputs, input.unavailableDates ?? []);

  const normalizedTotal = normalized.reduce(
    (sum, n) => sum + (n.normalized_duration_hours ?? 0),
    0,
  );
  const hoursChanged = normalized.reduce((sum, n) => {
    if (n.normalized_duration_hours == null || n.original_duration_hours == null) return sum;
    return sum + Math.abs(n.normalized_duration_hours - n.original_duration_hours);
  }, 0);

  const forecastKinds = new Set<IntervalKind>(input.forecastKinds ?? ['recurring', 'one_off']);
  const totalTimelineHours = round2(reconciled.slots.reduce(
    (sum, s) => sum + (s.endMin - s.startMin) / 60, 0,
  ));
  const finalApprovable = round2(reconciled.slots.reduce(
    (sum, s) => forecastKinds.has(s.source.kind)
      ? sum + (s.endMin - s.startMin) / 60
      : sum,
    0,
  ));

  const summary: NormalizationSummary = {
    raw_total_hours: round2(rawTotal),
    normalized_total_hours: round2(normalizedTotal),
    hours_removed_for_unavailability: reconciled.hours_removed_for_unavailability,
    hours_removed_for_duplicates: reconciled.hours_removed_for_duplicates,
    hours_removed_for_operating_hours: windowed.hoursRemoved,
    hours_changed_by_validation: round2(hoursChanged),
    intervals_auto_corrected: normalized.filter(n => n.validation_status === 'auto_corrected').length,
    intervals_needing_review: normalized.filter(n => n.validation_status === 'needs_review').length,
    intervals_rejected: normalized.filter(n => n.validation_status === 'rejected_or_unusable').length,
    total_normalized_timeline_hours: totalTimelineHours,
    final_approvable_hours: finalApprovable,
  };

  const report: ValidationReportRow[] = normalized.map(n => ({
    provider: n.providerName ?? input.identity.name ?? null,
    submission_id: n.submissionId ?? null,
    date: n.date ?? null,
    day_of_week: n.dayOfWeek ?? null,
    raw_time_range: `${n.raw_start_time}–${n.raw_end_time}`,
    corrected_time_range: `${n.normalized_start_time}–${n.normalized_end_time}`,
    raw_duration: n.original_duration_hours,
    corrected_duration: n.normalized_duration_hours,
    warnings: n.validation_warnings,
    correction_reason: n.correction_reason,
    used_in_forecast: n.used_in_forecast,
    needs_manual_review: n.needs_manual_review,
    validation_status: n.validation_status,
  }));

  // Detect aggregate violations and append to summary report as synthetic rows
  const dailyHours = new Map<string, number>();
  for (const s of reconciled.slots) {
    dailyHours.set(s.date, (dailyHours.get(s.date) ?? 0) + (s.endMin - s.startMin) / 60);
  }
  let daysOver = 0;
  for (const [, h] of dailyHours) if (h > config.max_daily_hours) daysOver++;
  const weeklyMax = Math.max(0, ...weeklyTotals(dailyHours));
  if (weeklyMax > config.max_weekly_hours) {
    report.push(syntheticReport(
      input.identity,
      `Weekly hours exceed threshold: max week=${weeklyMax.toFixed(1)}h > ${config.max_weekly_hours}h`,
    ));
  }
  if (daysOver > 0) {
    report.push(syntheticReport(
      input.identity,
      `${daysOver} day(s) exceed max_daily_hours=${config.max_daily_hours}h`,
    ));
  }

  return {
    identity: input.identity,
    targetMonth: input.targetMonth,
    normalized,
    timeline: reconciled.slots,
    outOfHoursTimeline: windowed.droppedSlots,
    summary,
    report,
    override_used: override,
  };
}

function weeklyTotals(dailyHours: Map<string, number>): number[] {
  const buckets = new Map<string, number>();
  for (const [date, h] of dailyHours) {
    const d = new Date(date + 'T00:00:00Z');
    if (isNaN(d.getTime())) continue;
    // ISO week start (Monday)
    const day = d.getUTCDay();
    const diff = (day + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + h);
  }
  return Array.from(buckets.values());
}

function syntheticReport(identity: ProviderIdentity, message: string): ValidationReportRow {
  return {
    provider: identity.name ?? null,
    submission_id: null,
    date: null,
    day_of_week: null,
    raw_time_range: '',
    corrected_time_range: '',
    raw_duration: null,
    corrected_duration: null,
    warnings: [message],
    correction_reason: null,
    used_in_forecast: false,
    needs_manual_review: true,
    validation_status: 'needs_review',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
