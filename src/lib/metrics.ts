/**
 * Shared metric formulas.
 *
 * When two pages need to display the same computed number, import from here
 * rather than re-implementing. Prevents silent drift between Ops Dashboard,
 * Demand Forecast, and License Optimizer.
 */

/**
 * Daily SLA target in visits-per-day, given a weekly demand forecast.
 * Formula: max(5, (weekly_visits / 5) × 1.5)
 *
 * Returns the exact float. Use this when the result feeds further math
 * (e.g. a coverage ratio). For display, use {@link slaTargetDailyRounded}.
 */
export function slaTargetDailyExact(weeklyVisits: number): number {
  return Math.max(5, (weeklyVisits / 5) * 1.5);
}

/**
 * Same as {@link slaTargetDailyExact} but rounded to an integer for UI.
 */
export function slaTargetDailyRounded(weeklyVisits: number): number {
  return Math.round(slaTargetDailyExact(weeklyVisits));
}

/**
 * Coverage ratio for Ops Dashboard: available daily slots vs. daily SLA target.
 * Returns null when either input is missing.
 *
 * NOTE: This is the slots-vs-SLA-target definition used by Ops Dashboard and
 * License Optimizer. It is NOT the same as Demand Matching Engine's
 * supply-hours / demand-hours ratio — those are different metrics.
 */
export function coverageRatioFromSlots(
  availableSlots: number | null,
  weeklyVisits: number | null,
): number | null {
  if (availableSlots === null || weeklyVisits === null) return null;
  const target = slaTargetDailyExact(weeklyVisits);
  if (target === 0) return null;
  return availableSlots / target;
}
