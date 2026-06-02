/**
 * Diff two `schedule_submissions.parsed_shifts` blobs for the Workbench
 * resubmission inbox.
 *
 * The blob is what `sync-jotform-submissions` writes — a record of widget
 * arrays plus unavailable_dates. Each widget value can be either a
 * JSON-encoded string or a real array (Jotform returns strings; some legacy
 * paths normalize to arrays). We tolerate both.
 *
 * Output:
 *   - normalized canonical shape (recurring / one_off / in_home / unavailable)
 *   - summary deltas: added, removed, modified
 *   - human-readable changelog strings ("Tuesday recurring extended to 19:00",
 *     "Jun 30 removed", etc.) for the inbox card
 */

const parseWidgetArray = (raw: unknown): Record<string, unknown>[] => {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is Record<string, unknown> => e != null && typeof e === 'object',
  );
};

const pad2 = (n: number) => String(n).padStart(2, '0');

const parseTimeToMin = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'AM' && h === 12) h = 0;
  if (ampm === 'PM' && h !== 12) h += 12;
  if (h < 0 || h > 24 || min < 0 || min >= 60) return null;
  return h * 60 + min;
};

const formatTime = (min: number): string => {
  const safe = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(safe / 60);
  const m = safe % 60;
  return `${pad2(h24)}:${pad2(m)}`;
};

const parseFormDate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`;
  return null;
};

const expandDateRange = (startIso: string, endIso: string): string[] => {
  const out: string[] = [];
  const s = new Date(`${startIso}T00:00:00Z`);
  const e = new Date(`${endIso}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return [startIso];
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
  }
  return out;
};

export type CanonicalRecurring = { dayOfWeek: string; startMin: number; endMin: number };
export type CanonicalDated = { date: string; startMin: number; endMin: number };

export type CanonicalSubmission = {
  recurring: CanonicalRecurring[];
  oneOff: CanonicalDated[];
  inHome: CanonicalDated[];
  unavailableDates: string[];
};

const recurringKey = (r: CanonicalRecurring) =>
  `${r.dayOfWeek.toLowerCase()}|${r.startMin}|${r.endMin}`;

const datedKey = (r: CanonicalDated) => `${r.date}|${r.startMin}|${r.endMin}`;

export function canonicalizeParsedShifts(parsedShifts: unknown): CanonicalSubmission {
  const out: CanonicalSubmission = {
    recurring: [],
    oneOff: [],
    inHome: [],
    unavailableDates: [],
  };
  if (!parsedShifts || typeof parsedShifts !== 'object' || Array.isArray(parsedShifts)) {
    return out;
  }
  const blob = parsedShifts as Record<string, unknown>;

  for (const e of parseWidgetArray(blob.recurring_virtual)) {
    const dow = String(e['Day of Week'] ?? '').trim();
    const s = parseTimeToMin(e['Start Time (ET)']);
    const t = parseTimeToMin(e['End Time (ET)']);
    if (!dow || s == null || t == null) continue;
    out.recurring.push({ dayOfWeek: dow, startMin: s, endMin: t });
  }
  for (const e of parseWidgetArray(blob.one_off_virtual)) {
    const date = parseFormDate(e['Date']);
    const s = parseTimeToMin(e['Start Time (ET)']);
    const t = parseTimeToMin(e['End Time (ET)']);
    if (!date || s == null || t == null) continue;
    out.oneOff.push({ date, startMin: s, endMin: t });
  }
  for (const e of parseWidgetArray(blob.in_home_clinic)) {
    const date = parseFormDate(e['Date']);
    const s = parseTimeToMin(e['Start Time (ET)']);
    const t = parseTimeToMin(e['End Time (ET)']);
    if (!date || s == null || t == null) continue;
    out.inHome.push({ date, startMin: s, endMin: t });
  }
  const datesSet = new Set<string>();
  for (const e of parseWidgetArray(blob.unavailable_dates)) {
    const start = parseFormDate(e['Start Date']) ?? parseFormDate(e['Date']);
    const end = parseFormDate(e['End Date']) ?? start;
    if (!start || !end) continue;
    for (const d of expandDateRange(start, end)) datesSet.add(d);
  }
  out.unavailableDates = Array.from(datesSet).sort();
  // Stable sort for diff reliability.
  out.recurring.sort((a, b) => recurringKey(a).localeCompare(recurringKey(b)));
  out.oneOff.sort((a, b) => datedKey(a).localeCompare(datedKey(b)));
  out.inHome.sort((a, b) => datedKey(a).localeCompare(datedKey(b)));
  return out;
}

export type SubmissionDiff = {
  recurring: {
    added: CanonicalRecurring[];
    removed: CanonicalRecurring[];
    modified: Array<{ before: CanonicalRecurring; after: CanonicalRecurring }>;
  };
  oneOff: {
    added: CanonicalDated[];
    removed: CanonicalDated[];
    modified: Array<{ before: CanonicalDated; after: CanonicalDated }>;
  };
  inHome: {
    added: CanonicalDated[];
    removed: CanonicalDated[];
    modified: Array<{ before: CanonicalDated; after: CanonicalDated }>;
  };
  unavailable: {
    added: string[];
    removed: string[];
  };
  // Dropped from the active diff because they're in the past relative to
  // the configured cutoff. Providers commonly add hours incrementally
  // during a month (May 8-11 listed in the first submission, then May
  // 12-14 added in a follow-up). The earlier dates aren't a "removal" —
  // the provider just didn't repeat them in the new submission. We
  // suppress them so the inbox doesn't flag stale past entries as
  // changes that need review.
  filteredPastCount: number;
  summary: string[];
  hasChanges: boolean;
};

const diffDated = (
  before: CanonicalDated[],
  after: CanonicalDated[],
): { added: CanonicalDated[]; removed: CanonicalDated[]; modified: Array<{ before: CanonicalDated; after: CanonicalDated }> } => {
  const beforeByDate = new Map<string, CanonicalDated>();
  for (const r of before) beforeByDate.set(r.date, r);
  const afterByDate = new Map<string, CanonicalDated>();
  for (const r of after) afterByDate.set(r.date, r);

  const added: CanonicalDated[] = [];
  const removed: CanonicalDated[] = [];
  const modified: Array<{ before: CanonicalDated; after: CanonicalDated }> = [];

  for (const [date, b] of beforeByDate) {
    const a = afterByDate.get(date);
    if (!a) {
      removed.push(b);
      continue;
    }
    if (a.startMin !== b.startMin || a.endMin !== b.endMin) {
      modified.push({ before: b, after: a });
    }
  }
  for (const [date, a] of afterByDate) {
    if (!beforeByDate.has(date)) added.push(a);
  }
  return { added, removed, modified };
};

const diffRecurring = (
  before: CanonicalRecurring[],
  after: CanonicalRecurring[],
) => {
  const beforeByDow = new Map<string, CanonicalRecurring[]>();
  for (const r of before) {
    const k = r.dayOfWeek.toLowerCase();
    if (!beforeByDow.has(k)) beforeByDow.set(k, []);
    beforeByDow.get(k)!.push(r);
  }
  const afterByDow = new Map<string, CanonicalRecurring[]>();
  for (const r of after) {
    const k = r.dayOfWeek.toLowerCase();
    if (!afterByDow.has(k)) afterByDow.set(k, []);
    afterByDow.get(k)!.push(r);
  }

  const added: CanonicalRecurring[] = [];
  const removed: CanonicalRecurring[] = [];
  const modified: Array<{ before: CanonicalRecurring; after: CanonicalRecurring }> = [];

  const allDows = new Set<string>([...beforeByDow.keys(), ...afterByDow.keys()]);
  for (const dow of allDows) {
    const b = beforeByDow.get(dow) ?? [];
    const a = afterByDow.get(dow) ?? [];
    // Single-shift dow with a time change → modified, not add+remove
    if (b.length === 1 && a.length === 1) {
      const [bb] = b;
      const [aa] = a;
      if (bb.startMin === aa.startMin && bb.endMin === aa.endMin) continue;
      modified.push({ before: bb, after: aa });
      continue;
    }
    const bKeys = new Set(b.map(recurringKey));
    const aKeys = new Set(a.map(recurringKey));
    for (const r of b) if (!aKeys.has(recurringKey(r))) removed.push(r);
    for (const r of a) if (!bKeys.has(recurringKey(r))) added.push(r);
  }
  return { added, removed, modified };
};

const titleDow = (s: string) =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();

const friendlyDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const describeRange = (startMin: number, endMin: number) =>
  `${formatTime(startMin)}–${formatTime(endMin)}`;

const summarizeModifiedTimes = (
  before: { startMin: number; endMin: number },
  after: { startMin: number; endMin: number },
): string => {
  if (before.startMin === after.startMin && before.endMin !== after.endMin) {
    return before.endMin < after.endMin
      ? `end extended to ${formatTime(after.endMin)}`
      : `end pulled back to ${formatTime(after.endMin)}`;
  }
  if (before.endMin === after.endMin && before.startMin !== after.startMin) {
    return before.startMin > after.startMin
      ? `start pushed earlier to ${formatTime(after.startMin)}`
      : `start pushed later to ${formatTime(after.startMin)}`;
  }
  return `time changed from ${describeRange(before.startMin, before.endMin)} to ${describeRange(after.startMin, after.endMin)}`;
};

export function diffParsedShifts(
  before: unknown,
  after: unknown,
  options: {
    /** ISO date (YYYY-MM-DD). Dated changes (one-off, in-home, unavailable)
     *  whose date is strictly before this are dropped from the diff —
     *  providers add hours incrementally during a month and we don't want
     *  past dates that weren't re-listed to flag as removals. Defaults to
     *  today (UTC). */
    ignoreDatesBefore?: string;
  } = {},
): SubmissionDiff {
  const a = canonicalizeParsedShifts(before);
  const b = canonicalizeParsedShifts(after);

  const today = (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  })();
  const cutoff = options.ignoreDatesBefore ?? today;
  const isPast = (iso: string) => iso < cutoff;

  const rawRecurring = diffRecurring(a.recurring, b.recurring);
  const rawOneOff = diffDated(a.oneOff, b.oneOff);
  const rawInHome = diffDated(a.inHome, b.inHome);

  let filteredPastCount = 0;

  const filterDated = (
    raw: { added: CanonicalDated[]; removed: CanonicalDated[]; modified: Array<{ before: CanonicalDated; after: CanonicalDated }> },
  ) => {
    const added: CanonicalDated[] = [];
    const removed: CanonicalDated[] = [];
    const modified: Array<{ before: CanonicalDated; after: CanonicalDated }> = [];
    for (const r of raw.added) {
      if (isPast(r.date)) filteredPastCount++;
      else added.push(r);
    }
    for (const r of raw.removed) {
      if (isPast(r.date)) filteredPastCount++;
      else removed.push(r);
    }
    for (const r of raw.modified) {
      if (isPast(r.before.date) && isPast(r.after.date)) filteredPastCount++;
      else modified.push(r);
    }
    return { added, removed, modified };
  };

  const recurring = rawRecurring;
  const oneOff = filterDated(rawOneOff);
  const inHome = filterDated(rawInHome);

  const beforeUnavail = new Set(a.unavailableDates);
  const afterUnavail = new Set(b.unavailableDates);
  const unavailAdded: string[] = [];
  const unavailRemoved: string[] = [];
  for (const d of afterUnavail) {
    if (!beforeUnavail.has(d)) {
      if (isPast(d)) filteredPastCount++;
      else unavailAdded.push(d);
    }
  }
  for (const d of beforeUnavail) {
    if (!afterUnavail.has(d)) {
      if (isPast(d)) filteredPastCount++;
      else unavailRemoved.push(d);
    }
  }

  // Human-readable summary lines, batched by kind.
  const lines: string[] = [];
  for (const r of recurring.modified) {
    lines.push(
      `${titleDow(r.before.dayOfWeek)} recurring: ${summarizeModifiedTimes(r.before, r.after)} (was ${describeRange(r.before.startMin, r.before.endMin)})`,
    );
  }
  for (const r of recurring.added) {
    lines.push(
      `Added recurring ${titleDow(r.dayOfWeek)} ${describeRange(r.startMin, r.endMin)}`,
    );
  }
  for (const r of recurring.removed) {
    lines.push(
      `Removed recurring ${titleDow(r.dayOfWeek)} ${describeRange(r.startMin, r.endMin)}`,
    );
  }
  for (const r of oneOff.modified) {
    lines.push(
      `${friendlyDate(r.before.date)} one-off: ${summarizeModifiedTimes(r.before, r.after)}`,
    );
  }
  for (const r of oneOff.added) {
    lines.push(`Added one-off ${friendlyDate(r.date)} ${describeRange(r.startMin, r.endMin)}`);
  }
  for (const r of oneOff.removed) {
    lines.push(`Removed one-off ${friendlyDate(r.date)} ${describeRange(r.startMin, r.endMin)}`);
  }
  for (const r of inHome.modified) {
    lines.push(
      `${friendlyDate(r.before.date)} in-home: ${summarizeModifiedTimes(r.before, r.after)}`,
    );
  }
  for (const r of inHome.added) {
    lines.push(`Added in-home ${friendlyDate(r.date)} ${describeRange(r.startMin, r.endMin)}`);
  }
  for (const r of inHome.removed) {
    lines.push(`Removed in-home ${friendlyDate(r.date)} ${describeRange(r.startMin, r.endMin)}`);
  }
  if (unavailAdded.length) {
    lines.push(`Added ${unavailAdded.length} day off: ${unavailAdded.map(friendlyDate).join(', ')}`);
  }
  if (unavailRemoved.length) {
    lines.push(
      `Removed ${unavailRemoved.length} day off: ${unavailRemoved.map(friendlyDate).join(', ')}`,
    );
  }

  const hasChanges =
    recurring.added.length > 0 ||
    recurring.removed.length > 0 ||
    recurring.modified.length > 0 ||
    oneOff.added.length > 0 ||
    oneOff.removed.length > 0 ||
    oneOff.modified.length > 0 ||
    inHome.added.length > 0 ||
    inHome.removed.length > 0 ||
    inHome.modified.length > 0 ||
    unavailAdded.length > 0 ||
    unavailRemoved.length > 0;

  return {
    recurring,
    oneOff,
    inHome,
    unavailable: { added: unavailAdded, removed: unavailRemoved },
    filteredPastCount,
    summary: lines,
    hasChanges,
  };
}

export type ProviderNotes = {
  comments: string | null;
  feedback: string | null;
  hasContent: boolean;
};

/**
 * Pull the free-text "comments" and "feedback" fields out of a Jotform
 * parsed_shifts blob. Treat common placeholder values ("n/a", "none", ".",
 * "—", empty/whitespace) as no content so the UI doesn't surface noise.
 *
 * These fields hold the most operationally-important provider context:
 *   - "I already have clinics scheduled on 6/9 (Home Care Concepts)…"
 *   - "Please remove me from the 9-1pm shift on Friday 5/1, available 2-5pm"
 *   - "This is a resubmission of May schedule"
 *   - "Changing my recurring schedule to Mondays 930-530 going forward"
 *   - "Approved by Kate for 30 min time slots…"
 * Surfacing them is a >10x signal-to-noise win for review.
 */
const PLACEHOLDER_PATTERNS = [
  /^n[\\s/]?\.?\s*a\.?$/i,  // n/a, n.a., na
  /^none$/i,
  /^nope$/i,
  /^nothing$/i,
  /^no$/i,
  /^[.\-—]+$/, // ., -, —
];

const isPlaceholder = (raw: string): boolean => {
  const s = raw.trim();
  if (s.length === 0) return true;
  return PLACEHOLDER_PATTERNS.some(re => re.test(s));
};

const cleanNote = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || isPlaceholder(s)) return null;
  return s;
};

export function extractProviderNotes(parsedShifts: unknown): ProviderNotes {
  if (!parsedShifts || typeof parsedShifts !== 'object' || Array.isArray(parsedShifts)) {
    return { comments: null, feedback: null, hasContent: false };
  }
  const blob = parsedShifts as Record<string, unknown>;
  const comments = cleanNote(blob.comments);
  const feedback = cleanNote(blob.feedback);
  return {
    comments,
    feedback,
    hasContent: !!(comments || feedback),
  };
}

// Computes total weekly hours implied by canonical recurring + one-off + in-home
// for a quick "hours delta" view in the inbox card.
export function canonicalShiftHours(c: CanonicalSubmission): {
  recurringWeekly: number;
  oneOffTotal: number;
  inHomeTotal: number;
} {
  const sumDated = (arr: CanonicalDated[]) =>
    arr.reduce((acc, r) => acc + (r.endMin - r.startMin) / 60, 0);
  const sumRec = (arr: CanonicalRecurring[]) =>
    arr.reduce((acc, r) => acc + (r.endMin - r.startMin) / 60, 0);
  return {
    recurringWeekly: Math.round(sumRec(c.recurring) * 10) / 10,
    oneOffTotal: Math.round(sumDated(c.oneOff) * 10) / 10,
    inHomeTotal: Math.round(sumDated(c.inHome) * 10) / 10,
  };
}
