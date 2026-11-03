// Gap Finder math: network-wide daily telemedicine coverage vs expected demand.
// Homebase shifts carry no state, so gaps are measured for the whole network.

export const TELEMED_ROLES = ['NP Telemedicine Visits', 'MD-Telemedicine'];
export const WEEKS_PER_MONTH = 4.33;

export type ShiftLike = { start_at: string | null; end_at: string | null; scheduled_hours: number | null; role: string | null };

export type DailyGap = {
  date: string; // YYYY-MM-DD (America/Chicago)
  dow: number;
  scheduled: number;
  expected: number;
  gap: number; // positive = short
  coveragePct: number | null;
  holiday: string | null;
};

const CHICAGO = 'America/Chicago';

export function chicagoDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CHICAGO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function dowOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isTelemed(shift: ShiftLike): boolean {
  return !!shift.role && TELEMED_ROLES.includes(shift.role);
}

export function shiftHours(s: ShiftLike): number {
  if (s.scheduled_hours != null) return Number(s.scheduled_hours);
  if (s.start_at && s.end_at) return Math.max(0, (Date.parse(s.end_at) - Date.parse(s.start_at)) / 3_600_000);
  return 0;
}

/** Hours per date (Chicago) for telemedicine shifts. */
export function hoursByDate(shifts: ShiftLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shifts) {
    if (!s.start_at || !isTelemed(s)) continue;
    const d = chicagoDate(s.start_at);
    out.set(d, (out.get(d) ?? 0) + shiftHours(s));
  }
  return out;
}

/** Day-of-week shares (sum to 1) from historical daily hours; uniform fallback. */
export function dowShares(history: Map<string, number>): number[] {
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const [date, h] of history) {
    const w = dowOf(date);
    totals[w] += h;
    counts[w] += 1;
  }
  const avg = totals.map((t, i) => (counts[i] ? t / counts[i] : 0));
  const sum = avg.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Array(7).fill(1 / 7);
  return avg.map((a) => a / sum);
}

export const US_HOLIDAYS: Record<string, string> = {
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
  '2027-01-01': "New Year's Day",
  '2027-05-31': 'Memorial Day',
  '2027-07-05': 'Independence Day (obs.)',
  '2027-09-06': 'Labor Day',
};

export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

/** Expected daily hours = (monthly network target / 4.33) weekly x day-of-week share. */
export function buildDailyGaps(month: string, monthlyTargetHours: number, scheduled: Map<string, number>, shares: number[]): DailyGap[] {
  const weekly = monthlyTargetHours / WEEKS_PER_MONTH;
  return monthDates(month).map((date) => {
    const dow = dowOf(date);
    const expected = round1(weekly * shares[dow]);
    const sched = round1(scheduled.get(date) ?? 0);
    return {
      date,
      dow,
      scheduled: sched,
      expected,
      gap: round1(expected - sched),
      coveragePct: expected > 0 ? Math.round((sched / expected) * 100) : null,
      holiday: US_HOLIDAYS[date] ?? null,
    };
  });
}

export type CoverageBand = 'short' | 'tight' | 'covered' | 'none';
export function coverageBand(pct: number | null): CoverageBand {
  if (pct == null) return 'none';
  if (pct < 90) return 'short';
  if (pct <= 100) return 'tight';
  return 'covered';
}

export type OfferLabel = 'Fills a gap' | 'Marginal' | 'Adds to surplus';
/** Fills a gap when the day is short by at least 1 hour; Marginal within +/-1 hr; otherwise surplus. */
export function labelOffer(gapHours: number): OfferLabel {
  if (gapHours >= 1) return 'Fills a gap';
  if (gapHours > -1) return 'Marginal';
  return 'Adds to surplus';
}

/** Gap hours an offer closes (never more than the remaining gap). */
export function hoursClosed(gapHours: number, offeredHours: number): number {
  return round1(Math.max(0, Math.min(gapHours, offeredHours)));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
