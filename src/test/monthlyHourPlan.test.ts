import { describe, expect, it } from 'vitest';
import {
  OCTOBER_2026_HOUR_PLAN,
  WEEKS_PER_MONTH,
  clampToHourPlan,
  monthlyHourPlanFor,
  planEntryFor,
  rebalanceAllocations,
} from '@/lib/scheduling/monthlyHourPlan';

const entry = (name: string) => {
  const found = planEntryFor(OCTOBER_2026_HOUR_PLAN, name);
  if (!found) throw new Error(`missing plan entry for ${name}`);
  return found;
};

describe('October 2026 hour plan', () => {
  it('sums to the 1,765 hour October target', () => {
    const total = OCTOBER_2026_HOUR_PLAN.entries.reduce((s, e) => s + e.targetHours, 0);
    expect(total).toBe(OCTOBER_2026_HOUR_PLAN.totalTargetHours);
  });

  it('resolves by month with or without the day component', () => {
    expect(monthlyHourPlanFor('2026-10')).toBe(OCTOBER_2026_HOUR_PLAN);
    expect(monthlyHourPlanFor('2026-10-01')).toBe(OCTOBER_2026_HOUR_PLAN);
    expect(monthlyHourPlanFor('2026-09-01')).toBeNull();
  });

  it('matches providers by canonical name, ignoring credentials', () => {
    expect(planEntryFor(OCTOBER_2026_HOUR_PLAN, 'Mandy Clement, NP')?.targetHours).toBe(130);
    expect(planEntryFor(OCTOBER_2026_HOUR_PLAN, 'Dr. Kimberly Truong MD')?.targetHours).toBe(65);
    expect(planEntryFor(OCTOBER_2026_HOUR_PLAN, 'Nobody Here')).toBeNull();
  });
});

describe('clampToHourPlan', () => {
  it('caps allocation at the plan target', () => {
    const result = clampToHourPlan(entry('Shannon Greco'), {
      effectiveHours: 60,
      allocatedHours: 55,
      allocations: [{ state: 'PA', hours: 55 }],
      stateGaps: [{ state: 'PA', gapHours: 200 }],
    });
    expect(result.acceptedHours).toBe(33);
    expect(result.adjustment).toBe('capped');
    expect(result.allocations.reduce((s, a) => s + a.hours, 0)).toBe(33);
  });

  it('never exceeds the stated weekly maximum', () => {
    const kim = entry('Kimberly Truong');
    const max = kim.maxHoursPerWeek! * WEEKS_PER_MONTH; // 64.95 < target 65
    const result = clampToHourPlan(kim, {
      effectiveHours: 90,
      allocatedHours: 90,
      allocations: [{ state: 'GA', hours: 90 }],
      stateGaps: [{ state: 'GA', gapHours: 120 }],
    });
    expect(result.acceptedHours).toBeLessThanOrEqual(max);
    expect(result.flags).toContain('plan_target_above_survey_max');
  });

  it('raises allocation up to the stated weekly minimum', () => {
    const result = clampToHourPlan(entry('Van Tu'), {
      effectiveHours: 140,
      allocatedHours: 40,
      allocations: [{ state: 'PA', hours: 40 }],
      stateGaps: [{ state: 'PA', gapHours: 90 }, { state: 'NJ', gapHours: 60 }],
    });
    expect(result.acceptedHours).toBeGreaterThanOrEqual(129);
    expect(result.adjustment).toBe('raised');
    expect(result.allocations.reduce((s, a) => s + a.hours, 0)).toBeCloseTo(result.acceptedHours, 2);
  });

  it('never raises above what the provider actually submitted', () => {
    const result = clampToHourPlan(entry('Mandy Clement'), {
      effectiveHours: 40,
      allocatedHours: 20,
      allocations: [{ state: 'PA', hours: 20 }],
      stateGaps: [{ state: 'PA', gapHours: 300 }],
    });
    expect(result.acceptedHours).toBe(40);
    expect(result.flags).toContain('submitted_below_survey_min');
  });

  it('honours a plan target below the stated minimum', () => {
    const result = clampToHourPlan(entry('Jonathan Luker'), {
      effectiveHours: 200,
      allocatedHours: 200,
      allocations: [{ state: 'PA', hours: 200 }],
      stateGaps: [{ state: 'PA', gapHours: 400 }],
    });
    expect(result.acceptedHours).toBe(125);
    expect(result.flags).toContain('plan_target_below_survey_min');
  });

  it('zeroes offboarded providers', () => {
    const result = clampToHourPlan(entry('Bee Chang'), {
      effectiveHours: 40,
      allocatedHours: 40,
      allocations: [{ state: 'PA', hours: 40 }],
      stateGaps: [{ state: 'PA', gapHours: 100 }],
    });
    expect(result.acceptedHours).toBe(0);
    expect(result.allocations).toEqual([]);
  });
});

describe('rebalanceAllocations', () => {
  it('scales down proportionally and keeps the total exact', () => {
    const out = rebalanceAllocations(
      [{ state: 'PA', hours: 60 }, { state: 'NJ', hours: 40 }],
      50,
      [],
    );
    expect(out.reduce((s, a) => s + a.hours, 0)).toBe(50);
  });

  it('fills remaining state room when raising', () => {
    const out = rebalanceAllocations(
      [{ state: 'PA', hours: 20 }],
      50,
      [{ state: 'PA', gapHours: 30 }, { state: 'NJ', gapHours: 40 }],
    );
    expect(out.reduce((s, a) => s + a.hours, 0)).toBe(50);
    expect(out.map(a => a.state).sort()).toEqual(['NJ', 'PA']);
  });
});
