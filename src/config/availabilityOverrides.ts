/**
 * Provider-specific availability corrections and tunable validation
 * thresholds.
 *
 * MVP STORAGE: Overrides live in this file as `AVAILABILITY_OVERRIDES`.
 * The shape (`ProviderOverride` / `ProviderOverrideRule`) is intentionally
 * a flat record set so a follow-up migration can move them into a
 * Supabase `availability_overrides` table without changing any
 * validation logic. The validator always reads through
 * `findProviderOverride(identity, overrides)` and accepts a runtime
 * `overrides` array, so the only swap required will be to load that
 * array from the DB at the call site.
 *
 * TODO(VIT-XXXX): replace AVAILABILITY_OVERRIDES with a `availability_overrides`
 *   table loaded once per evaluator run. Suggested columns:
 *     id uuid pk, provider_id uuid null, email text null, full_name text null,
 *     kind text null, day_of_week text null,
 *     raw_start text, raw_end text,
 *     normalized_start text, normalized_end text,
 *     reason text, created_by uuid, created_at timestamptz default now().
 *
 * Identifying providers by `email` is preferred — names change, IDs
 * aren't always present in the Jotform payload.
 *
 * IMPORTANT: This file is mirrored at
 *   supabase/functions/_shared/availabilityOverrides.ts
 * for Deno edge-function consumption. Keep the two in sync.
 */

export interface ValidationConfig {
  /** Reject any single shift shorter than this after windowing. 0 disables. */
  min_single_shift_hours: number;
  /** Reject any single shift longer than this (after correction). */
  max_single_shift_hours: number;
  /** Flag if a single calendar date totals more than this. */
  max_daily_hours: number;
  /** Flag if any ISO week totals more than this. */
  max_weekly_hours: number;
  /** If false, end <= start is treated as an error (not a midnight crossing). */
  allow_overnight_shifts: boolean;
  /** Surface a warning when start is exactly 12:00 AM. */
  flag_midnight_start: boolean;
  /** Surface a warning when a recurring window covers ~the entire day. */
  flag_full_day_availability: boolean;
  /** Operating-hours window in minutes from midnight (ET). Shifts outside the
   *  window are clamped (partial overlap) or cut entirely (no overlap).
   *  Tracked in `hours_removed_for_operating_hours`. */
  weekday_window_start_min: number;
  weekday_window_end_min: number;
  weekend_window_start_min: number;
  weekend_window_end_min: number;
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  min_single_shift_hours: 0,
  max_single_shift_hours: 12,
  max_daily_hours: 12,
  max_weekly_hours: 60,
  allow_overnight_shifts: false,
  flag_midnight_start: true,
  flag_full_day_availability: true,
  // 9:00 AM - 9:00 PM ET on weekdays, 9:00 AM - 12:00 PM ET on weekends.
  weekday_window_start_min: 540,
  weekday_window_end_min: 1260,
  weekend_window_start_min: 540,
  weekend_window_end_min: 720,
};

export interface ProviderOverrideRule {
  /** Optional: only match this kind of interval. */
  kind?: 'recurring' | 'one_off' | 'in_home';
  /** Optional: only match this weekday (case-insensitive). */
  dayOfWeek?: string;
  /** Raw start/end as the provider entered them on the Jotform widget. */
  rawStart: string;
  rawEnd: string;
  /** Corrected start/end. */
  normalizedStart: string;
  normalizedEnd: string;
  /** Free-form note explaining the correction (shows up in the audit log). */
  reason?: string;
}

export interface ProviderOverride {
  /** Display name — included for human readability in logs. */
  fullName?: string;
  /** Most stable matcher; preferred. */
  email?: string;
  /** Provider UUID, if known. */
  providerId?: string;
  /** Exact unavailable date ranges to ignore when ClinOps has confirmed the
   *  provider's free-text availability should supersede a bad blackout row. */
  ignoredUnavailableDateRanges?: Array<{
    startDate: string;
    endDate?: string;
    reason?: string;
  }>;
  rules: ProviderOverrideRule[];
}

/**
 * Default overrides keyed off ClinOps's May 2026 audit of bad submissions.
 * Add new entries here rather than encoding fixes inside the validator.
 */
export const AVAILABILITY_OVERRIDES: ProviderOverride[] = [
  {
    fullName: 'Abiah Grant',
    email: 'abiah.grant@vitablehealth.com',
    ignoredUnavailableDateRanges: [
      {
        startDate: '2026-07-01',
        endDate: '2026-07-29',
        reason: 'Abiah Grant July 2026: free-text comment confirms Wednesday 11 AM-4 PM ET availability for the month; the broad unavailable range was an entry error',
      },
    ],
    rules: [],
  },
  {
    fullName: 'Cassondra Hawkins',
    rules: [
      {
        kind: 'recurring',
        dayOfWeek: 'Friday',
        rawStart: '4:00 AM',
        rawEnd: '9:00 PM',
        normalizedStart: '4:00 PM',
        normalizedEnd: '9:00 PM',
        reason: 'Cassondra Hawkins Friday: confirmed afternoon-only availability; 4 AM is an AM/PM entry error',
      },
      {
        kind: 'recurring',
        dayOfWeek: 'Sunday',
        rawStart: '9:00 AM',
        rawEnd: '12:00 AM',
        normalizedStart: '9:00 AM',
        normalizedEnd: '12:00 PM',
        reason: 'Cassondra Hawkins Sunday: confirmed morning-only availability; 12 AM end is an AM/PM entry error',
      },
    ],
  },
  {
    fullName: 'Akosua Norgbey',
    rules: [
      {
        rawStart: '8:00 AM',
        rawEnd: '11:59 PM',
        normalizedStart: '8:00 AM',
        normalizedEnd: '12:00 PM',
        reason: 'Akosua Norgbey: confirmed morning-only window; do not credit full-day capacity',
      },
    ],
  },
  {
    fullName: 'Melissa Harris-Perotti',
    rules: [
      {
        rawStart: '12:00 AM',
        rawEnd: '6:00 PM',
        normalizedStart: '12:00 PM',
        normalizedEnd: '6:00 PM',
        reason: 'Melissa Harris-Perotti: confirmed afternoon-only availability; 12 AM start is an AM/PM entry error',
      },
    ],
  },
  {
    fullName: 'Shadae McMillan',
    rules: [
      {
        rawStart: '12:00 AM',
        rawEnd: '3:00 PM',
        normalizedStart: '12:00 PM',
        normalizedEnd: '3:00 PM',
        reason: 'Shadae McMillan: confirmed afternoon-only availability; 12 AM start is an AM/PM entry error',
      },
    ],
  },
];
