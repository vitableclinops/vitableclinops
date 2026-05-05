/**
 * sync-jotform-submissions edge function
 *
 * Pulls scheduling-request submissions from Jotform form 252224341308043,
 * matches them to provider profiles, and upserts into schedule_submissions.
 *
 * The recommendation columns (recommendation_status, recommended_hours, etc.)
 * are NOT touched here — those are filled by evaluate-schedule-submissions
 * which joins these submissions against demand_forecast.
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
  if (!apiKey) {
    return json({ error: 'JOTFORM_API_KEY secret not set' }, 500);
  }

  const url = new URL(req.url);
  const discover = url.searchParams.get('discover') === '1';
  const sinceParam = url.searchParams.get('since'); // YYYY-MM-DD

  // ── Discover mode: just dump the form question structure ─────────────────
  if (discover) {
    const qRes = await fetch(`${JOTFORM_BASE}/form/${FORM_ID}/questions?apiKey=${apiKey}`);
    const qJson = await qRes.json();
    const questions = qJson?.content ?? {};
    const summary = Object.entries(questions).map(([qid, q]: [string, any]) => ({
      qid,
      name: q.name,
      text: q.text,
      type: q.type,
      options: q.options,
    }));
    return json({ ok: true, mode: 'discover', form_id: FORM_ID, questions: summary });
  }

  // ── Open generic sync run ────────────────────────────────────────────────
  const startedAt = Date.now();
  const { data: runRow } = await supabase
    .from('sync_runs')
    .insert({ function_name: 'sync-jotform-submissions', status: 'running' })
    .select('id')
    .single();
  const runId: string | null = runRow?.id ?? null;

  const finalize = async (
    status: 'success' | 'partial' | 'error',
    extras: { rows_processed?: number; rows_failed?: number; error_message?: string; details?: unknown } = {},
  ) => {
    if (!runId) return;
    await supabase.from('sync_runs').update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      rows_processed: extras.rows_processed ?? 0,
      rows_failed: extras.rows_failed ?? 0,
      error_message: extras.error_message ?? null,
      details: extras.details ?? {},
    }).eq('id', runId);
  };

  const counters = {
    submissions_fetched: 0,
    submissions_upserted: 0,
    matched_email: 0,
    matched_name_exact: 0,
    matched_name_fuzzy: 0,
    unmatched: 0,
    parse_errors: 0,
  };
  const unmatchedSample: { jotform_submission_id: string; name: string | null; email: string | null }[] = [];

  try {
    // ── Determine sync window ────────────────────────────────────────────
    let since: string;
    if (sinceParam) {
      since = sinceParam;
    } else {
      const { data: latest } = await supabase
        .from('schedule_submissions')
        .select('submitted_at')
        .eq('jotform_form_id', FORM_ID)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      since = latest?.submitted_at
        ? new Date(latest.submitted_at).toISOString().slice(0, 10)
        : '2025-01-01';
    }

    // ── Load profiles for matching ───────────────────────────────────────
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, first_name, last_name')
      .eq('employment_status', 'active');

    const profilesByEmail = new Map<string, string>();
    const profilesByCanonical = new Map<string, string>();
    const profilesForFuzzy: { id: string; canonical: string }[] = [];
    for (const p of profiles ?? []) {
      if (p.email) profilesByEmail.set(p.email.toLowerCase(), p.id);
      const full = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
      const c = canonicalName(full);
      if (c) {
        profilesByCanonical.set(c, p.id);
        profilesForFuzzy.push({ id: p.id, canonical: c });
      }
    }

    // ── Page through Jotform submissions ─────────────────────────────────
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

          // Match provider
          let profileId: string | null = null;
          let confidence: 'email' | 'name_exact' | 'name_fuzzy' | 'unmatched' = 'unmatched';

          if (parsed.email && profilesByEmail.has(parsed.email.toLowerCase())) {
            profileId = profilesByEmail.get(parsed.email.toLowerCase())!;
            confidence = 'email';
            counters.matched_email++;
          } else if (parsed.name) {
            const canon = canonicalName(parsed.name);
            if (profilesByCanonical.has(canon)) {
              profileId = profilesByCanonical.get(canon)!;
              confidence = 'name_exact';
              counters.matched_name_exact++;
            } else {
              let best = 0;
              let bestId: string | null = null;
              for (const p of profilesForFuzzy) {
                const score = fuzzyScore(canon, p.canonical);
                if (score > best) { best = score; bestId = p.id; }
              }
              if (best >= FUZZY_MATCH_THRESHOLD && bestId) {
                profileId = bestId;
                confidence = 'name_fuzzy';
                counters.matched_name_fuzzy++;
              }
            }
          }

          if (!profileId) {
            counters.unmatched++;
            if (unmatchedSample.length < 20) {
              unmatchedSample.push({
                jotform_submission_id: sub.id,
                name: parsed.name,
                email: parsed.email,
              });
            }
          }

          const { error: upsertErr } = await supabase
            .from('schedule_submissions')
            .upsert({
              jotform_submission_id: sub.id,
              jotform_form_id: sub.form_id,
              submitted_at: jotformDateToIso(sub.created_at),
              provider_profile_id: profileId,
              provider_name_raw: parsed.name,
              provider_email_raw: parsed.email,
              match_confidence: confidence,
              week_start: parsed.weekStart,
              requested_hours_total: parsed.totalHours,
              requested_states: parsed.states,
              requested_shifts: parsed.shifts,
              raw_payload: sub,
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

    const unmatchedRatio = counters.submissions_upserted > 0
      ? counters.unmatched / counters.submissions_upserted
      : 0;
    const partial = unmatchedRatio > 0.10 || counters.parse_errors > 0;

    await finalize(partial ? 'partial' : 'success', {
      rows_processed: counters.submissions_upserted,
      rows_failed: counters.parse_errors,
      details: { ...counters, unmatched_sample: unmatchedSample, since },
    });

    return json({ ok: true, runId, since, ...counters, unmatched_sample: unmatchedSample });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalize('error', { error_message: message, details: counters });
    return json({ error: message, runId, ...counters }, 500);
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
  weekStart: string | null;
  totalHours: number | null;
  states: string[];
  shifts: unknown;
};

/**
 * Heuristic field mapper. Looks at each answer's `name` and `text` to figure out
 * which schema field it corresponds to. Run with ?discover=1 once to see the
 * actual field names, then tighten this mapping if needed.
 */
function parseSubmission(sub: JotformSubmission): ParsedSubmission {
  const out: ParsedSubmission = {
    name: null,
    email: null,
    weekStart: null,
    totalHours: null,
    states: [],
    shifts: null,
  };

  const shiftEntries: Array<Record<string, unknown>> = [];

  for (const ans of Object.values(sub.answers || {})) {
    const key = `${ans.name ?? ''} ${ans.text ?? ''}`.toLowerCase();
    const raw = ans.answer;

    if (raw === undefined || raw === null || raw === '') continue;

    // Name (composite or text)
    if (out.name === null && /(provider.*name|full.*name|^name$|your name)/.test(key)) {
      out.name = composeNameAnswer(raw);
      continue;
    }

    // Email
    if (out.email === null && /email/.test(key)) {
      out.email = typeof raw === 'string' ? raw : String(raw);
      continue;
    }

    // Week start (date pickers, "week of", "starting", etc.)
    if (out.weekStart === null && /(week.*start|week.*of|starting|start.*date|monday)/.test(key)) {
      out.weekStart = composeDateAnswer(raw);
      continue;
    }

    // States
    if (/state/.test(key) && !/zip|address|status/.test(key)) {
      const vals = toArray(raw).map(v => String(v).trim().toUpperCase()).filter(Boolean);
      out.states.push(...vals);
      continue;
    }

    // Total hours (numeric)
    if (out.totalHours === null && /(total.*hour|hours.*requested|hours.*available|hours.*total)/.test(key)) {
      const n = parseNumber(raw);
      if (n !== null) out.totalHours = n;
      continue;
    }

    // Per-day shifts: anything mentioning a weekday
    if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|shift|availability|schedule)/.test(key)) {
      shiftEntries.push({
        field: ans.name ?? ans.text ?? null,
        label: ans.text ?? null,
        type: ans.type ?? null,
        answer: raw,
        pretty: ans.prettyFormat ?? null,
      });
    }
  }

  if (shiftEntries.length > 0) {
    out.shifts = shiftEntries;

    // If totalHours wasn't an explicit field, try to sum any numeric shift answers
    if (out.totalHours === null) {
      let sum = 0;
      let hadAny = false;
      for (const s of shiftEntries) {
        const n = parseNumber(s.answer);
        if (n !== null) { sum += n; hadAny = true; }
      }
      if (hadAny) out.totalHours = sum;
    }
  }

  // Dedupe states
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

function composeDateAnswer(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.year && r.month && r.day) {
      const y = String(r.year).padStart(4, '0');
      const m = String(r.month).padStart(2, '0');
      const d = String(r.day).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  return null;
}

function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  if (typeof raw === 'string') {
    return raw.split(/[,;|\n]+/).map(s => s.trim()).filter(Boolean);
  }
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
