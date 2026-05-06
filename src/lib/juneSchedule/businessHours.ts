// Operating hours in ET (minutes from midnight).
// Mon-Fri: 9am - 9pm ; Sat-Sun: 9am - 12pm.

export function operatingWindow(date: string): { startMin: number; endMin: number } {
  // date YYYY-MM-DD interpreted as a calendar day, no tz shift.
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun .. 6 Sat
  const isWeekend = dow === 0 || dow === 6;
  return {
    startMin: 9 * 60,
    endMin: isWeekend ? 12 * 60 : 21 * 60,
  };
}

export function clipToWindow(
  date: string,
  startMin: number,
  endMin: number,
): { startMin: number; endMin: number; clipped: boolean } {
  const w = operatingWindow(date);
  const s = Math.max(startMin, w.startMin);
  const e = Math.min(endMin, w.endMin);
  if (e <= s) return { startMin: s, endMin: s, clipped: true };
  const clipped = s !== startMin || e !== endMin;
  return { startMin: s, endMin: e, clipped };
}

export function parseTimeToMin(raw: string): number | null {
  // Accepts "02:15 PM", "9:00 AM", "14:30"
  const t = raw.trim();
  if (!t) return null;
  const ampm = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = parseInt(ampm[2], 10);
    const isPm = ampm[3].toUpperCase() === 'PM';
    if (h === 12) h = 0;
    if (isPm) h += 12;
    return h * 60 + min;
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
  return null;
}

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}