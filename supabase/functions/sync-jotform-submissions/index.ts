/**
 * sync-jotform-submissions edge function
 *
 * Pulls scheduling-request submissions from Jotform form 252224341308043
 * (provider monthly availability) and upserts them into schedule_submissions.
 *
 * The decision columns (decision_status, accepted_hours, declined_hours,
 * decision_notes, decided_at) are NOT touched here — those are filled by
 * evaluate-schedule-submissions, which joins these submissions against
 * demand_forecast.
 *
 * Modes:
 *   POST /functions/v1/sync-jotform-submissions
 *     → incremental sync since the latest submitted_at we have
 *   POST /functions/v1/sync-jotform-submissions?discover=1
 *     → returns form question structure without writing anything
 *   POST /functions/v1/sync-jotform-submissions?since=2026-01-01
 *     → backfill from a specific date
 *
 * Required secret: JOTFORM_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { canonicalName, fuzzyScore, FUZZY_MATCH_THRESHOLD } from '../_shared/nameNormalization.ts';

const FORM_ID = '252224341308043';
const JOTFORM_BASE = 'https://api.jotform.com';
const PAGE_SIZE = 1000;

const PROVIDER_NAME_ALIASES = new Map<string, string>([
  ['matthew vazquez', 'matthew vasquez'],
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type JotformAnswer = {
  name?: string;
  text?: string;
  type?: string;
  answer?: unknown;
  prettyFormat?: string;
};

type JotformSubmission = {
  id: string;
  form_id: string;
  created_at: string;
  status: string;
  answers: Record<string, JotformAnswer>;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = Deno.env.get('JOTFORM_API_KEY');
  if (!apiKey) return json({ error: 'JOTFORM_API_KEY secret not set' }, 500);

  const url = new URL(req.url);
  const discover = url.searchParams.get('discover') === '1';
  const sinceParam = url.searchParams.get('since');

  // ── Discover mode ──────────────────────────────────────────────────────
  if (discover) {
    const qRes = await fetch(`${JOTFORM_BASE}/form/${FORM_ID}/questions?apiKey=${apiKey}`);
    const qJson = await qRes.json();
    const questions = qJson?.content ?? {};
    const summary = Object.entries(questions).map(([qid, q]: [string, unknown]) => {
      const qq = q as Record<string, unknown>;
      return {
        qid,
        name: qq.name,
        text: qq.text,
        type: qq.type,
        options: qq.options,
      };
    });
    return json({ ok: true, mode: 'discover', form_id: FORM_ID, questions: summary });
  }

  const counters = {
    submissions_fetched: 0,
    submissions_upserted: 0,
    matched_email: 0,
    matched_name_exact: 0,
    matched_name_fuzzy: 0,
    unmatched: 0,
    parse_errors: 0,
    skipped_no_target_month: 0,
  };
  const unmatchedSample: { jotform_submission_id: string; name: string | null; email: string | null }[] = [];

  try {
    // ── Determine sync window ──────────────────────────────────────────
    let since: string;
    if (sinceParam) {
      since = sinceParam;
    } else {
      const { data: latest } = await supabase
        .from('schedule_submissions')
        .select('submitted_at')
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      since = latest?.submitted_at
        ? new Date(latest.submitted_at).toISOString().slice(0, 10)
        : '2025-01-01';
    }

    // ── Load active providers for matching ──────────────────────────────
    const { data: providers } = await supabase
      .from('providers')
      .select('id, name, email')
      .eq('active', true);

    const providersByEmail = new Map<string, string>();
    const providersByCanonical = new Map<string, string>();
    const providersForFuzzy: { id: string; canonical: string }[] = [];
    for (const p of providers ?? []) {
      if (p.email) providersByEmail.set(p.email.toLowerCase(), p.id);
      const c = canonicalName(p.name);
      if (c) {
        providersByCanonical.set(c, p.id);
        providersForFuzzy.push({ id: p.id, canonical: c });
      }
    }

    // ── Page through Jotform submissions ───────────────────────────────
    let offset = 0;
    while (true) {
      const filter = encodeURIComponent(JSON.stringify({ 'created_at:gt': since }));
      const u = `${JOTFORM_BASE}/form/${FORM_ID}/submissions?apiKey=${apiKey}&limit=${PAGE_SIZE}&offset=${offset}&orderby=created_at&direction=ASC&filter=${filter}`;
      const res = await fetch(u);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Jotform API ${res.status}: ${body.slice(0, 300)}`);
      }
      const body = await res.json();
      const subs: JotformSubmission[] = body?.content ?? [];
      if (subs.length === 0) break;
      counters.submissions_fetched += subs.length;

      for (const sub of subs) {
        try {
          const submittedIso = jotformDateToIso(sub.created_at);
          const submittedDate = new Date(submittedIso);
          const parsed = parseSubmission(sub, submittedDate);

          if (!parsed.targetMonth) {
            counters.skipped_no_target_month++;
            console.warn('Skipping (no target_month)', sub.id);
            continue;
          }

          // Match provider
          let providerId: string | null = null;
          let confidence: 'email' | 'name_exact' | 'name_fuzzy' | 'unmatched' = 'unmatched';

          if (parsed.email && providersByEmail.has(parsed.email.toLowerCase())) {
            providerId = providersByEmail.get(parsed.email.toLowerCase())!;
            confidence = 'email';
            counters.matched_email++;
          } else if (parsed.name) {
            const canon = canonicalName(parsed.name);
            if (providersByCanonical.has(canon)) {
              providerId = providersByCanonical.get(canon)!;
              confidence = 'name_exact';
              counters.matched_name_exact++;
            } else if (
              PROVIDER_NAME_ALIASES.has(canon) &&
              providersByCanonical.has(PROVIDER_NAME_ALIASES.get(canon)!)
            ) {
              const aliasCanon = PROVIDER_NAME_ALIASES.get(canon)!;
              providerId = providersByCanonical.get(aliasCanon)!;
              confidence = 'name_exact';
              counters.matched_name_exact++;
            } else {
              let best = 0;
              let bestId: string | null = null;
              for (const p of providersForFuzzy) {
                const score = fuzzyScore(canon, p.canonical);
                if (score > best) { best = score; bestId = p.id; }
              }
              if (best >= FUZZY_MATCH_THRESHOLD && bestId) {
                providerId = bestId;
                confidence = 'name_fuzzy';
                counters.matched_name_fuzzy++;
              }
            }
          }

          if (!providerId) {
            counters.unmatched++;
            if (unmatchedSample.length < 20) {
              unmatchedSample.push({
                jotform_submission_id: sub.id,
                name: parsed.name,
                email: parsed.email,
              });
            }
          }

          // The schedule_submissions schema has no first-class columns for
          // requested_states / requested_hours / email / match_confidence, so
          // we stuff them into parsed_shifts alongside the per-widget data.
          const parsedShiftsPayload = {
            requested_states: parsed.states,
            requested_hours_total: parsed.totalHours,
            shift_types: parsed.shiftTypes,
            recurring_virtual: parsed.recurringVirtual,
            one_off_virtual: parsed.oneOffVirtual,
            in_home_clinic: parsed.inHomeClinic,
            unavailable_dates: parsed.unavailableDates,
            time_off_category: parsed.timeOffCategory,
            last_minute_ok: parsed.lastMinuteOk,
            travel_miles: parsed.travelMiles,
            comments: parsed.comments,
            submission_intent: parsed.submissionIntent,
            feedback: parsed.feedback,
            nps: parsed.nps,
            attestations: parsed.attestations,
            email: parsed.email,
            match_confidence: confidence,
            target_month_source: parsed.targetMonthSource,
            target_month_dropdown: parsed.dropdownMonth,
          };

          const { error: upsertErr } = await supabase
            .from('schedule_submissions')
            .upsert({
              jotform_submission_id: sub.id,
              provider_id: providerId,
              provider_name: parsed.name ?? '(unknown)',
              target_month: parsed.targetMonth,
              submitted_at: submittedIso,
              raw_answers: sub.answers,
              parsed_shifts: parsedShiftsPayload,
            }, { onConflict: 'jotform_submission_id' });

          if (upsertErr) {
            counters.parse_errors++;
            console.error('Upsert error', sub.id, upsertErr.message);
          } else {
            counters.submissions_upserted++;
          }
        } catch (e) {
          counters.parse_errors++;
          console.error('Parse error', sub.id, e instanceof Error ? e.message : String(e));
        }
      }

      if (subs.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return json({ ok: true, since, ...counters, unmatched_sample: unmatchedSample });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message, ...counters }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Jotform usually returns account-local "YYYY-MM-DD HH:MM:SS" timestamps with
// no offset. Interpret those in JOTFORM_TIME_ZONE (default ET) so late-night
// submissions do not drift into the wrong cycle when converted to UTC.
function jotformDateToIso(s: string): string {
  if (!s) return new Date().toISOString();
  const trimmed = s.trim();
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const explicit = new Date(trimmed.replace(' ', 'T'));
    if (!Number.isNaN(explicit.getTime())) return explicit.toISOString();
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  const [, year, month, day, hour, minute, second = '0'] = match;
  const timeZone = Deno.env.get('JOTFORM_TIME_ZONE') ?? 'America/New_York';
  try {
    return zonedLocalToUtcDate(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      timeZone,
    ).toISOString();
  } catch {
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  }
}

function zonedLocalToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMillis = localAsUtc;
  for (let i = 0; i < 3; i++) {
    const offset = timeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    const next = localAsUtc - offset * 60_000;
    if (Math.abs(next - utcMillis) < 1000) {
      utcMillis = next;
      break;
    }
    utcMillis = next;
  }
  return new Date(utcMillis);
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const lookup = new Map(parts.map(part => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(lookup.get('year')),
    Number(lookup.get('month')) - 1,
    Number(lookup.get('day')),
    Number(lookup.get('hour')),
    Number(lookup.get('minute')),
    Number(lookup.get('second')),
  );
  return (asUtc - date.getTime()) / 60_000;
}

type ParsedSubmission = {
  name: string | null;
  email: string | null;
  targetMonth: string | null; // YYYY-MM-01
  totalHours: number | null;
  states: string[];
  shiftTypes: string[];
  recurringVirtual: unknown;
  oneOffVirtual: unknown;
  inHomeClinic: unknown;
  unavailableDates: unknown;
  timeOffCategory: string | null;
  lastMinuteOk: boolean | null;
  travelMiles: number | null;
  comments: string | null;
  submissionIntent: string | null;
  feedback: string | null;
  nps: number | null;
  attestations: string[];
  targetMonthSource: 'form_dates' | 'form_dropdown' | null;
  dropdownMonth: string | null;
};

/**
 * Field mapper for Jotform 252224341308043 (Vitable Monthly Availability).
 * Routes by exact field `name` discovered via ?discover=1.
 */
function parseSubmission(sub: JotformSubmission, submittedAt: Date): ParsedSubmission {
  const out: ParsedSubmission = {
    name: null,
    email: null,
    targetMonth: null,
    totalHours: null,
    states: [],
    shiftTypes: [],
    recurringVirtual: null,
    oneOffVirtual: null,
    inHomeClinic: null,
    unavailableDates: null,
    timeOffCategory: null,
    lastMinuteOk: null,
    travelMiles: null,
    comments: null,
    submissionIntent: null,
    feedback: null,
    nps: null,
    attestations: [],
    targetMonthSource: null,
    dropdownMonth: null,
  };

  for (const ans of Object.values(sub.answers || {})) {
    const name = (ans.name ?? '').trim();
    const raw = ans.answer;
    if (raw === undefined || raw === null || raw === '') continue;

    const intent = parseSubmissionIntent(name, ans.text, raw);
    if (intent && !out.submissionIntent) out.submissionIntent = intent;

    switch (name) {
      case 'fullName':
        out.name = composeNameAnswer(raw);
        break;
      case 'email':
        out.email = typeof raw === 'string' ? raw : String(raw);
        break;
      case 'forWhich':
        out.targetMonth = monthNameToISO(raw, submittedAt);
        break;
      case 'whatType':
        out.shiftTypes = toArray(raw).map(v => String(v).trim()).filter(Boolean);
        break;
      case 'typeA':
        out.recurringVirtual = raw;
        break;
      case 'whatDates':
        out.oneOffVirtual = raw;
        break;
      case 'whatDates45':
        out.inHomeClinic = raw;
        break;
      case 'whenWill':
        out.unavailableDates = raw;
        break;
      case 'areThere55':
        out.timeOffCategory = Array.isArray(raw) ? raw.join(', ') : String(raw);
        break;
      case 'areYou35':
        out.lastMinuteOk = String(raw).trim().toLowerCase().startsWith('y');
        break;
      case 'howMany':
        out.travelMiles = parseNumber(raw);
        break;
      case 'pleaseShare':
        out.comments = String(raw);
        break;
      case 'pleaseShare39':
        out.feedback = String(raw);
        break;
      case 'howLikely44':
        out.nps = parseNumber(raw);
        break;
      case 'pleaseAttest':
        out.attestations = toArray(raw).map(v => String(v).trim()).filter(Boolean);
        break;
      default:
        break;
    }
  }

  out.dropdownMonth = out.targetMonth;
  if (out.targetMonth) out.targetMonthSource = 'form_dropdown';

  // The month a submission belongs to is decided by the ACTUAL dates written
  // on the form, not by the "which month is this for" dropdown and not by when
  // the form was submitted. Providers regularly pick the wrong dropdown value
  // (or leave it blank) while entering correct dates, and those submissions
  // must still land in the month they actually scheduled.
  const datedMonth = dominantMonthFromDates(out.oneOffVirtual, out.inHomeClinic);
  if (datedMonth && datedMonth !== out.targetMonth) {
    out.targetMonth = datedMonth;
    out.targetMonthSource = 'form_dates';
  } else if (datedMonth) {
    out.targetMonthSource = 'form_dates';
  }

  // Total hours: parse the widget JSON. Recurring entries get expanded by
  // counting that weekday's occurrences in the target month.
  out.totalHours = computeTotalHours(
    out.recurringVirtual,
    out.oneOffVirtual,
    out.inHomeClinic,
    out.targetMonth,
  );

  return out;
}

function composeNameAnswer(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const parts = [r.first, r.middle, r.last].map(v => (v ? String(v).trim() : '')).filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  return String(raw);
}

function parseSubmissionIntent(
  fieldName: string,
  fieldText: string | undefined,
  rawAnswer: unknown,
): string | null {
  const field = `${fieldName} ${fieldText ?? ''}`.toLowerCase();
  const answer = toArray(rawAnswer).join(' ').toLowerCase();
  const haystack = `${field} ${answer}`
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const looksLikeIntentQuestion =
    /resubmission|submission type|availability type|what.*(submit|change)|modify|modification|additional availability/.test(field);
  if (!looksLikeIntentQuestion && !/full resubmission|additional availability|modification/.test(answer)) {
    return null;
  }

  if (/additional|add only|new availability|extra availability|few specific dates/.test(haystack)) {
    return 'additional_availability';
  }
  if (/modify|modification|change existing|replace some|correction|update existing/.test(haystack)) {
    return 'modification';
  }
  if (/full|complete|entire|all availability|replace all|resubmission/.test(haystack)) {
    return 'full_resubmission';
  }
  return null;
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Resolves a month name (e.g. "October") to YYYY-MM-01.
 * Year inference: pick the soonest occurrence of that month >= the submission
 * month. So "October" submitted in May 2026 → "2026-10-01"; submitted in
 * November 2026 → "2027-10-01".
 */
function monthNameToISO(raw: unknown, submittedAt: Date): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // Already ISO-ish?
  const ym = s.match(/^(\d{4})-(\d{1,2})/);
  if (ym) {
    const y = ym[1];
    const m = ym[2].padStart(2, '0');
    return `${y}-${m}-01`;
  }

  // Bare month name (or with year somewhere)
  let monthIdx = -1;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (s.startsWith(MONTH_NAMES[i].slice(0, 3))) { monthIdx = i; break; }
    if (s.includes(MONTH_NAMES[i])) { monthIdx = i; break; }
  }
  if (monthIdx === -1) return null;

  // Year embedded in the answer?
  const yMatch = s.match(/(20\d{2})/);
  let year: number;
  if (yMatch) {
    year = Number(yMatch[1]);
  } else {
    const subYear = submittedAt.getUTCFullYear();
    const subMonth = submittedAt.getUTCMonth(); // 0-indexed
    year = monthIdx >= subMonth ? subYear : subYear + 1;
  }
  const m = String(monthIdx + 1).padStart(2, '0');
  return `${year}-${m}-01`;
}

/**
 * Hours calculator for the Vitable Monthly Availability form.
 *
 * Widget answer shapes (each is a JSON string in jotform's response):
 *   recurring (typeA):    [{"Day of Week":"Monday","Start Time (ET)":"09:00 AM","End Time (ET)":"12:00 PM"}, ...]
 *   one-off  (whatDates): [{"Date":"06-04-2026","Start Time (ET)":"09:00 AM","End Time (ET)":"05:00 PM"}, ...]
 *   in-home  (whatDates45): same shape as one-off
 *
 * Recurring entries are weekly — we multiply by the number of times that
 * weekday occurs in the target month. One-off entries are summed directly.
 */
function computeTotalHours(
  recurring: unknown,
  oneOff: unknown,
  inHome: unknown,
  targetMonth: string | null,
): number | null {
  let total = 0;
  let any = false;

  // Recurring weekly → expand across the target month
  const recurringEntries = parseWidgetArray(recurring);
  if (recurringEntries.length && targetMonth) {
    for (const e of recurringEntries) {
      const dayName = e['Day of Week'];
      const hours = timeRangeHours(e['Start Time (ET)'], e['End Time (ET)']);
      if (hours == null || !dayName) continue;
      const occurrences = weekdayOccurrencesInMonth(dayName, targetMonth);
      if (occurrences > 0) {
        total += hours * occurrences;
        any = true;
      }
    }
  }

  // One-off & in-home → sum directly
  for (const widgetData of [oneOff, inHome]) {
    for (const e of parseWidgetArray(widgetData)) {
      const hours = timeRangeHours(e['Start Time (ET)'], e['End Time (ET)']);
      if (hours == null) continue;
      total += hours;
      any = true;
    }
  }

  return any ? Math.round(total * 100) / 100 : null;
}

/**
 * Derives the calendar month a submission targets from the explicit dates it
 * contains (one-off virtual + in-home/clinic widgets). Returns the month that
 * holds a strict majority of the dated entries, or null when the form has no
 * usable dates (e.g. recurring-only submissions).
 */
function dominantMonthFromDates(oneOff: unknown, inHome: unknown): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const widgetData of [oneOff, inHome]) {
    for (const e of parseWidgetArray(widgetData)) {
      const month = monthFromDateAnswer(e['Date'] ?? e['date']);
      if (!month) continue;
      counts.set(month, (counts.get(month) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return null;
  let bestMonth: string | null = null;
  let bestCount = 0;
  for (const [month, count] of counts) {
    if (count > bestCount) { bestMonth = month; bestCount = count; }
  }
  return bestCount * 2 > total ? bestMonth : null;
}

/** Parses "06-04-2026", "2026-06-04", "6/4/2026" → "2026-06-01". */
function monthFromDateAnswer(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-01`;
  const us = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (us) {
    const month = Number(us[1]);
    if (month < 1 || month > 12) return null;
    return `${us[3]}-${String(month).padStart(2, '0')}-01`;
  }
  return null;
}

function parseWidgetArray(raw: unknown): Record<string, string>[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is Record<string, string> => e != null && typeof e === 'object',
  );
}

function timeRangeHours(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const s = parseTimeOfDay(start);
  const e = parseTimeOfDay(end);
  if (s == null || e == null) return null;
  let diff = e - s;
  if (diff < 0) diff += 24; // crosses midnight
  return diff > 0 && diff <= 24 ? diff : null;
}

/** Parses "09:00 AM", "5:00 PM", "13:00" → decimal hour (0–24). */
function parseTimeOfDay(t: string): number | null {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = (m[3] ?? '').toUpperCase();
  if (ampm === 'AM') {
    if (h === 12) h = 0;
  } else if (ampm === 'PM') {
    if (h !== 12) h += 12;
  }
  if (h < 0 || h > 24 || min < 0 || min >= 60) return null;
  return h + min / 60;
}

const DAY_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** Counts how many times a given weekday occurs in a calendar month. */
function weekdayOccurrencesInMonth(dayName: string, monthISO: string): number {
  const dayIdx = DAY_TO_INDEX[String(dayName).trim().toLowerCase()];
  if (dayIdx === undefined) return 0;
  const [y, m] = monthISO.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (dayIdx - firstWeekday + 7) % 7;
  const firstOccurrence = 1 + offset;
  if (firstOccurrence > daysInMonth) return 0;
  return Math.floor((daysInMonth - firstOccurrence) / 7) + 1;
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  if (typeof raw === 'string') return raw.split(/[,;|\n]+/).map(s => s.trim()).filter(Boolean);
  return [raw];
}

function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const m = raw.match(/-?\d+(\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}
