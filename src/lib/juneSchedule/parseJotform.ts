import Papa from 'papaparse';
import { providerKey, normEmail } from './normalize';
import { parseTimeToMin } from './businessHours';
import type { ShiftCandidate } from './types';

export interface SubmissionRow {
  key: string;
  name: string;
  email: string | null;
  submittedAt: number; // ms
  forMonth: string; // raw "June"
  blackouts: Array<{ start: string; end: string }>;
  recurring: Array<{ dow: string; startMin: number; endMin: number }>;
  oneOff: Array<{ date: string; startMin: number; endMin: number }>;
  inHome: Array<{ date: string; startMin: number; endMin: number }>;
}

const DOW_TO_IDX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function parseRecurringBlock(text: string): SubmissionRow['recurring'] {
  if (!text) return [];
  const out: SubmissionRow['recurring'] = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/Day of Week:\s*([A-Za-z]+),\s*Start Time \(ET\):\s*([0-9:]+\s*[AP]M),\s*End Time \(ET\):\s*([0-9:]+\s*[AP]M)/i);
    if (!m) continue;
    const s = parseTimeToMin(m[2]);
    const e = parseTimeToMin(m[3]);
    if (s == null || e == null || e <= s) continue;
    out.push({ dow: m[1].toLowerCase(), startMin: s, endMin: e });
  }
  return out;
}

function parseDateBlock(text: string): Array<{ date: string; startMin: number; endMin: number }> {
  if (!text) return [];
  const out: Array<{ date: string; startMin: number; endMin: number }> = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/Date:\s*(\d{2})-(\d{2})-(\d{4}),\s*Start Time \(ET\):\s*([0-9:]+\s*[AP]M),\s*End Time \(ET\):\s*([0-9:]+\s*[AP]M)/i);
    if (!m) continue;
    const date = `${m[3]}-${m[1]}-${m[2]}`;
    const s = parseTimeToMin(m[4]);
    const e = parseTimeToMin(m[5]);
    if (s == null || e == null || e <= s) continue;
    out.push({ date, startMin: s, endMin: e });
  }
  return out;
}

function parseBlackouts(text: string): SubmissionRow['blackouts'] {
  if (!text) return [];
  const out: SubmissionRow['blackouts'] = [];
  // Pattern: Start Date: MM-DD-YYYY, End Date: MM-DD-YYYY
  const re = /Start Date:\s*(\d{2})-(\d{2})-(\d{4}),?\s*End Date:\s*(\d{2})-(\d{2})-(\d{4})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      start: `${m[3]}-${m[1]}-${m[2]}`,
      end: `${m[6]}-${m[4]}-${m[5]}`,
    });
  }
  return out;
}

function parseSubmittedAt(s: string): number {
  const d = new Date(s);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export function parseJotformCsv(text: string): SubmissionRow[] {
  const r = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const out: SubmissionRow[] = [];
  for (const row of r.data) {
    const name = (row['Full Name'] ?? '').trim();
    if (!name) continue;
    const email = normEmail(row['Vitable Email']);
    out.push({
      key: providerKey(name, email),
      name,
      email,
      submittedAt: parseSubmittedAt(row['Submission Date'] ?? ''),
      forMonth: (row['For which month are you submitting hours?'] ?? '').trim(),
      blackouts: parseBlackouts(row['When will you be unavailable to work?'] ?? ''),
      recurring: parseRecurringBlock(row['What days and times are you available for recurring weekly virtual shifts?'] ?? ''),
      oneOff: parseDateBlock(row['What dates and times are you available for one-off virtual shifts?'] ?? ''),
      inHome: parseDateBlock(row['What dates and times are you available for in-home and clinic shifts?'] ?? ''),
    });
  }
  return out;
}

// Latest submission per provider for the target month, then expand to candidate shifts.
// Spec: "each provider's most recent submission should be used overwriting previously submitted dates
// and simply adding newly submitted dates" — we use latest submission's recurring/blackout rules,
// then UNION one-off dates from older submissions for the same month that don't collide.
export function buildShiftCandidates(
  submissions: SubmissionRow[],
  targetMonth: string, // YYYY-MM-01
): ShiftCandidate[] {
  const [yy, mm] = targetMonth.split('-').map(Number);
  const monthIdx = mm - 1;
  const monthName = new Date(Date.UTC(yy, monthIdx, 1)).toLocaleString('en-US', { month: 'long' });

  const forMonth = submissions.filter(
    s => !s.forMonth || s.forMonth.toLowerCase().includes(monthName.toLowerCase()),
  );

  const byKey = new Map<string, SubmissionRow[]>();
  for (const s of forMonth) {
    const arr = byKey.get(s.key) ?? [];
    arr.push(s);
    byKey.set(s.key, arr);
  }

  // Days in month
  const daysInMonth = new Date(Date.UTC(yy, monthIdx + 1, 0)).getUTCDate();
  const dateList: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dateList.push(`${yy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const out: ShiftCandidate[] = [];

  for (const [key, subs] of byKey) {
    subs.sort((a, b) => b.submittedAt - a.submittedAt);
    const latest = subs[0];
    const olderOneOffs: Array<{ date: string; startMin: number; endMin: number; source: 'one_off' | 'in_home' }> = [];
    for (const s of subs.slice(1)) {
      for (const o of s.oneOff) olderOneOffs.push({ ...o, source: 'one_off' });
      for (const o of s.inHome) olderOneOffs.push({ ...o, source: 'in_home' });
    }

    const blackoutHits = (date: string) =>
      latest.blackouts.some(b => date >= b.start && date <= b.end);

    // Recurring expansion across the month
    for (const rec of latest.recurring) {
      const dowIdx = DOW_TO_IDX[rec.dow];
      if (dowIdx == null) continue;
      for (const date of dateList) {
        const [y, m, d] = date.split('-').map(Number);
        const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (wd !== dowIdx) continue;
        if (blackoutHits(date)) continue;
        out.push(makeShift(latest, date, rec.startMin, rec.endMin, 'recurring'));
      }
    }

    // Latest one-offs
    for (const o of latest.oneOff) {
      if (blackoutHits(o.date)) continue;
      out.push(makeShift(latest, o.date, o.startMin, o.endMin, 'one_off'));
    }
    for (const o of latest.inHome) {
      if (blackoutHits(o.date)) continue;
      out.push(makeShift(latest, o.date, o.startMin, o.endMin, 'in_home'));
    }

    // Older one-offs added if not duplicating an existing latest entry
    const seen = new Set(out.map(s => s.providerKey === latest.key ? `${s.date}|${s.startMin}|${s.endMin}` : ''));
    for (const o of olderOneOffs) {
      const sig = `${o.date}|${o.startMin}|${o.endMin}`;
      if (seen.has(sig)) continue;
      if (blackoutHits(o.date)) continue;
      out.push(makeShift(latest, o.date, o.startMin, o.endMin, o.source));
    }
  }

  // Deterministic order: date → start → name
  out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.startMin - b.startMin || a.providerName.localeCompare(b.providerName),
  );
  return out;
}

function makeShift(
  s: SubmissionRow,
  date: string,
  startMin: number,
  endMin: number,
  source: ShiftCandidate['source'],
): ShiftCandidate {
  return {
    providerKey: s.key,
    providerName: s.name,
    date,
    startMin,
    endMin,
    hours: (endMin - startMin) / 60,
    source,
    rawStart: minToStr(startMin),
    rawEnd: minToStr(endMin),
  };
}

function minToStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}