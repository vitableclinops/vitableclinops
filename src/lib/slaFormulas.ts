/**
 * Centralized capacity & SLA formulas. Single source of truth for
 * Ops Dashboard, Demand Forecast, License Optimizer, and any other
 * page that compares supply to demand.
 *
 * Units are explicit:
 *   - VISIT      = one patient encounter
 *   - SLOT       = one bookable 30-min appointment (1 slot ≈ 1 visit)
 *   - HOUR       = provider clinical hour (1 hour = 2 slots)
 *
 * Standard:
 *   - Each visit consumes 0.5 provider hours (1 slot).
 *   - Daily demand = weekly_visits / 5 working days.
 *   - SLA target (slots/day) = daily_demand × buffer.
 *   - SLA target (hours/day) = slots × 0.5.
 *   - Coverage % = available_slots / sla_target_slots (or hours/hours).
 */

export const SLOTS_PER_HOUR = 2;
export const HOURS_PER_SLOT = 0.5;
export const WORKING_DAYS_PER_WEEK = 5;
export const DEFAULT_SLA_BUFFER = 1.5;

export function dailyDemandVisits(weeklyVisits: number): number {
  return weeklyVisits / WORKING_DAYS_PER_WEEK;
}

/** SLA target in slots/day. Live from weekly forecast — no floor. */
export function slaTargetSlots(weeklyVisits: number, buffer: number = DEFAULT_SLA_BUFFER): number {
  return dailyDemandVisits(weeklyVisits) * buffer;
}

/** SLA target in hours/day. */
export function slaTargetHours(weeklyVisits: number, buffer: number = DEFAULT_SLA_BUFFER): number {
  return slaTargetSlots(weeklyVisits, buffer) * HOURS_PER_SLOT;
}

/** Total weekly clinical hours needed (no buffer — raw demand). */
export function weeklyHoursNeeded(weeklyVisits: number): number {
  return weeklyVisits * HOURS_PER_SLOT;
}

/** Total weekly clinical hours including buffer. */
export function weeklyHoursWithBuffer(weeklyVisits: number, buffer: number = DEFAULT_SLA_BUFFER): number {
  return weeklyVisits * HOURS_PER_SLOT * buffer;
}

export function slotsToHours(slots: number): number {
  return slots * HOURS_PER_SLOT;
}

export function hoursToSlots(hours: number): number {
  return hours * SLOTS_PER_HOUR;
}

/** Coverage % as 0..1+ (e.g. 1.0 = exactly meeting target). */
export function coverageRatio(availableSlots: number, targetSlots: number): number | null {
  if (targetSlots <= 0) return null;
  return availableSlots / targetSlots;
}

export type WeekStatus = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';

export function computeWeekStatus(
  availableSlots: number | null,
  hasData: boolean,
  targetSlots: number | null,
): WeekStatus {
  if (!hasData) return 'no_data';
  if (availableSlots === null || availableSlots === 0) return 'zero';
  // No forecast → fall back to a permissive 1-slot threshold so we don't
  // flash CRITICAL on every state with missing forecast data.
  if (targetSlots == null || targetSlots <= 0) return availableSlots > 0 ? 'ok' : 'zero';
  if (availableSlots >= targetSlots) return 'ok';
  if (availableSlots >= targetSlots * 0.5) return 'low';
  return 'critical';
}

/** Round display values to 1 decimal place. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
