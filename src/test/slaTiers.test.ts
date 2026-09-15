import { describe, expect, it } from 'vitest';
import {
  SLA_PHYSICIAN_ONLY_STATES,
  SLA_TIER_BY_STATE,
  getSlaTier,
  getSlaTierLabel,
  getSlaTierMemberLanguage,
  getSlaTierRule,
  isSlaPhysicianOnlyState,
  statesInTier,
} from '@/constants/slaTiers';
import { NP_PROHIBITED_STATES } from '@/constants/stateRestrictions';

describe('SLA tier policy', () => {
  it('covers all 50 states plus DC exactly once', () => {
    expect(Object.keys(SLA_TIER_BY_STATE)).toHaveLength(51);
  });

  it('matches the tier membership counts in the Notion policy', () => {
    expect(statesInTier('same_day')).toHaveLength(7);
    expect(statesInTier('next_day')).toHaveLength(5);
    expect(statesInTier('within_48h')).toHaveLength(39);
  });

  it('assigns the same-day states from the policy', () => {
    expect(statesInTier('same_day').sort()).toEqual(
      ['DE', 'FL', 'NJ', 'OH', 'PA', 'TX', 'VA'],
    );
  });

  it('assigns the next-day states from the policy', () => {
    expect(statesInTier('next_day').sort()).toEqual(['GA', 'IL', 'IN', 'MD', 'WA']);
  });

  it('flags exactly the eight physician-only states', () => {
    const flagged = Object.values(SLA_TIER_BY_STATE)
      .filter((rule) => rule.physicianOnly)
      .map((rule) => rule.state)
      .sort();
    expect(flagged).toEqual(['AL', 'GA', 'IN', 'LA', 'MO', 'MS', 'SC', 'TN']);
    expect([...SLA_PHYSICIAN_ONLY_STATES].sort()).toEqual(flagged);
  });

  it('carries the policy visit minimums, including the VA carve-out', () => {
    expect(getSlaTierRule('PA')?.minSlotsWindow).toBe(5);
    expect(getSlaTierRule('NJ')?.minSlotsWindow).toBe(5);
    expect(getSlaTierRule('VA')?.minSlotsWindow).toBe(2);
    expect(getSlaTierRule('IL')?.minSlotsWindow).toBe(2);
    expect(getSlaTierRule('CA')?.minSlotsWindow).toBeNull();
  });

  it('sets a same-day floor only for same-day states', () => {
    expect(getSlaTierRule('PA')?.minSlotsSameDay).toBe(1);
    // next_day is explicitly "2 visits, excluding same-day".
    expect(getSlaTierRule('MD')?.minSlotsSameDay).toBeNull();
    expect(getSlaTierRule('CA')?.minSlotsSameDay).toBeNull();
  });

  it('uses a today+tomorrow horizon for same-day and next-day tiers', () => {
    expect(getSlaTierRule('PA')?.horizonDays).toBe(1);
    expect(getSlaTierRule('MD')?.horizonDays).toBe(1);
    expect(getSlaTierRule('CA')?.horizonDays).toBe(2);
  });

  it('normalizes casing and whitespace in lookups', () => {
    expect(getSlaTier('pa')).toBe('same_day');
    expect(getSlaTier(' pa ')).toBe('same_day');
  });

  it('returns undefined for a state outside the policy rather than guessing a tier', () => {
    expect(getSlaTierRule('ZZ')).toBeUndefined();
    expect(getSlaTier('PR')).toBeUndefined();
    expect(isSlaPhysicianOnlyState('ZZ')).toBe(false);
  });

  it('uses the policy wording for labels and member-facing language', () => {
    expect(getSlaTierLabel('next_day')).toBe('By tomorrow');
    expect(getSlaTierMemberLanguage('same_day')).toContain('available today');
    expect(getSlaTierMemberLanguage('next_day')).toContain('may not be available today');
  });

  /**
   * These two lists answer different questions — "may an NP practice here"
   * (licensure law) versus "whose slots count toward the SLA" (ClinOps
   * policy) — and are maintained separately. They contain the same eight
   * states today. If this test fails, do not simply update it: confirm
   * whether the divergence is a real policy change or an editing mistake.
   */
  it('agrees with the NP practice-authority list, which is a separate concept', () => {
    expect([...SLA_PHYSICIAN_ONLY_STATES].sort()).toEqual([...NP_PROHIBITED_STATES].sort());
  });
});
