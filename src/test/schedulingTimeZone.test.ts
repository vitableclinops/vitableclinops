import { describe, expect, it } from 'vitest';
import {
  formatShiftDateKeyInProviderTime,
  formatShiftTimeRangeInProviderTime,
  normalizeTimeZone,
} from '@/lib/scheduling/timeZone';

describe('provider local schedule display', () => {
  it('renders an Eastern shift in the provider time zone', () => {
    expect(formatShiftDateKeyInProviderTime('2026-07-01', 9 * 60, 'America/Chicago'))
      .toBe('2026-07-01');
    expect(formatShiftTimeRangeInProviderTime('2026-07-01', 9 * 60, 10 * 60, 'America/Chicago'))
      .toContain('8:00 AM-9:00 AM');
  });

  it('uses the provider-local date when the shift crosses back a day', () => {
    expect(formatShiftDateKeyInProviderTime('2026-07-01', 30, 'America/Los_Angeles'))
      .toBe('2026-06-30');
  });

  it('falls back to Eastern for invalid time zones', () => {
    expect(normalizeTimeZone('not/a-zone')).toBe('America/New_York');
  });
});
