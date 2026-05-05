/**
 * Provider-specific availability corrections and tunable validation
 * thresholds. Kept here (not embedded in business logic) so ClinOps can
 * adjust without code changes; in a follow-up these can move into a
 * Supabase table and be loaded at runtime. Identifying providers by
 * `email` is preferred — names change, IDs aren't always present in the
 * Jotform payload.
 *
 * IMPORTANT: This file is mirrored at
 *   supabase/functions/_shared/availabilityOverrides.ts
 * for Deno edge-function consumption. Keep the two in sync.
 */

export interface ValidationConfig {
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
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  max_single_shift_hours: 12,
  max_daily_hours: 12,
  max_weekly_hours: 60,
  allow_overnight_shifts: false,
  flag_midnight_start: true,
  flag_full_day_availability: true,
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
  rules: ProviderOverrideRule[];
}

/**
 * Default overrides keyed off ClinOps's May 2026 audit of bad submissions.
 * Add new entries here rather than encoding fixes inside the validator.
 */
export const AVAILABILITY_OVERRIDES: ProviderOverride[] = [
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
