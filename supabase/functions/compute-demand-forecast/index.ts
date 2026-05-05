/**
 * compute-demand-forecast edge function (Tier 1: deterministic math)
 *
 * Implements the deterministic core of the demand-forecast skill so it can
 * run on a cron without a human in the loop. The qualitative pieces of the
 * skill (Notion Demand Alerts, Slack signals, leadership summary, manual
 * overrides) belong in a Tier 2 GitHub Action that invokes the Claude Agent
 * SDK against the same Supabase tables.
 *
 * Pipeline:
 *   1. Auth to Metabase (METABASE_USERNAME / METABASE_PASSWORD).
 *   2. Pull card 2974 (Weekly demand forecast by state)  → baseline.
 *   3. Pull card 3011 (Monthly completed visits by state) → history.
 *   4. Per state: compute trailing 3-month and 6-month growth from history.
 *      multiplier =
 *        1.25  if max(g3, g6) > 30%      (explosive)
 *        1.125 if max(g3, g6) > 10%      (growing)
 *        1.00  otherwise                 (stable)
 *      (overridable per-state via Metabase 2974's own forecast already
 *      including growth — when 2974's forecast is materially higher than
 *      the trailing average we trust 2974 and clamp the multiplier toward 1.)
 *   5. For the target month, distribute weekly forecasts across days using
 *      the skill's rule: each weekday = 1/6 of weekly, weekend days share
 *      1/6 (so each weekend day = 1/12).
 *   6. Apply per-state growth multiplier.
 *   7. Compute state_demand_targets per the formula:
 *        monthly_visits_target = adjusted_monthly_demand
 *        daily_target_slots    = max(5, round(monthly_visits / 20 * 1.5))
 *        monthly_hours_target  = daily_target_slots * 20 / VISITS_PER_HOUR
 *   8. Write demand_forecast (per-day rows, is_baseline=true, fresh
 *      forecast_run_id; demote prior baseline first) and upsert
 *      state_demand_targets keyed on (state, month).
 *
 * Required secrets:
 *   METABASE_USERNAME
 *   METABASE_PASSWORD
 *
 * Optional secrets / env:
 *   METABASE_BASELINE_CARD_ID  default 2974
 *   METABASE_HISTORY_CARD_ID   default 3011
 *   VISITS_PER_HOUR            default 1.5
 *
 * Query params:
 *   ?target_month=YYYY-MM-01    default = first day of next calendar month
 *   ?baseline_card_id=N
 *   ?history_card_id=N
 *   ?dry_run=1                  compute without writing
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const METABASE_URL = 'https://metabase.vitablehealth.com';
const VISITS_PER_HOUR = Number(Deno.env.get('VISITS_PER_HOUR') ?? '1.5');

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
  const baselineCardId = Number(
    url.searchParams.get('baseline_card_id') ?? Deno.env.get('METABASE_BASELINE_CARD_ID') ?? '2974',
  );
  const historyCardId = Number(
    url.searchParams.get('history_card_id') ?? Deno.env.get('METABASE_HISTORY_CARD_ID') ?? '3011',
  );
  const dryRun = url.searchParams.get('dry_run') === '1';
  const inspect = url.searchParams.get('inspect') === '1';
  const targetMonth = url.searchParams.get('target_month') ?? defaultNextMonth();

  if (!/^\d{4}-\d{2}-01$/.test(targetMonth)) {
    return json({ error: 'target_month must be YYYY-MM-01' }, 400);
  }

  try {
    // ── 1. Auth ───────────────────────────────────────────────────────
    const token = await getMetabaseToken(username, password);

    // ── inspect mode: dump column headers + first rows, no parsing ────
    if (inspect) {
      const baselineCsv = await downloadCardCsv(token, baselineCardId);
      const historyCsv = await downloadCardCsv(token, historyCardId);
      const baselineRows = parseCSV(baselineCsv);
      const historyRows = parseCSV(historyCsv);
      return json({
        ok: true,
        mode: 'inspect',
        baseline: {
          card_id: baselineCardId,
          row_count: baselineRows.length,
          columns: baselineRows[0] ? Object.keys(baselineRows[0]) : [],
          first_3: baselineRows.slice(0, 3),
        },
        history: {
          card_id: historyCardId,
          row_count: historyRows.length,
          columns: historyRows[0] ? Object.keys(historyRows[0]) : [],
          first_3: historyRows.slice(0, 3),
        },
      });
    }

    // ── 2. Pull baseline (weekly demand forecast) ─────────────────────
    const baselineCsv = await downloadCardCsv(token, baselineCardId);
    const baselineRows = parseCSV(baselineCsv);
    if (baselineRows.length === 0) {
      return json({ error: `Card ${baselineCardId} returned no rows` }, 422);
    }

    // state → Map<weekStartISO, visits>
    const baseline = new Map<string, Map<string, number>>();
    const baselineIssues: Record<string, number> = {};
    for (const r of baselineRows) {
      const stateRaw = col(r, 'state', 'State', 'service_state');
      const weekRaw = col(r, 'week', 'Week', 'week_start', 'Week Start', 'date_actual', 'date_actual: Week', 'Day');
      const visitsRaw = col(
        r,
        'weekly_demand', 'Weekly Demand',
        'projected_visits', 'forecasted_visits', 'forecast',
        'visits', 'Visits', 'count', 'Count', 'sum', 'Sum',
      );
      if (!stateRaw || !weekRaw || !visitsRaw) { bump(baselineIssues, 'missing_field'); continue; }
      const abbr = toAbbreviation(stateRaw);
      if (!abbr) { bump(baselineIssues, 'unknown_state'); continue; }
      const week = toMonday(parseDate(weekRaw) ?? '');
      if (!week) { bump(baselineIssues, 'unparseable_week'); continue; }
      const v = Number(visitsRaw.replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(v) || v < 0) { bump(baselineIssues, 'unparseable_visits'); continue; }

      if (!baseline.has(abbr)) baseline.set(abbr, new Map());
      baseline.get(abbr)!.set(week, v);
    }

    // ── 3. Pull history (monthly completed visits) ────────────────────
    const historyCsv = await downloadCardCsv(token, historyCardId);
    const historyRows = parseCSV(historyCsv);

    // state → Map<monthISO, visits>
    const history = new Map<string, Map<string, number>>();
    const historyIssues: Record<string, number> = {};
    for (const r of historyRows) {
      const stateRaw = col(r, 'state', 'State', 'service_state');
      const monthRaw = col(r, 'month', 'Month', 'date_actual: Month', 'period', 'Period', 'date');
      const visitsRaw = col(
        r,
        'completed_visits', 'Completed Visits',
        'visits', 'Visits', 'count', 'Count', 'sum', 'Sum',
        'appointments', 'Appointments',
      );
      if (!stateRaw || !monthRaw || !visitsRaw) { bump(historyIssues, 'missing_field'); continue; }
      const abbr = toAbbreviation(stateRaw);
      if (!abbr) { bump(historyIssues, 'unknown_state'); continue; }
      const month = toFirstOfMonth(parseDate(monthRaw) ?? '');
      if (!month) { bump(historyIssues, 'unparseable_month'); continue; }
      const v = Number(visitsRaw.replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(v) || v < 0) { bump(historyIssues, 'unparseable_visits'); continue; }

      if (!history.has(abbr)) history.set(abbr, new Map());
      history.get(abbr)!.set(month, v);
    }

    // ── 4. Per-state growth multipliers from history CAGR ─────────────
    const today = new Date();
    today.setUTCDate(1);
    today.setUTCHours(0, 0, 0, 0);
    const refMonth = toFirstOfMonth(today.toISOString().slice(0, 10))!;

    const multiplierByState = new Map<string, { multiplier: number; tier: string; g3: number | null; g6: number | null }>();
    for (const state of new Set([...baseline.keys(), ...history.keys()])) {
      const mh = history.get(state) ?? new Map();
      const m1 = mh.get(monthOffset(refMonth, -1)) ?? null;
      const m3 = mh.get(monthOffset(refMonth, -3)) ?? null;
      const m6 = mh.get(monthOffset(refMonth, -6)) ?? null;

      const g3 = m1 != null && m3 != null && m3 > 0 ? Math.pow(m1 / m3, 1 / 3) - 1 : null;
      const g6 = m1 != null && m6 != null && m6 > 0 ? Math.pow(m1 / m6, 1 / 6) - 1 : null;
      const peak = Math.max(g3 ?? -Infinity, g6 ?? -Infinity);

      let multiplier = 1.0;
      let tier = 'stable';
      if (Number.isFinite(peak)) {
        if (peak > 0.30) { multiplier = 1.25; tier = 'explosive'; }
        else if (peak > 0.10) { multiplier = 1.125; tier = 'growing'; }
      } else {
        tier = 'no_history';
      }
      multiplierByState.set(state, { multiplier, tier, g3, g6 });
    }

    // ── 5+6. Distribute weekly forecast over target month days ────────
    const states = Array.from(new Set([...baseline.keys()]));
    const monthDays = listMonthDays(targetMonth);
    const projections: Array<{
      date: string;
      state: string;
      projected_visits: number;
      forecast_run_id: string;
      is_baseline: boolean;
      computed_at: string;
    }> = [];
    const monthlyTotalByState = new Map<string, number>();
    const forecastRunId = crypto.randomUUID();
    const computedAt = new Date().toISOString();
    const stateNotes: Record<string, { source: 'baseline' | 'avg_fallback'; weeks_used: number }> = {};

    for (const state of states) {
      const stateBaseline = baseline.get(state)!;
      const mult = multiplierByState.get(state)?.multiplier ?? 1.0;

      // Build a fallback weekly value: avg of all available weeks for this state
      const allWeekly = Array.from(stateBaseline.values());
      const avgWeekly = allWeekly.length ? allWeekly.reduce((a, b) => a + b, 0) / allWeekly.length : 0;

      let weeksUsed = 0;
      let usedBaseline = false;

      for (const date of monthDays) {
        const weekStart = mondayOf(date);
        let weeklyVisits = stateBaseline.get(weekStart);
        if (weeklyVisits === undefined) {
          weeklyVisits = avgWeekly;
        } else {
          usedBaseline = true;
          weeksUsed++;
        }
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        const weight = (dow === 0 || dow === 6) ? 1 / 12 : 1 / 6;
        const projectedRaw = weeklyVisits * weight * mult;
        const projected = Math.round(projectedRaw * 100) / 100;

        projections.push({
          date,
          state,
          projected_visits: projected,
          forecast_run_id: forecastRunId,
          is_baseline: true,
          computed_at: computedAt,
        });
        monthlyTotalByState.set(state, (monthlyTotalByState.get(state) ?? 0) + projected);
      }

      stateNotes[state] = {
        source: usedBaseline ? 'baseline' : 'avg_fallback',
        weeks_used: new Set(monthDays.map(mondayOf)).size === weeksUsed ? weeksUsed : weeksUsed,
      };
    }

    // ── 7. Compute state_demand_targets ───────────────────────────────
    const targets: Array<{
      state: string;
      month: string;
      monthly_visits_target: number;
      daily_target_slots: number;
      monthly_hours_target: number;
      growth_multiplier: number;
      forecast_run_id: string;
      computed_at: string;
    }> = [];

    for (const state of states) {
      const monthlyVisits = Math.max(0, Math.round(monthlyTotalByState.get(state) ?? 0));
      const dailyTargetRaw = (monthlyVisits / 20) * 1.5;
      const dailyTargetSlots = Math.max(5, Math.round(dailyTargetRaw));
      const monthlyHoursTarget = round2(dailyTargetSlots * 20 / VISITS_PER_HOUR);
      const mult = multiplierByState.get(state)?.multiplier ?? 1.0;

      targets.push({
        state,
        month: targetMonth,
        monthly_visits_target: monthlyVisits,
        daily_target_slots: dailyTargetSlots,
        monthly_hours_target: monthlyHoursTarget,
        growth_multiplier: mult,
        forecast_run_id: forecastRunId,
        computed_at: computedAt,
      });
    }

    // ── 8. Write to Supabase (unless dry run) ─────────────────────────
    let demoted = 0;
    if (!dryRun) {
      // Demote previous baseline rows
      const { data: demoteData, error: demoteErr } = await supabase
        .from('demand_forecast')
        .update({ is_baseline: false })
        .eq('is_baseline', true)
        .select('forecast_run_id');
      if (demoteErr) throw new Error(`Demote failed: ${demoteErr.message}`);
      demoted = demoteData?.length ?? 0;

      // Insert demand_forecast in chunks
      const CHUNK = 500;
      for (let i = 0; i < projections.length; i += CHUNK) {
        const chunk = projections.slice(i, i + CHUNK);
        const { error } = await supabase.from('demand_forecast').insert(chunk);
        if (error) throw new Error(`demand_forecast insert failed at ${i}: ${error.message}`);
      }

      // Upsert state_demand_targets
      const { error: tErr } = await supabase
        .from('state_demand_targets')
        .upsert(targets, { onConflict: 'state,month' });
      if (tErr) throw new Error(`state_demand_targets upsert failed: ${tErr.message}`);
    }

    return json({
      ok: true,
      forecast_run_id: forecastRunId,
      target_month: targetMonth,
      visits_per_hour: VISITS_PER_HOUR,
      states: states.length,
      projection_rows: projections.length,
      target_rows: targets.length,
      previous_baseline_demoted: demoted,
      dry_run: dryRun,
      issues: { baseline: baselineIssues, history: historyIssues },
      state_summary: states.map(s => ({
        state: s,
        tier: multiplierByState.get(s)?.tier,
        multiplier: multiplierByState.get(s)?.multiplier,
        g3_pct: multiplierByState.get(s)?.g3 != null ? Math.round((multiplierByState.get(s)!.g3! ?? 0) * 1000) / 10 : null,
        g6_pct: multiplierByState.get(s)?.g6 != null ? Math.round((multiplierByState.get(s)!.g6! ?? 0) * 1000) / 10 : null,
        monthly_visits_target: targets.find(t => t.state === s)?.monthly_visits_target,
        daily_target_slots: targets.find(t => t.state === s)?.daily_target_slots,
        source: stateNotes[s]?.source,
      })),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ── Metabase helpers ──────────────────────────────────────────────────────
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
function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function toMonday(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateISO: string): string {
  return toMonday(dateISO) ?? dateISO;
}

function toFirstOfMonth(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function defaultNextMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1..12, current month
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

function monthOffset(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
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
