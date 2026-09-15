/**
 * State-level visit-availability SLA rules.
 *
 * Mirrors public.sla_tier_by_state (see
 * supabase/migrations/20260915160000_sla_tier_by_state.sql), which is the
 * source of truth. This module exists so synchronous, render-path code has
 * typed access to the rules without a round trip; anything that can do
 * async work should read the table via `useSlaTiers` (frontend) or
 * `supabase/functions/_shared/slaTiers.ts` (edge functions) so a rule change
 * in the table takes effect without a deploy.
 *
 * Transcribed from the Notion "Same-Day / Next-Day Visit Availability SLA
 * Policy", effective 2026-09-02, cross-checked against the SD/ND comms doc
 * and Metabase question 3951. Do not edit these values without updating the
 * Notion policy and adding an effective-dated row to the table.
 *
 * NOTE ON `physicianOnly`
 * This flag answers "whose open slots count when measuring whether the SLA
 * was met" and comes from the SLA policy. It is NOT the same concept as
 * NP_PROHIBITED_STATES in ./stateRestrictions, which answers "may an NP
 * practice here at all" and comes from state licensure law. The two lists
 * happen to contain the same eight states today, but they can legitimately
 * diverge (a state could allow NP practice while the SLA is still measured
 * against physician coverage). src/test/slaTiers.test.ts asserts they match
 * so that a divergence has to be deliberate.
 */

export type SlaTier = 'same_day' | 'next_day' | 'within_48h';

export interface SlaTierRule {
  /** Two-letter state or district code. */
  state: string;
  tier: SlaTier;
  /**
   * Last day of the counting window, relative to the request date.
   * same_day is 1, not 0: the policy's visit minimum is counted across
   * today and tomorrow, while `minSlotsSameDay` enforces today itself.
   */
  horizonDays: 0 | 1 | 2;
  /** Only physician slots count toward the SLA in these states. */
  physicianOnly: boolean;
  /** Policy floor on open slots across the horizon. Null where unset. */
  minSlotsWindow: number | null;
  /** Policy floor on open slots TODAY. Only same_day states have one. */
  minSlotsSameDay: number | null;
}

/** Only physician slots count toward the SLA in these states (8). */
export const SLA_PHYSICIAN_ONLY_STATES = [
  'AL', 'GA', 'IN', 'LA', 'MS', 'MO', 'SC', 'TN',
] as const;

const SAME_DAY_STATES = ['NJ', 'PA', 'FL', 'OH', 'TX', 'VA', 'DE'] as const;
const NEXT_DAY_STATES = ['IL', 'WA', 'MD', 'IN', 'GA'] as const;
const WITHIN_48H_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DC', 'HI', 'ID', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NM', 'NY', 'NC', 'ND', 'OK', 'OR', 'RI', 'SC', 'SD', 'TN', 'UT', 'VT',
  'WV', 'WI', 'WY',
] as const;

/**
 * Policy visit minimums. Tier 1 is 5 slots across same-day + next-day, with
 * VA carved out at 2; Tier 2 is 2 slots excluding same-day; Tier 3 sets none.
 *
 * These are the POLICY floors and are known to sit well below observed
 * demand in the larger states — Metabase question 3951 puts PA's p90 of
 * same/next-day demand at 31 against a floor of 5. Retuning them is a data
 * change in sla_tier_by_state, not a change here.
 */
const SAME_DAY_WINDOW_MINIMUM = 5;
const SAME_DAY_WINDOW_MINIMUM_OVERRIDES: Record<string, number> = { VA: 2 };
const NEXT_DAY_WINDOW_MINIMUM = 2;

const physicianOnly = new Set<string>(SLA_PHYSICIAN_ONLY_STATES);

/** Every state's rule, keyed by state code. */
export const SLA_TIER_BY_STATE: Readonly<Record<string, SlaTierRule>> = Object.freeze({
  ...Object.fromEntries(
    SAME_DAY_STATES.map((state): [string, SlaTierRule] => [state, {
      state,
      tier: 'same_day',
      horizonDays: 1,
      physicianOnly: physicianOnly.has(state),
      minSlotsWindow: SAME_DAY_WINDOW_MINIMUM_OVERRIDES[state] ?? SAME_DAY_WINDOW_MINIMUM,
      minSlotsSameDay: 1,
    }]),
  ),
  ...Object.fromEntries(
    NEXT_DAY_STATES.map((state): [string, SlaTierRule] => [state, {
      state,
      tier: 'next_day',
      horizonDays: 1,
      physicianOnly: physicianOnly.has(state),
      minSlotsWindow: NEXT_DAY_WINDOW_MINIMUM,
      minSlotsSameDay: null,
    }]),
  ),
  ...Object.fromEntries(
    WITHIN_48H_STATES.map((state): [string, SlaTierRule] => [state, {
      state,
      tier: 'within_48h',
      horizonDays: 2,
      physicianOnly: physicianOnly.has(state),
      minSlotsWindow: null,
      minSlotsSameDay: null,
    }]),
  ),
});

/**
 * The rule for a state, or undefined if the state is not in the policy.
 *
 * Returns undefined rather than defaulting to `within_48h`: an unknown state
 * means the policy and the caller disagree about where we operate, and
 * silently assuming the loosest tier hides that.
 */
export function getSlaTierRule(stateAbbr: string): SlaTierRule | undefined {
  return SLA_TIER_BY_STATE[stateAbbr?.trim().toUpperCase()];
}

export function getSlaTier(stateAbbr: string): SlaTier | undefined {
  return getSlaTierRule(stateAbbr)?.tier;
}

/** Whether only physician slots count toward this state's SLA. */
export function isSlaPhysicianOnlyState(stateAbbr: string): boolean {
  return getSlaTierRule(stateAbbr)?.physicianOnly ?? false;
}

/** States in a given tier. */
export function statesInTier(tier: SlaTier): string[] {
  return Object.values(SLA_TIER_BY_STATE)
    .filter((rule) => rule.tier === tier)
    .map((rule) => rule.state);
}

const TIER_LABELS: Record<SlaTier, string> = {
  same_day: 'Same-day',
  next_day: 'By tomorrow',
  within_48h: 'Within 48 hours',
};

/** Member-facing tier label, matching the policy's wording. */
export function getSlaTierLabel(tier: SlaTier): string {
  return TIER_LABELS[tier];
}

const TIER_MEMBER_LANGUAGE: Record<SlaTier, string> = {
  same_day: 'We should have a visit available today.',
  next_day: 'We should have a visit available by tomorrow, though an appointment may not be available today.',
  within_48h: 'We should have a visit available within 48 hours, which may be today, tomorrow, or the following day.',
};

/**
 * Approved member-facing phrasing for a tier, verbatim from the policy's
 * "Member-facing language" section. Use this rather than composing your own
 * so we do not promise same-day availability in a non-same-day state.
 */
export function getSlaTierMemberLanguage(tier: SlaTier): string {
  return TIER_MEMBER_LANGUAGE[tier];
}
