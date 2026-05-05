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
          const submittedDate = new Date(jotformDateToIso(sub.created_at));
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
            feedback: parsed.feedback,
            nps: parsed.nps,
            attestations: parsed.attestations,
            email: parsed.email,
            match_confidence: confidence,
          };

          const { error: upsertErr } = await supabase
            .from('schedule_submissions')
            .upsert({
              jotform_submission_id: sub.id,
              provider_id: providerId,
              provider_name: parsed.name ?? '(unknown)',
              target_month: parsed.targetMonth,
              submitted_at: jotformDateToIso(sub.created_at),
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

// Jotform returns "YYYY-MM-DD HH:MM:SS" UTC.
function jotformDateToIso(s: string): string {
  if (!s) return new Date().toISOString();
  return new Date(s.replace(' ', 'T') + 'Z').toISOString();
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
  feedback: string | null;
  nps: number | null;
  attestations: string[];
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
    feedback: null,
    nps: null,
    attestations: [],
  };

  for (const ans of Object.values(sub.answers || {})) {
    const name = (ans.name ?? '').trim();
    const raw = ans.answer;
    if (raw === undefined || raw === null || raw === '') continue;

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

  // Best-effort total hours: scan time ranges across the three shift widgets.
  out.totalHours = computeTotalHours([
    out.recurringVirtual,
    out.oneOffVirtual,
    out.inHomeClinic,
  ]);

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
 * Best-effort hours calculation by scanning widget answers for time ranges
 * like "9:00 AM - 1:00 PM", "09:00-13:00", "9am-1pm", etc.
 * Returns null if no ranges are found.
 */
function computeTotalHours(widgetAnswers: unknown[]): number | null {
  let total = 0;
  let any = false;

  const text = widgetAnswers
    .map(a => (a == null ? '' : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' \n ')
    .toLowerCase();

  // Match "H[:MM] [am|pm]? - H[:MM] [am|pm]?"
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const startH = Number(m[1]);
    const startMin = m[2] ? Number(m[2]) : 0;
    const startAmPm = m[3];
    const endH = Number(m[4]);
    const endMin = m[5] ? Number(m[5]) : 0;
    const endAmPm = m[6];
    const start = to24(startH, startMin, startAmPm, endAmPm);
    const end = to24(endH, endMin, endAmPm, startAmPm);
    let diff = end - start;
    if (diff < 0) diff += 24; // crosses midnight
    if (diff > 0 && diff <= 24) {
      total += diff;
      any = true;
    }
  }

  return any ? Math.round(total * 100) / 100 : null;
}

/**
 * Convert (hour, min, ownAmPm, otherAmPm) to a 24h decimal hour.
 * If ownAmPm is missing, infer from other side or default to AM for hours
 * 1-7 (likely PM) — actually just default to AM and let the diff math handle
 * the wrap.
 */
function to24(h: number, min: number, own: string | undefined, other: string | undefined): number {
  let ampm = own ?? other ?? '';
  ampm = ampm.toLowerCase();
  let hh = h % 12;
  if (ampm === 'pm') hh += 12;
  if (ampm === 'am' && h === 12) hh = 0;
  if (ampm === '' && h === 12) hh = 12; // treat bare "12" as noon
  return hh + min / 60;
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
