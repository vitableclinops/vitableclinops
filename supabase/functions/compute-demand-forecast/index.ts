/**
 * compute-demand-forecast edge function
 *
 * Demand methodology (canonical, set in May 2026 by ClinOps):
 *
 *   Metabase cards 2974/2973/2971/2972 return one row per state with
 *   columns "State" and "Target Hrs". The value is **weekly hours of
 *   provider availability needed**, not visits. (Vitable appointments
 *   are 30 min and same/next-day SLA requires roughly 1:1 buffer of
 *   unbooked availability, so 1 visit ≈ 1 hour of availability and the
 *   card values are denominated in hours.)
 *
 *   For telehealth (card 2974) we apply a flat per-cohort buffer:
 *
 *     Cohort   States                            Buffer
 *     Core     PA, NJ                            17.5%
 *     Growth   TX, OH, FL                        20.0%
 *     MD-Only  GA, IN, MO, TN, SC, MS, AL        20.0%
 *     DMV      DC, MD, VA                        15.0%
 *     DE       DE                                15.0%
 *     021      everything else                   15.0%
 *
 *   For the other service lines:
 *
 *     MH Coaching (2973) - 15% buffer on the network-pool sum
 *     Therapy     (2971) - 15% buffer on the active-state sum
 *     In-Home     (2972 + fixed)  - no buffer (mostly fixed schedule)
 *
 *   In-Home includes hard-coded recurring shifts that aren't in the
 *   Metabase card:
 *
 *     DE - Sara Kamara recurring Thu 9-12 = 3.0 hrs/wk
 *     NJ - one 2-hr shift/month         ≈ 0.46 hrs/wk
 *     IL - one 2-hr shift/month         ≈ 0.46 hrs/wk
 *     OH - one 2-hr shift/month         ≈ 0.46 hrs/wk
 *     TX - one 2-hr shift/month         ≈ 0.46 hrs/wk
 *
 *   Per-state distribution of telehealth across days uses the
 *   established 1/6 weekday, 1/12 weekend rule (so the daily values
 *   sum to roughly 4.25 weeks/month for June, ~4.33 over a year).
 *
 *   For Supabase writes:
 *     monthly_hours_target  = adjusted_weekly_hours × 4.33
 *     monthly_visits_target = monthly_hours_target  (column name is
 *                             legacy/misleading: stores hours)
 *     daily_target_slots    = max(5, round(monthly_hours_target / 20 * 1.5))
 *
 * Pipeline:
 *   1. Auth to Metabase.
 *   2. Pull cards 2974 (telehealth), 2973 (MH coach), 2971 (therapy),
 *      2972 (in-home).
 *   3. Apply cohort buffer to telehealth per-state.
 *   4. Apply flat 15% buffer to coaching and therapy network sums.
 *   5. Add fixed recurring shifts to In-Home.
 *   6. Distribute telehealth weekly hours across days of target month
 *      (weekday = 1/6, weekend = 1/12).
 *   7. Write demand_forecast per-day per-state (telehealth only) and
 *      state_demand_targets per (state, month) (telehealth only).
 *   8. Return service-line totals + cohort rollup in response payload
 *      so the leadership-facing forecast can be built directly.
 *
 * Note: state_demand_targets and demand_forecast hold telehealth only,
 * because the other service lines are staffed by separate provider pools
 * and don't compete for the same Jotform-submitted availability.
 *
 * Required secrets: METABASE_USERNAME, METABASE_PASSWORD
 *
 * Optional env: METABASE_BASELINE_CARD_ID (default 2974)
 *
 * Query params:
 *   ?target_month=YYYY-MM-01    default = first day of next calendar month
 *   ?dry_run=1                  compute without writing
 *   ?inspect=1                  dump CSV column headers + first rows
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const METABASE_URL = 'https://metabase.vitablehealth.com';

const TELEHEALTH_CARD = Number(Deno.env.get('METABASE_BASELINE_CARD_ID') ?? '2974');
const COACHING_CARD = Number(Deno.env.get('METABASE_COACHING_CARD_ID') ?? '2973');
const THERAPY_CARD = Number(Deno.env.get('METABASE_THERAPY_CARD_ID') ?? '2971');
const INHOME_CARD = Number(Deno.env.get('METABASE_INHOME_CARD_ID') ?? '2972');

// Telehealth cohort assignments and buffers
const COHORT_STATES: Record<string, Set<string>> = {
  Core:      new Set(['PA', 'NJ']),
  Growth:    new Set(['TX', 'OH', 'FL']),
  'MD-Only': new Set(['GA', 'IN', 'MO', 'TN', 'SC', 'MS', 'AL']),
  DMV:       new Set(['DC', 'MD', 'VA']),
  DE:        new Set(['DE']),
};

const COHORT_BUFFER: Record<string, number> = {
  Core:      0.175,
  Growth:    0.20,
  'MD-Only': 0.20,
  DMV:       0.15,
  DE:        0.15,
  '021':     0.15,
};

const COACHING_BUFFER = 0.15;
const THERAPY_BUFFER = 0.15;
const IN_HOME_BUFFER = 0.0;

// In-Home recurring shifts not tracked in Metabase (weekly hours)
const IN_HOME_FIXED: Record<string, number> = {
  DE: 3.0,        // Sara Kamara recurring Thu 9-12
  NJ: 2 / 4.33,   // one 2-hr shift/month
  IL: 2 / 4.33,
  OH: 2 / 4.33,
  TX: 2 / 4.33,
};

const WEEKS_PER_MONTH = 4.33;

function cohortFor(state: string): string {
  for (const [name, members] of Object.entries(COHORT_STATES)) {
    if (members.has(state)) return name;
  }
  return '021';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Row = Record<string, string>;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const username = Deno.env.get('METABASE_USERNAME');
  const password = Deno.env.get('METABASE_PASSWORD');
  if (!username || !password) {
    return json({ error: 'METABASE_USERNAME and METABASE_PASSWORD secrets are required' }, 500);
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const inspect = url.searchParams.get('inspect') === '1';
  const targetMonth = url.searchParams.get('target_month') ?? defaultNextMonth();

  if (!/^\d{4}-\d{2}-01$/.test(targetMonth)) {
    return json({ error: 'target_month must be YYYY-MM-01' }, 400);
  }

  try {
    const token = await getMetabaseToken(username, password);

    // Pull all four service-line cards in parallel
    const [teleCsv, coachCsv, therapyCsv, inHomeCsv] = await Promise.all([
      downloadCardCsv(token, TELEHEALTH_CARD),
      downloadCardCsvSafe(token, COACHING_CARD),
      downloadCardCsvSafe(token, THERAPY_CARD),
      downloadCardCsvSafe(token, INHOME_CARD),
    ]);

    if (inspect) {
      return json({
        ok: true,
        mode: 'inspect',
        cards: {
          telehealth: cardSnapshot(TELEHEALTH_CARD, teleCsv),
          coaching:   cardSnapshot(COACHING_CARD, coachCsv),
          therapy:    cardSnapshot(THERAPY_CARD, therapyCsv),
          in_home:    cardSnapshot(INHOME_CARD, inHomeCsv),
        },
      });
    }

    const issues: Record<string, Record<string, number>> = {
      telehealth: {}, coaching: {}, therapy: {}, in_home: {},
    };

    // Parse each card. Card values are weekly hours of provider availability.
    const teleByState   = parseStateHours(teleCsv,    issues.telehealth);
    const coachByState  = parseStateHours(coachCsv,   issues.coaching);
    const therapyByState= parseStateHours(therapyCsv, issues.therapy);
    const inHomeByState = parseStateHours(inHomeCsv,  issues.in_home);

    if (teleByState.size === 0) {
      return json({ error: `Telehealth card ${TELEHEALTH_CARD} returned no rows` }, 422);
    }

    // ── Telehealth: apply cohort buffer per state ─────────────────────
    type TelehealthRow = {
      raw: number;
      adjusted: number;
      cohort: string;
      buffer: number;
    };
    const teleAdjusted = new Map<string, TelehealthRow>();
    for (const [state, raw] of teleByState) {
      const cohort = cohortFor(state);
      const buffer = COHORT_BUFFER[cohort];
      teleAdjusted.set(state, {
        raw,
        adjusted: raw * (1 + buffer),
        cohort,
        buffer,
      });
    }

    // ── Cohort rollup ─────────────────────────────────────────────────
    type CohortAggregate = {
      raw_weekly_hrs: number;
      adjusted_weekly_hrs: number;
      daily_target_hrs: number;
      buffer_pct: number;
      states: string[];
    };
    const cohortNames = Object.keys(COHORT_BUFFER);
    const cohortRollup: Record<string, CohortAggregate> = {};
    for (const c of cohortNames) {
      cohortRollup[c] = {
        raw_weekly_hrs: 0,
        adjusted_weekly_hrs: 0,
        daily_target_hrs: 0,
        buffer_pct: COHORT_BUFFER[c],
        states: [],
      };
    }
    for (const [state, t] of teleAdjusted) {
      cohortRollup[t.cohort].raw_weekly_hrs += t.raw;
      cohortRollup[t.cohort].adjusted_weekly_hrs += t.adjusted;
      cohortRollup[t.cohort].states.push(state);
    }
    for (const c of cohortNames) {
      cohortRollup[c].raw_weekly_hrs = round2(cohortRollup[c].raw_weekly_hrs);
      cohortRollup[c].adjusted_weekly_hrs = round2(cohortRollup[c].adjusted_weekly_hrs);
      // Daily target uses the documented divisor of 6 (weekday=1/6, weekend day=1/12)
      cohortRollup[c].daily_target_hrs = round2(cohortRollup[c].adjusted_weekly_hrs / 6);
      cohortRollup[c].states.sort();
    }

    // ── Service-line totals ───────────────────────────────────────────
    const telehealthRaw = sumValues(teleByState);
    const telehealthAdj = sumMapBy(teleAdjusted, t => t.adjusted);

    const coachingRaw = sumValues(coachByState);
    const coachingAdj = coachingRaw * (1 + COACHING_BUFFER);

    const therapyRaw = sumValues(therapyByState);
    const therapyAdj = therapyRaw * (1 + THERAPY_BUFFER);

    // In-Home: card values + fixed recurring shifts (no buffer)
    const inHomeMerged = new Map<string, number>(inHomeByState);
    for (const [state, fixed] of Object.entries(IN_HOME_FIXED)) {
      inHomeMerged.set(state, (inHomeMerged.get(state) ?? 0) + fixed);
    }
    const inHomeRaw = sumValues(inHomeMerged);
    const inHomeAdj = inHomeRaw * (1 + IN_HOME_BUFFER);

    const totalRaw = telehealthRaw + coachingRaw + therapyRaw + inHomeRaw;
    const totalAdj = telehealthAdj + coachingAdj + therapyAdj + inHomeAdj;

    const serviceLines = {
      telehealth:  { raw_weekly_hrs: round2(telehealthRaw), adjusted_weekly_hrs: round2(telehealthAdj), buffer: 'cohort' },
      mh_coaching: { raw_weekly_hrs: round2(coachingRaw),   adjusted_weekly_hrs: round2(coachingAdj),   buffer: COACHING_BUFFER },
      therapy:     { raw_weekly_hrs: round2(therapyRaw),    adjusted_weekly_hrs: round2(therapyAdj),    buffer: THERAPY_BUFFER },
      in_home:     { raw_weekly_hrs: round2(inHomeRaw),     adjusted_weekly_hrs: round2(inHomeAdj),     buffer: IN_HOME_BUFFER, by_state: Array.from(inHomeMerged.entries()).map(([s, h]) => ({ state: s, weekly_hrs: round2(h) })) },
      total:       { raw_weekly_hrs: round2(totalRaw),      adjusted_weekly_hrs: round2(totalAdj) },
    };

    // ── Distribute telehealth weekly hours across target month days ───
    const states = Array.from(teleAdjusted.keys()).sort();
    const monthDays = listMonthDays(targetMonth);
    const projections: Array<{
      date: string;
      state: string;
      projected_visits: number;  // legacy column name; stores hours of availability
      forecast_run_id: string;
      is_baseline: boolean;
      computed_at: string;
    }> = [];
    const forecastRunId = crypto.randomUUID();
    const computedAt = new Date().toISOString();

    for (const state of states) {
      const adj = teleAdjusted.get(state)!.adjusted;
      for (const date of monthDays) {
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        const weight = (dow === 0 || dow === 6) ? 1 / 12 : 1 / 6;
        projections.push({
          date,
          state,
          projected_visits: round2(adj * weight),
          forecast_run_id: forecastRunId,
          is_baseline: true,
          computed_at: computedAt,
        });
      }
    }

    // ── state_demand_targets (telehealth only) ────────────────────────
    type Target = {
      state: string;
      month: string;
      monthly_visits_target: number;
      daily_target_slots: number;
      monthly_hours_target: number;
      growth_multiplier: number;
      forecast_run_id: string;
      computed_at: string;
    };
    const targets: Target[] = [];
    for (const state of states) {
      const t = teleAdjusted.get(state)!;
      // monthly_hours_target = adjusted_weekly_hours × 4.33 (weeks/month).
      // monthly_visits_target stores the SAME value (column name is legacy:
      // both fields denote monthly hours of provider availability).
      const monthlyHours = round2(t.adjusted * WEEKS_PER_MONTH);
      const dailyTargetSlots = Math.max(5, Math.round((monthlyHours / 20) * 1.5));
      targets.push({
        state,
        month: targetMonth,
        monthly_visits_target: Math.round(monthlyHours),
        monthly_hours_target: monthlyHours,
        daily_target_slots: dailyTargetSlots,
        // We keep the growth_multiplier column populated with the cohort
        // buffer (1 + buffer_pct) so callers can see what was applied.
        growth_multiplier: 1 + t.buffer,
        forecast_run_id: forecastRunId,
        computed_at: computedAt,
      });
    }

    // ── Write to Supabase ─────────────────────────────────────────────
    let demoted = 0;
    if (!dryRun) {
      const { data: demoteData, error: demoteErr } = await supabase
        .from('demand_forecast')
        .update({ is_baseline: false })
        .eq('is_baseline', true)
        .select('forecast_run_id');
      if (demoteErr) throw new Error(`Demote failed: ${demoteErr.message}`);
      demoted = demoteData?.length ?? 0;

      const CHUNK = 500;
      for (let i = 0; i < projections.length; i += CHUNK) {
        const chunk = projections.slice(i, i + CHUNK);
        const { error } = await supabase.from('demand_forecast').insert(chunk);
        if (error) throw new Error(`demand_forecast insert failed at ${i}: ${error.message}`);
      }

      const { error: tErr } = await supabase
        .from('state_demand_targets')
        .upsert(targets, { onConflict: 'state,month' });
      if (tErr) throw new Error(`state_demand_targets upsert failed: ${tErr.message}`);
    }

    return json({
      ok: true,
      forecast_run_id: forecastRunId,
      target_month: targetMonth,
      service_lines: serviceLines,
      telehealth_cohort_rollup: cohortNames.map(c => ({ cohort: c, ...cohortRollup[c] })),
      states: states.length,
      projection_rows: projections.length,
      target_rows: targets.length,
      previous_baseline_demoted: demoted,
      dry_run: dryRun,
      issues,
      state_summary: states.map(s => {
        const t = teleAdjusted.get(s)!;
        const target = targets.find(x => x.state === s)!;
        return {
          state: s,
          cohort: t.cohort,
          buffer_pct: t.buffer,
          raw_weekly_hrs: round2(t.raw),
          adjusted_weekly_hrs: round2(t.adjusted),
          monthly_hours_target: target.monthly_hours_target,
          daily_target_slots: target.daily_target_slots,
        };
      }),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ── Card helpers ──────────────────────────────────────────────────────────
async function getMetabaseToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Metabase auth ${res.status}: ${await res.text()}`);
  const data = await res.json() as { id: string };
  return data.id;
}

async function downloadCardCsv(token: string, cardId: number): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/card/${cardId}/query/csv`, {
    method: 'POST',
    headers: { 'X-Metabase-Session': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`CSV download (card ${cardId}) ${res.status}: ${await res.text()}`);
  return res.text();
}

async function downloadCardCsvSafe(token: string, cardId: number): Promise<string> {
  try {
    return await downloadCardCsv(token, cardId);
  } catch (e) {
    console.warn(`Card ${cardId} pull failed:`, e instanceof Error ? e.message : String(e));
    return '';
  }
}

function cardSnapshot(cardId: number, csv: string) {
  const rows = parseCSV(csv);
  return {
    card_id: cardId,
    row_count: rows.length,
    columns: rows[0] ? Object.keys(rows[0]) : [],
    first_3: rows.slice(0, 3),
  };
}

/**
 * Parse a Metabase card CSV into a Map<state-abbr, weekly_hours>. Cards
 * use the column "Target Hrs" (or backwards-compat "Weekly Demand"). The
 * value is weekly hours of provider availability, NOT visits.
 */
function parseStateHours(csv: string, issues: Record<string, number>): Map<string, number> {
  const result = new Map<string, number>();
  if (!csv) return result;
  const rows = parseCSV(csv);
  for (const r of rows) {
    const stateRaw = col(r, 'State', 'state', 'service_state');
    const hoursRaw = col(
      r,
      'Target Hrs', 'target_hrs', 'target hours', 'TargetHrs',
      'Weekly Demand', 'weekly_demand', 'weekly_hours',
      'projected_visits', 'forecasted_visits', 'forecast',
      'visits', 'Visits', 'count', 'Count', 'sum', 'Sum',
    );
    if (!stateRaw || !hoursRaw) { bump(issues, 'missing_field'); continue; }
    const abbr = toAbbreviation(stateRaw);
    if (!abbr) { bump(issues, 'unknown_state'); continue; }
    const v = Number(hoursRaw.replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(v) || v < 0) { bump(issues, 'unparseable_value'); continue; }
    result.set(abbr, v);
  }
  return result;
}

function sumValues(map: Map<string, number>): number {
  let s = 0;
  for (const v of map.values()) s += v;
  return s;
}

function sumMapBy<T>(map: Map<string, T>, picker: (t: T) => number): number {
  let s = 0;
  for (const v of map.values()) s += picker(v);
  return s;
}

// ── CSV ───────────────────────────────────────────────────────────────────
function parseCSV(text: string): Row[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function col(row: Row, ...candidates: string[]): string {
  const norm = (s: string) =>
    s.replace(/^﻿/, '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const c of candidates) {
    const target = norm(c);
    const key = Object.keys(row).find(k => norm(k) === target);
    if (key && row[key] !== undefined) return row[key].trim();
  }
  return '';
}

// ── Date helpers ──────────────────────────────────────────────────────────
function defaultNextMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

function listMonthDays(monthISO: string): string[] {
  const [y, m] = monthISO.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= days; d++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
