import { describe, expect, it } from 'vitest';
import { monthlyHourPlanFor, NOVEMBER_2026_HOUR_PLAN } from './monthlyHourPlan';
import { BUSINESS_CLOSED_DATES } from '@/lib/submissionTimeline';

describe('December 2026 schedule rules', () => {
  it('keeps November tier allocations', () => {
    const dec = monthlyHourPlanFor('2026-12')!;
    const nov = new Map(NOVEMBER_2026_HOUR_PLAN.entries.map(e => [e.name, e]));
    const mandy = dec.entries.find(e => e.name === 'Mandy Clement')!;
    expect(mandy.tier).toBe(nov.get('Mandy Clement')!.tier);
    expect(mandy.targetHours).toBe(nov.get('Mandy Clement')!.targetHours);
  });
  it('gives offboarded providers 0 hours', () => {
    const dec = monthlyHourPlanFor('2026-12')!;
    expect(dec.entries.find(e => e.name === 'Bee Chang')!.targetHours).toBe(0);
  });
  it('closes the business on Christmas Day', () => {
    expect(BUSINESS_CLOSED_DATES.has('2026-12-25')).toBe(true);
    expect(BUSINESS_CLOSED_DATES.has('2026-12-24')).toBe(false);
  });
});
