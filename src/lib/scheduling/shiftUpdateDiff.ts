// Diff a provider's current published shifts against a proposed set (all times
// are Eastern minutes-from-midnight, matching schedule_build_rows). Only dates
// after `today` are touched; today and earlier always stay as they are.
export type ProposedShift = { date: string; start_min: number; end_min: number };
export type ExistingShift = { id: string; shift_date: string; start_min: number; end_min: number; hours: number };

export function diffProviderShifts(existing: ExistingShift[], proposed: ProposedShift[], today: string) {
  const key = (d: string, s: number, e: number) => `${d}|${s}|${e}`;
  const future = existing.filter((r) => r.shift_date > today);
  const proposedFuture = proposed.filter((p) => p.date > today && p.end_min > p.start_min);
  const proposedKeys = new Set(proposedFuture.map((p) => key(p.date, p.start_min, p.end_min)));
  const existingKeys = new Set(future.map((r) => key(r.shift_date, r.start_min, r.end_min)));
  const seen = new Set<string>();
  const add = proposedFuture.filter((p) => {
    const k = key(p.date, p.start_min, p.end_min);
    if (existingKeys.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const keptSeen = new Set<string>();
  const remove: ExistingShift[] = [];
  const keep: ExistingShift[] = [];
  for (const r of future) {
    const k = key(r.shift_date, r.start_min, r.end_min);
    if (proposedKeys.has(k) && !keptSeen.has(k)) { keptSeen.add(k); keep.push(r); } else remove.push(r);
  }
  return { add, remove, keep };
}

export function fmtEtMin(m: number): string {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${ap}`;
}
