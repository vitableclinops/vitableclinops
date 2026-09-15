/**
 * Warehouse-freshness gate for same-day / next-day coverage reads.
 *
 * WHY THIS EXISTS
 * Open-slot counts from the warehouse are always somewhat out of date,
 * because bookings reach it in batches. A reading of "12 slots open in PA
 * today" means "12 were open as of the last sync" — some are gone. Any
 * agent that acts on the raw number will occasionally report coverage that
 * no member can use.
 *
 * `useDataFreshness` already has an `isStale` helper, but its threshold is
 * 24 hours, which is appropriate for the monthly-planning tables it serves
 * and far too loose here: it would call a 6-hour-old reading "fresh" when
 * that is exactly a full sync cycle of blind spot.
 *
 * MEASURED FACTS (2026-09-15, against the Vitable warehouse, db 3)
 *
 * 1. The source -> warehouse sync runs every 6 hours, at roughly 02:02,
 *    08:02, 14:02 and 20:02 ET. Across the trailing 10 days the gap between
 *    consecutive Fivetran batches was 6.00h in 20 of 25 intervals, with
 *    occasional misses (one 12.0h gap on 09-08, one 29.4h gap on 09-10).
 *    So the lag at a random moment averages ~3h and reaches 6h just before
 *    a sync — but a missed batch can push it far past that, which is why
 *    `classifyFreshness` treats anything over one cycle as stale rather
 *    than assuming the schedule held.
 *
 * 2. Reading the raw landing zone does NOT help. `ac.ac_asclepius__
 *    appointment_appointment` and `dbt_production.int_availability_
 *    appointments_provider` had an identical newest booking timestamp, and
 *    the raw table contained ZERO bookings the dbt table was missing. Both
 *    are gated by the same Fivetran sync, so the lag is in the source ->
 *    warehouse hop, not in the dbt transformation. Pointing a real-time
 *    read at the raw table buys nothing; only a higher sync frequency (or a
 *    direct EHR read) moves this.
 *
 * 3. The size of the blind spot is bounded and small. Same/next-day
 *    bookings per business hour over the trailing 30 days, measured against
 *    ALL business hours (not only hours that had a booking), are below in
 *    SD_ND_BOOKINGS_PER_BUSINESS_HOUR. Only PA exceeds one booking per
 *    hour; at the average ~3h lag its open-slot count is overstated by
 *    about 4 slots, and every other state by about 1 or fewer.
 *
 * The practical consequence: staleness is worth CORRECTING FOR, not worth
 * blocking on. Subtract the expected bookings-since-sync before comparing
 * against a threshold, and surface the adjustment so a human can see it.
 */

/** Nominal hours between source -> warehouse syncs (measured, not assumed). */
export const WAREHOUSE_SYNC_INTERVAL_HOURS = 6;

/** Approximate ET hours at which sync batches land. */
export const WAREHOUSE_SYNC_HOURS_ET = [2, 8, 14, 20] as const;

/** Business-hour window used for the booking-rate measurement. */
export const BUSINESS_HOUR_START_ET = 8;
export const BUSINESS_HOUR_END_ET = 19;

/**
 * Same/next-day bookings per business hour, by state. Trailing 30 days as
 * of 2026-09-15, total bookings / all weekday 08:00-19:00 ET hours.
 *
 * Only states with enough volume to matter are listed; anything absent
 * falls back to DEFAULT_BOOKINGS_PER_BUSINESS_HOUR, which is deliberately
 * the lowest measured rate rather than zero so an unlisted state still
 * gets a nonzero correction.
 *
 * Refresh these periodically — they are a snapshot, not a constant of
 * nature. The query that produced them is in
 * src/lib/sameDay/README.md.
 */
export const SD_ND_BOOKINGS_PER_BUSINESS_HOUR: Readonly<Record<string, number>> = Object.freeze({
  PA: 1.317,
  TX: 0.409,
  FL: 0.377,
  NJ: 0.357,
  DE: 0.234,
  OH: 0.202,
  WA: 0.127,
  MI: 0.127,
  MD: 0.123,
  VA: 0.123,
  CO: 0.095,
  MN: 0.091,
  IL: 0.063,
  KY: 0.048,
  NC: 0.044,
});

export const DEFAULT_BOOKINGS_PER_BUSINESS_HOUR = 0.044;

export type FreshnessConfidence = 'fresh' | 'aging' | 'stale' | 'unknown';

export interface FreshnessAssessment {
  confidence: FreshnessConfidence;
  ageMinutes: number | null;
  /** True when the reading is recent enough to act on without caveat. */
  actionable: boolean;
  reason: string;
}

const MS_PER_MINUTE = 60_000;

/**
 * ET calendar parts for an instant. Uses Intl rather than manual offset
 * arithmetic so DST is handled correctly.
 */
function easternParts(at: Date): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(at);

  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Intl renders midnight as "24" in some ICU versions under hour12: false.
  const hour = Number(hourPart) % 24;
  return { hour, weekday: Math.max(0, weekdays.indexOf(weekdayPart)) };
}

function isBusinessHour(at: Date): boolean {
  const { hour, weekday } = easternParts(at);
  return weekday >= 1 && weekday <= 5
    && hour >= BUSINESS_HOUR_START_ET
    && hour <= BUSINESS_HOUR_END_ET;
}

/**
 * Business hours elapsed between two instants, counted in 15-minute steps
 * so a partial hour contributes proportionally.
 */
export function businessHoursBetween(from: Date, to: Date): number {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  if (to <= from) return 0;

  const stepMinutes = 15;
  const steps = Math.ceil((to.getTime() - from.getTime()) / (stepMinutes * MS_PER_MINUTE));

  // Guard against a wildly stale timestamp producing an unbounded loop.
  const maxSteps = (14 * 24 * 60) / stepMinutes;
  const bounded = Math.min(steps, maxSteps);

  let businessMinutes = 0;
  for (let i = 0; i < bounded; i += 1) {
    const stepStart = new Date(from.getTime() + i * stepMinutes * MS_PER_MINUTE);
    if (stepStart >= to) break;
    if (isBusinessHour(stepStart)) {
      const stepEnd = new Date(Math.min(stepStart.getTime() + stepMinutes * MS_PER_MINUTE, to.getTime()));
      businessMinutes += (stepEnd.getTime() - stepStart.getTime()) / MS_PER_MINUTE;
    }
  }
  return businessMinutes / 60;
}

/**
 * How trustworthy a reading taken at `lastSyncAt` is, as of `now`.
 *
 * `fresh`  - within half a sync cycle; the correction is small.
 * `aging`  - within one full cycle; expected, correct for it.
 * `stale`  - beyond one cycle, meaning a batch was missed. Do not act
 *            without checking the EHR.
 */
export function classifyFreshness(lastSyncAt: string | Date | null, now: Date = new Date()): FreshnessAssessment {
  if (!lastSyncAt) {
    return {
      confidence: 'unknown',
      ageMinutes: null,
      actionable: false,
      reason: 'No sync timestamp available; cannot tell how old this reading is.',
    };
  }

  const syncedAt = lastSyncAt instanceof Date ? lastSyncAt : new Date(lastSyncAt);
  if (Number.isNaN(syncedAt.getTime())) {
    return {
      confidence: 'unknown',
      ageMinutes: null,
      actionable: false,
      reason: 'Sync timestamp could not be parsed.',
    };
  }

  const ageMinutes = Math.max(0, Math.round((now.getTime() - syncedAt.getTime()) / MS_PER_MINUTE));
  const cycleMinutes = WAREHOUSE_SYNC_INTERVAL_HOURS * 60;

  if (ageMinutes > cycleMinutes) {
    return {
      confidence: 'stale',
      ageMinutes,
      actionable: false,
      reason: `Last sync was ${Math.round(ageMinutes / 60)}h ago, beyond the ${WAREHOUSE_SYNC_INTERVAL_HOURS}h cycle — a batch was likely missed.`,
    };
  }

  if (ageMinutes > cycleMinutes / 2) {
    return {
      confidence: 'aging',
      ageMinutes,
      actionable: true,
      reason: `Last sync was ${Math.round(ageMinutes / 60)}h ago; correct for bookings since then.`,
    };
  }

  return {
    confidence: 'fresh',
    ageMinutes,
    actionable: true,
    reason: `Last sync was ${ageMinutes}m ago.`,
  };
}

export interface AdjustedOpenSlots {
  state: string;
  /** Open slots as the warehouse reports them. */
  reportedOpen: number;
  /** Expected bookings landed since the sync, rounded up. */
  estimatedBookedSinceSync: number;
  /** reportedOpen minus the estimate, floored at zero. */
  adjustedOpen: number;
  freshness: FreshnessAssessment;
}

/**
 * Correct a reported open-slot count for bookings that have landed since
 * the last sync.
 *
 * The estimate is rounded UP, and the result floored at zero, so the
 * adjustment is deliberately conservative: it is better to investigate a
 * state that turns out to be fine than to report coverage that is already
 * gone.
 *
 * This corrects for bookings only. Cancellations since the sync free slots
 * back up and are not modelled, so `adjustedOpen` is a lower bound and the
 * true value sits between it and `reportedOpen`.
 */
export function adjustOpenSlotsForStaleness(params: {
  state: string;
  reportedOpen: number;
  lastSyncAt: string | Date | null;
  now?: Date;
}): AdjustedOpenSlots {
  const { state, reportedOpen, lastSyncAt } = params;
  const now = params.now ?? new Date();
  const freshness = classifyFreshness(lastSyncAt, now);

  const normalizedState = state?.trim().toUpperCase() ?? '';
  const rate = SD_ND_BOOKINGS_PER_BUSINESS_HOUR[normalizedState]
    ?? DEFAULT_BOOKINGS_PER_BUSINESS_HOUR;

  let estimatedBookedSinceSync = 0;
  if (lastSyncAt && freshness.ageMinutes !== null) {
    const syncedAt = lastSyncAt instanceof Date ? lastSyncAt : new Date(lastSyncAt);
    if (!Number.isNaN(syncedAt.getTime())) {
      const elapsedBusinessHours = businessHoursBetween(syncedAt, now);
      estimatedBookedSinceSync = Math.ceil(elapsedBusinessHours * rate);
    }
  }

  return {
    state: normalizedState,
    reportedOpen,
    estimatedBookedSinceSync,
    adjustedOpen: Math.max(0, reportedOpen - estimatedBookedSinceSync),
    freshness,
  };
}
