/**
 * compute-demand-forecast edge function
 *
 * Pulls historical daily visit counts per state from a Metabase card,
 * computes a per-(state, day_of_week) average over the lookback window,
 * and projects forward into demand_forecast.
 *
 * Each invocation creates a fresh forecast_run_id, marks prior baseline
 * rows as is_baseline=false, and inserts the new projection rows with
 * is_baseline=true.
 *
 * Required secrets:
 *   METABASE_USERNAME
 *   METABASE_PASSWORD
 *   METABASE_DEMAND_CARD_ID  – id of the historical-visits-by-state-by-date
 *                              card (can be overridden per-call via ?card_id=)
 *
 * Query params (all optional):
 *   ?card_id=N            override the env var
 *   ?lookback_weeks=8     how many weeks of history to average over
 *   ?forecast_weeks=8     how far forward to project
 *   ?growth=1.0           multiplier applied to all projected visits
 *   ?dry_run=1            compute without writing to demand_forecast
 *
 * Expected CSV column shape (aliases tolerated):
 *   state | date | visits
 *
 * Behavior on weekly source data: if dates are all spaced 7 days apart, we
 * assume each row represents a week and divide visits by 7 evenly across
 * the seven days. Daily sources are preferred.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const METABASE_URL = 'https://metabase.vitablehealth.com';

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
  const cardIdRaw = url.searchParams.get('card_id') ?? Deno.env.get('METABASE_DEMAND_CARD_ID');
  const cardId = cardIdRaw ? Number(cardIdRaw) : NaN;
  if (!Number.isFinite(cardId)) {
    return json({ error: 'card_id is required (set METABASE_DEMAND_CARD_ID secret or pass ?card_id=)' }, 400);
  }

  const lookbackWeeks = clampInt(url.searchParams.get('lookback_weeks'), 1, 52, 8);
  const forecastWeeks = clampInt(url.searchParams.get('forecast_weeks'), 1, 26, 8);
  const growth = clampFloat(url.searchParams.get('growth'), 0.1, 5, 1.0);
  const dryRun = url.searchParams.get('dry_run') === '1';

  try {
    // ── Auth + download ─────────────────────────────────────────────────
    const token = await getMetabaseToken(username, password);
    const csv = await downloadCardCsv(token, cardId);
    const rows = parseCSV(csv);
    if (rows.length === 0) return json({ error: 'Card returned no rows', card_id: cardId }, 422);

    // ── Normalize + filter ──────────────────────────────────────────────
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const lookbackStart = new Date(today);
    lookbackStart.setUTCDate(today.getUTCDate() - lookbackWeeks * 7);

    type Observation = { state: string; date: string; visits: number; dow: number };
    const observations: Observation[] = [];
    const skipReasons: Record<string, number> = {};

    for (const row of rows) {
      const stateRaw = col(row, 'state', 'State', 'service_state', 'state_abbreviation');
      const dateRaw = col(row, 'date', 'Date', 'visit_date', 'completed_at', 'day', 'Day', 'date_actual', 'date_actual: Day');
      const visitsRaw = col(
        row,
        'visits', 'Visits', 'visit_count', 'Visit Count',
        'completed_visits', 'Completed Visits', 'count', 'Count',
        'appointments', 'Appointments', 'sum', 'Sum',
        'projected_visits',
      );

      if (!stateRaw || !dateRaw || !visitsRaw) {
        bump(skipReasons, 'missing_field');
        continue;
      }
      const abbr = toAbbreviation(stateRaw);
      if (!abbr) { bump(skipReasons, 'unknown_state'); continue; }
      const isoDate = parseDate(dateRaw);
      if (!isoDate) { bump(skipReasons, 'unparseable_date'); continue; }
      const visits = Number(visitsRaw.replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(visits) || visits < 0) { bump(skipReasons, 'unparseable_visits'); continue; }

      const d = new Date(isoDate + 'T00:00:00Z');
      if (d < lookbackStart || d > today) { bump(skipReasons, 'out_of_window'); continue; }

      observations.push({ state: abbr, date: isoDate, visits, dow: d.getUTCDay() });
    }

    if (observations.length === 0) {
      return json({ error: 'No usable rows after filtering', card_id: cardId, skipped: skipReasons }, 422);
    }

    // ── Detect weekly vs daily ──────────────────────────────────────────
    // Heuristic: if every observation date lands on the same weekday
    // (e.g. all Mondays), assume the source is weekly.
    const distinctDows = new Set(observations.map(o => o.dow));
    const weekly = distinctDows.size === 1;

    // ── Compute (state, dow) averages ───────────────────────────────────
    // For weekly data we divide visits by 7 first.
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const o of observations) {
      const visits = weekly ? o.visits / 7 : o.visits;
      const dows = weekly ? [0, 1, 2, 3, 4, 5, 6] : [o.dow];
      for (const d of dows) {
        const k = `${o.state}_${d}`;
        const b = buckets.get(k) ?? { sum: 0, n: 0 };
        b.sum += visits;
        b.n += 1;
        buckets.set(k, b);
      }
    }

    const avgByKey = new Map<string, number>();
    for (const [k, b] of buckets) {
      avgByKey.set(k, b.n > 0 ? b.sum / b.n : 0);
    }

    // ── Project forward ─────────────────────────────────────────────────
    const forecastRunId = crypto.randomUUID();
    const computedAt = new Date().toISOString();
    const states = Array.from(new Set(observations.map(o => o.state)));

    const projections: Array<{
      date: string;
      state: string;
      projected_visits: number;
      forecast_run_id: string;
      is_baseline: boolean;
      computed_at: string;
    }> = [];

    const horizonStart = new Date(today);
    for (let day = 0; day < forecastWeeks * 7; day++) {
      const d = new Date(horizonStart);
      d.setUTCDate(horizonStart.getUTCDate() + day);
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      for (const state of states) {
        const avg = avgByKey.get(`${state}_${dow}`) ?? 0;
        const projected = Math.round(avg * growth * 100) / 100;
        projections.push({
          date: iso,
          state,
          projected_visits: projected,
          forecast_run_id: forecastRunId,
          is_baseline: true,
          computed_at: computedAt,
        });
      }
    }

    // ── Write to demand_forecast (unless dry run) ───────────────────────
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

      // Insert the new run in chunks (Supabase has a row limit per insert)
      const CHUNK = 500;
      for (let i = 0; i < projections.length; i += CHUNK) {
        const chunk = projections.slice(i, i + CHUNK);
        const { error: insertErr } = await supabase.from('demand_forecast').insert(chunk);
        if (insertErr) throw new Error(`Insert failed at chunk ${i}: ${insertErr.message}`);
      }
    }

    return json({
      ok: true,
      forecast_run_id: forecastRunId,
      card_id: cardId,
      source_granularity: weekly ? 'weekly' : 'daily',
      observations: observations.length,
      states: states.length,
      lookback_weeks: lookbackWeeks,
      forecast_weeks: forecastWeeks,
      growth,
      projection_rows: projections.length,
      previous_baseline_demoted: demoted,
      dry_run: dryRun,
      skipped: skipReasons,
      sample_projection: projections.slice(0, 5),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), card_id: cardId }, 500);
  }
});

// ─── Metabase helpers ─────────────────────────────────────────────────────
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
  if (!res.ok) throw new Error(`CSV download ${res.status}: ${await res.text()}`);
  return res.text();
}

// ─── CSV parsing ──────────────────────────────────────────────────────────
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

// ─── Param helpers ────────────────────────────────────────────────────────
function clampInt(raw: string | null, min: number, max: number, dflt: number): number {
  if (!raw) return dflt;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(raw: string | null, min: number, max: number, dflt: number): number {
  if (!raw) return dflt;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
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
