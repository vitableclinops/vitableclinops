/**
 * Shared reader for public.sla_tier_by_state_current.
 *
 * Edge functions should call `loadSlaTierRules` rather than carrying their
 * own copy of the tier or physician-only state lists, so that a rule change
 * in the table takes effect without a redeploy.
 *
 * The static FALLBACK_SLA_TIER_RULES below is used only when the read
 * fails. That keeps a transient database problem from silently turning the
 * physician-only rule off — which would let the alert recommend NP-only
 * coverage in a state that requires a physician — at the cost of the
 * fallback going stale if the table changes. `loadSlaTierRules` always
 * reports which source it used so the caller can surface it.
 */

export type SlaTier = 'same_day' | 'next_day' | 'within_48h';

export interface SlaTierRule {
  state: string;
  tier: SlaTier;
  horizonDays: number;
  physicianOnly: boolean;
  minSlotsWindow: number | null;
  minSlotsSameDay: number | null;
}

export type SlaTierRules = Map<string, SlaTierRule>;

/**
 * Mirror of the Notion SD/ND SLA Policy effective 2026-09-02, matching the
 * seed in migration 20260915160000_sla_tier_by_state.sql. Only the fields
 * edge functions actually branch on are spelled out; everything not listed
 * is within_48h with no policy minimum.
 */
const PHYSICIAN_ONLY = ['AL', 'GA', 'IN', 'LA', 'MS', 'MO', 'SC', 'TN'];
const SAME_DAY = ['NJ', 'PA', 'FL', 'OH', 'TX', 'VA', 'DE'];
const NEXT_DAY = ['IL', 'WA', 'MD', 'IN', 'GA'];
const WITHIN_48H = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DC', 'HI', 'ID', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NM', 'NY', 'NC', 'ND', 'OK', 'OR', 'RI', 'SC', 'SD', 'TN', 'UT', 'VT',
  'WV', 'WI', 'WY',
];
const SAME_DAY_WINDOW_MINIMUM_OVERRIDES: Record<string, number> = { VA: 2 };

function buildFallback(): SlaTierRules {
  const physicianOnly = new Set(PHYSICIAN_ONLY);
  const rules: SlaTierRules = new Map();

  for (const state of SAME_DAY) {
    rules.set(state, {
      state,
      tier: 'same_day',
      horizonDays: 1,
      physicianOnly: physicianOnly.has(state),
      minSlotsWindow: SAME_DAY_WINDOW_MINIMUM_OVERRIDES[state] ?? 5,
      minSlotsSameDay: 1,
    });
  }
  for (const state of NEXT_DAY) {
    rules.set(state, {
      state,
      tier: 'next_day',
      horizonDays: 1,
      physicianOnly: physicianOnly.has(state),
      minSlotsWindow: 2,
      minSlotsSameDay: null,
    });
  }
  for (const state of WITHIN_48H) {
    rules.set(state, {
      state,
      tier: 'within_48h',
      horizonDays: 2,
      physicianOnly: physicianOnly.has(state),
      minSlotsWindow: null,
      minSlotsSameDay: null,
    });
  }
  return rules;
}

export const FALLBACK_SLA_TIER_RULES: SlaTierRules = buildFallback();

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => Promise<{ data: unknown; error: unknown }>;
  };
};

function isSlaTier(value: unknown): value is SlaTier {
  return value === 'same_day' || value === 'next_day' || value === 'within_48h';
}

function toNullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface LoadSlaTierRulesResult {
  rules: SlaTierRules;
  source: 'table' | 'fallback';
  warning: string | null;
}

/**
 * Read the SLA rules in force today. Never throws: on any failure it
 * returns the static fallback plus a warning for the caller to surface.
 */
export async function loadSlaTierRules(supabase: SupabaseLike): Promise<LoadSlaTierRulesResult> {
  try {
    const { data, error } = await supabase
      .from('sla_tier_by_state_current')
      .select('state, sla_tier, horizon_days, physician_only, min_slots_window, min_slots_sameday');

    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        rules: FALLBACK_SLA_TIER_RULES,
        source: 'fallback',
        warning: `Could not read sla_tier_by_state_current (${message}); using built-in SLA policy copy.`,
      };
    }

    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    const rules: SlaTierRules = new Map();
    for (const row of rows) {
      const state = String(row.state ?? '').trim().toUpperCase();
      if (!state || !isSlaTier(row.sla_tier)) continue;
      rules.set(state, {
        state,
        tier: row.sla_tier,
        horizonDays: toNullableInt(row.horizon_days) ?? 2,
        physicianOnly: row.physician_only === true,
        minSlotsWindow: toNullableInt(row.min_slots_window),
        minSlotsSameDay: toNullableInt(row.min_slots_sameday),
      });
    }

    if (rules.size === 0) {
      return {
        rules: FALLBACK_SLA_TIER_RULES,
        source: 'fallback',
        warning: 'sla_tier_by_state_current returned no usable rows; using built-in SLA policy copy.',
      };
    }

    return { rules, source: 'table', warning: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      rules: FALLBACK_SLA_TIER_RULES,
      source: 'fallback',
      warning: `Failed to load sla_tier_by_state_current (${message}); using built-in SLA policy copy.`,
    };
  }
}

export function getSlaTierRule(rules: SlaTierRules, state: string): SlaTierRule | undefined {
  return rules.get(String(state ?? '').trim().toUpperCase());
}

/**
 * Whether only physician slots count toward this state's SLA.
 *
 * Defaults to false for an unknown state, matching the previous
 * hardcoded-Set behaviour: a state absent from the policy is treated as
 * having no physician-only requirement.
 */
export function isSlaPhysicianOnlyState(rules: SlaTierRules, state: string): boolean {
  return getSlaTierRule(rules, state)?.physicianOnly ?? false;
}

export interface PolicyFloorBreach {
  /** Open slots across the state's horizon fell under min_slots_window. */
  windowShortfall: number | null;
  /**
   * Open slots TODAY fell under min_slots_sameday.
   *
   * Null means either the state has no same-day floor, or the caller could
   * not supply a same-day-only count. Those are different situations, so
   * `sameDayMeasurable` distinguishes them.
   */
  sameDayShortfall: number | null;
  /**
   * False when the state has a same-day floor that could NOT be evaluated
   * because no same-day-only slot count was available. A caller must not
   * read this as "the floor is met".
   */
  sameDayMeasurable: boolean;
}

export interface PolicyFloorInput {
  /**
   * Open slots in the state's SLA window.
   *
   * IMPORTANT: this is a window total, not a single day. Metabase card 2431
   * (`same_next_day_available_slots`) already reports the today+tomorrow
   * window as a single value per date, verified against the availability
   * fact table across 408 state-days (95% exact match, versus 9% for a
   * same-day-only reading). Pass that value directly — do NOT add the
   * "today" and "tomorrow" rows together, which double-counts tomorrow.
   */
  windowSlots: number;
  /**
   * Open slots TODAY only, or null when unavailable.
   *
   * The card above cannot supply this: its per-date value spans two days.
   * The underlying model does expose a true per-day `available_slots`
   * column, but no parameterless card surfaces it for the current date.
   * Pass null rather than substituting the window total, which would make
   * the same-day floor unfalsifiable.
   */
  sameDaySlots: number | null;
}

/**
 * Compare open slots against the policy floors for a state.
 *
 * Two separate tests, mirroring Metabase question 3951: the window minimum
 * is counted across the SLA window, while the same-day minimum applies to
 * today alone. A single combined threshold can pass while a state has
 * almost no same-day capacity, which breaks the member-facing promise.
 *
 * KNOWN OVER-COUNT FOR next_day STATES
 * The policy sets their minimum as "2 visits, excluding same-day", but the
 * available window metric spans today and tomorrow together and cannot be
 * narrowed to tomorrow alone. Their window check is therefore more
 * generous than the policy: it can pass on same-day slots that the policy
 * would exclude. It never produces a false breach, only a missed one.
 *
 * Returns null shortfalls where the policy sets no minimum, so a caller can
 * distinguish "met the floor" from "there is no floor".
 */
export function checkPolicyFloors(
  rule: SlaTierRule | undefined,
  input: PolicyFloorInput,
): PolicyFloorBreach {
  if (!rule) {
    return { windowShortfall: null, sameDayShortfall: null, sameDayMeasurable: true };
  }

  const windowSlots = Number.isFinite(input.windowSlots) ? input.windowSlots : 0;

  let windowShortfall: number | null = null;
  if (rule.minSlotsWindow !== null) {
    windowShortfall = windowSlots < rule.minSlotsWindow
      ? rule.minSlotsWindow - windowSlots
      : 0;
  }

  let sameDayShortfall: number | null = null;
  let sameDayMeasurable = true;
  if (rule.minSlotsSameDay !== null) {
    if (input.sameDaySlots === null || !Number.isFinite(input.sameDaySlots)) {
      sameDayMeasurable = false;
    } else {
      sameDayShortfall = input.sameDaySlots < rule.minSlotsSameDay
        ? rule.minSlotsSameDay - input.sameDaySlots
        : 0;
    }
  }

  return { windowShortfall, sameDayShortfall, sameDayMeasurable };
}

/** True when any policy floor the state actually has is unmet. */
export function breachesPolicyFloor(breach: PolicyFloorBreach): boolean {
  return (breach.windowShortfall ?? 0) > 0 || (breach.sameDayShortfall ?? 0) > 0;
}
