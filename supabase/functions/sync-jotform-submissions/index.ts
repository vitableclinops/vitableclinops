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
          const parsed = parseSubmission(sub);

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
          // we stuff them into parsed_shifts alongside the per-day shifts.
          const parsedShiftsPayload = {
            requested_states: parsed.states,
            requested_hours_total: parsed.totalHours,
            shifts: parsed.shifts,
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
  shifts: Array<Record<string, unknown>>;
};

/**
 * Heuristic field mapper. Looks at each answer's name/text to figure out
 * which field it represents. Run with ?discover=1 once to see the actual
 * names and tighten this if needed.
 */
function parseSubmission(sub: JotformSubmission): ParsedSubmission {
  const out: ParsedSubmission = {
    name: null,
    email: null,
    targetMonth: null,
    totalHours: null,
    states: [],
    shifts: [],
  };

  for (const ans of Object.values(sub.answers || {})) {
    const key = `${ans.name ?? ''} ${ans.text ?? ''}`.toLowerCase();
    const raw = ans.answer;
    if (raw === undefined || raw === null || raw === '') continue;

    if (out.name === null && /(provider.*name|full.*name|^name$|your name)/.test(key)) {
      out.name = composeNameAnswer(raw);
      continue;
    }

    if (out.email === null && /email/.test(key)) {
      out.email = typeof raw === 'string' ? raw : String(raw);
      continue;
    }

    if (out.targetMonth === null && /(month|target.*month|availability.*month|schedule.*month|for.*month)/.test(key)) {
      out.targetMonth = composeMonthAnswer(raw);
      continue;
    }

    if (/state/.test(key) && !/zip|address|status/.test(key)) {
      const vals = toArray(raw).map(v => String(v).trim().toUpperCase()).filter(Boolean);
      out.states.push(...vals);
      continue;
    }

    if (out.totalHours === null && /(total.*hour|hours.*requested|hours.*available|hours.*total)/.test(key)) {
      const n = parseNumber(raw);
      if (n !== null) out.totalHours = n;
      continue;
    }

    if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|shift|availability|schedule|day)/.test(key)) {
      out.shifts.push({
        field: ans.name ?? ans.text ?? null,
        label: ans.text ?? null,
        type: ans.type ?? null,
        answer: raw,
        pretty: ans.prettyFormat ?? null,
      });
    }
  }

  // If totalHours wasn't an explicit field, sum any numeric shift answers
  if (out.totalHours === null && out.shifts.length > 0) {
    let sum = 0;
    let hadAny = false;
    for (const s of out.shifts) {
      const n = parseNumber(s.answer);
      if (n !== null) { sum += n; hadAny = true; }
    }
    if (hadAny) out.totalHours = sum;
  }

  // Fallback: if we never found a target month but we did find dated shifts,
  // use the earliest shift date's month.
  if (out.targetMonth === null) {
    for (const s of out.shifts) {
      const d = composeMonthAnswer(s.answer);
      if (d) { out.targetMonth = d; break; }
    }
  }

  out.states = Array.from(new Set(out.states));
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

/** Returns first-of-month ISO date (YYYY-MM-01) or null. */
function composeMonthAnswer(raw: unknown): string | null {
  if (raw == null) return null;
  let d: Date | null = null;

  if (typeof raw === 'string') {
    // Handle "2026-06", "June 2026", "06/01/2026", etc.
    const ym = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (ym) {
      const y = ym[1];
      const m = ym[2].padStart(2, '0');
      return `${y}-${m}-01`;
    }
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) d = parsed;
  } else if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.year && r.month) {
      const y = String(r.year).padStart(4, '0');
      const m = String(r.month).padStart(2, '0');
      return `${y}-${m}-01`;
    }
  }

  if (d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }
  return null;
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
