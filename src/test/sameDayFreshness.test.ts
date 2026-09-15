import { describe, expect, it } from 'vitest';
import {
  WAREHOUSE_SYNC_INTERVAL_HOURS,
  adjustOpenSlotsForStaleness,
  businessHoursBetween,
  classifyFreshness,
} from '@/lib/sameDay/freshness';

// 2026-09-15 is a Tuesday. During EDT (UTC-4), 12:00Z = 08:00 ET.
const TUE_08_ET = new Date('2026-09-15T12:00:00Z');
const TUE_10_ET = new Date('2026-09-15T14:00:00Z');
const TUE_11_ET = new Date('2026-09-15T15:00:00Z');
const TUE_14_ET = new Date('2026-09-15T18:00:00Z');
const TUE_20_ET = new Date('2026-09-16T00:00:00Z');
// 2026-09-18 is a Friday, 2026-09-19 a Saturday, 2026-09-21 a Monday.
const FRI_18_ET = new Date('2026-09-18T22:00:00Z');
const SAT_12_ET = new Date('2026-09-19T16:00:00Z');
const MON_09_ET = new Date('2026-09-21T13:00:00Z');

describe('businessHoursBetween', () => {
  it('counts hours inside the business window', () => {
    expect(businessHoursBetween(TUE_08_ET, TUE_11_ET)).toBeCloseTo(3, 1);
  });

  it('returns zero for a reversed or equal range', () => {
    expect(businessHoursBetween(TUE_11_ET, TUE_08_ET)).toBe(0);
    expect(businessHoursBetween(TUE_08_ET, TUE_08_ET)).toBe(0);
  });

  it('excludes overnight hours', () => {
    // Tue 20:00 ET -> Wed 08:00 ET is 12 wall-clock hours, none of them
    // inside the business window.
    const wed08 = new Date('2026-09-16T12:00:00Z');
    expect(businessHoursBetween(TUE_20_ET, wed08)).toBeCloseTo(0, 1);
  });

  it('excludes weekend hours', () => {
    const sat14 = new Date('2026-09-19T18:00:00Z');
    expect(businessHoursBetween(SAT_12_ET, sat14)).toBe(0);
  });

  it('spans a weekend without counting it', () => {
    // Fri 18:00 ET -> Mon 09:00 ET. The business window is hours 08..19
    // inclusive, i.e. 08:00-20:00, so Friday contributes 18:00-20:00 = 2h,
    // the weekend contributes nothing, and Monday contributes 08:00-09:00
    // = 1h. Three business hours across a 63-hour wall-clock gap.
    expect(businessHoursBetween(FRI_18_ET, MON_09_ET)).toBeCloseTo(3, 1);
  });

  it('handles invalid input without throwing', () => {
    expect(businessHoursBetween(new Date('nope'), TUE_11_ET)).toBe(0);
  });
});

describe('classifyFreshness', () => {
  it('reports unknown when there is no timestamp', () => {
    const result = classifyFreshness(null, TUE_11_ET);
    expect(result.confidence).toBe('unknown');
    expect(result.actionable).toBe(false);
    expect(result.ageMinutes).toBeNull();
  });

  it('reports unknown for an unparseable timestamp', () => {
    expect(classifyFreshness('not-a-date', TUE_11_ET).confidence).toBe('unknown');
  });

  it('treats a reading inside half a cycle as fresh', () => {
    // 2h old, against a 6h cycle.
    const result = classifyFreshness(TUE_08_ET, TUE_10_ET);
    expect(result.confidence).toBe('fresh');
    expect(result.actionable).toBe(true);
    expect(result.ageMinutes).toBe(120);
  });

  it('treats a reading inside one full cycle as aging but still actionable', () => {
    // 4h old, against a 6h cycle.
    const result = classifyFreshness(TUE_10_ET, TUE_14_ET);
    expect(result.confidence).toBe('aging');
    expect(result.actionable).toBe(true);
  });

  it('treats a reading beyond one cycle as stale and not actionable', () => {
    const sevenHoursAgo = new Date(TUE_14_ET.getTime() - 7 * 60 * 60_000);
    const result = classifyFreshness(sevenHoursAgo, TUE_14_ET);
    expect(result.confidence).toBe('stale');
    expect(result.actionable).toBe(false);
    expect(result.reason).toContain(String(WAREHOUSE_SYNC_INTERVAL_HOURS));
  });
});

describe('adjustOpenSlotsForStaleness', () => {
  it('subtracts the expected bookings for a high-volume state', () => {
    // PA at 1.317 bookings/business-hour over 3 business hours -> ceil(3.95) = 4.
    const result = adjustOpenSlotsForStaleness({
      state: 'PA',
      reportedOpen: 12,
      lastSyncAt: TUE_08_ET,
      now: TUE_11_ET,
    });
    expect(result.estimatedBookedSinceSync).toBe(4);
    expect(result.adjustedOpen).toBe(8);
    expect(result.freshness.confidence).toBe('fresh');
  });

  it('barely adjusts a low-volume state over the same gap', () => {
    const result = adjustOpenSlotsForStaleness({
      state: 'MN',
      reportedOpen: 12,
      lastSyncAt: TUE_08_ET,
      now: TUE_11_ET,
    });
    expect(result.estimatedBookedSinceSync).toBe(1);
    expect(result.adjustedOpen).toBe(11);
  });

  it('never returns a negative adjusted count', () => {
    const result = adjustOpenSlotsForStaleness({
      state: 'PA',
      reportedOpen: 1,
      lastSyncAt: TUE_08_ET,
      now: TUE_14_ET,
    });
    expect(result.adjustedOpen).toBe(0);
  });

  it('applies no correction across a gap with no business hours', () => {
    const sat14 = new Date('2026-09-19T18:00:00Z');
    const result = adjustOpenSlotsForStaleness({
      state: 'PA',
      reportedOpen: 10,
      lastSyncAt: SAT_12_ET,
      now: sat14,
    });
    expect(result.estimatedBookedSinceSync).toBe(0);
    expect(result.adjustedOpen).toBe(10);
  });

  it('falls back to the default rate for an unlisted state', () => {
    const result = adjustOpenSlotsForStaleness({
      state: 'WY',
      reportedOpen: 5,
      lastSyncAt: TUE_08_ET,
      now: TUE_11_ET,
    });
    // Nonzero rather than zero, so an unlisted state still gets a nudge.
    expect(result.estimatedBookedSinceSync).toBe(1);
  });

  it('normalizes state casing', () => {
    expect(adjustOpenSlotsForStaleness({
      state: 'pa',
      reportedOpen: 12,
      lastSyncAt: TUE_08_ET,
      now: TUE_11_ET,
    }).estimatedBookedSinceSync).toBe(4);
  });

  it('makes no correction when the sync timestamp is missing', () => {
    const result = adjustOpenSlotsForStaleness({
      state: 'PA',
      reportedOpen: 12,
      lastSyncAt: null,
      now: TUE_11_ET,
    });
    expect(result.estimatedBookedSinceSync).toBe(0);
    expect(result.adjustedOpen).toBe(12);
    expect(result.freshness.confidence).toBe('unknown');
  });
});
