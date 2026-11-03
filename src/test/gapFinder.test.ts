import { describe, it, expect } from 'vitest';
import { buildDailyGaps, coverageBand, dowShares, hoursClosed, labelOffer } from '@/lib/gapFinder';

describe('gap finder', () => {
  it('splits monthly target by weekday share and computes gap', () => {
    const shares = [0, 0.2, 0.2, 0.2, 0.2, 0.2, 0];
    const sched = new Map([['2026-11-03', 100]]); // Tuesday
    const days = buildDailyGaps('2026-11-01', 4.33 * 600, sched, shares);
    const tue = days.find((d) => d.date === '2026-11-03')!;
    expect(tue.expected).toBe(120);
    expect(tue.gap).toBe(20);
    expect(tue.coveragePct).toBe(83);
    expect(days.find((d) => d.date === '2026-11-01')!.expected).toBe(0); // Sunday
    expect(days.find((d) => d.date === '2026-11-26')!.holiday).toBe('Thanksgiving');
  });

  it('weekday shares favor busier days and sum to 1', () => {
    const s = dowShares(new Map([['2026-10-31', 10], ['2026-11-02', 30]])); // Sat, Mon
    expect(s[6]).toBeCloseTo(0.25);
    expect(s[1]).toBeCloseTo(0.75);
  });

  it('coverage bands: red under 90, yellow 90-100, green over 100', () => {
    expect(coverageBand(89)).toBe('short');
    expect(coverageBand(90)).toBe('tight');
    expect(coverageBand(100)).toBe('tight');
    expect(coverageBand(101)).toBe('covered');
  });

  it('labels offers and caps hours closed at the gap', () => {
    expect(labelOffer(20)).toBe('Fills a gap');
    expect(labelOffer(0)).toBe('Marginal');
    expect(labelOffer(-5)).toBe('Adds to surplus');
    expect(hoursClosed(3, 8)).toBe(3);
    expect(hoursClosed(-2, 8)).toBe(0);
  });
});
