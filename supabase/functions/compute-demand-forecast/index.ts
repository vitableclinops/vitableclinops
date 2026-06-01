/**
 * compute-demand-forecast edge function
 *
 * Demand methodology (July 2026 planning build):
 *
 *   Metabase is the authoritative demand source.
 *
 *   Card 2974 (telehealth) returns one row per state with:
 *     State, Weekly Demand, Active Members Count.
 *
 *   Card 2973 (MH coaching) and card 2971 (therapy/LPC) return:
 *     Appointment State, Target hrs.
 *
 *   All card values are weekly hours of provider availability needed,
 *   not visits. For June/July planning, apply the documented summer trough:
 *
 *     adjusted_weekly  = raw_weekly * 0.95
 *     adjusted_monthly = adjusted_weekly * (days_in_month / 7)
 *     daily_target     = adjusted_weekly / 6
 *
 *   Do not apply cohort growth buffers or a generic 4.33 month factor.
 *   In-home scheduling is intentionally excluded from this simplified
 *   forecast and handled separately.
 *
 * Pipeline:
 *   1. Auth to Metabase.
 *   2. Pull cards 2974 (telehealth), 2973 (MH coach), and 2971 (therapy).
 *   3. Apply the 0.95 seasonal multiplier.
 *   4. Write demand_forecast per-day per-state and state_demand_targets
 *      per (state, month) for telehealth.
 *   5. Write service_line_demand_targets for MH coaching and therapy.
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
const SEASONAL_MULTIPLIER = 0.95;
const METHODOLOGY_VERSION = 'july_2026_summer_trough_v1';

// Telehealth cohort assignments and buffers
const COHORT_STATES: Record<string, Set<string>> = {
  Core:      new Set(['PA', 'NJ']),
  Growth:    new Set(['TX', 'OH', 'FL']),
  'MD-Only': new Set(['GA', 'IN', 'MO', 'TN', 'SC', 'MS', 'AL']),
  DMV:       new Set(['DC', 'MD', 'VA']),
  DE:        new Set(['DE']),
};

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
type TelehealthDemand = {
  weeklyDemand: number;
  activeMembers: number | null;
};

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

    // Pull the three forecast cards in parallel.
    const [teleCsv, coachCsv, therapyCsv] = await Promise.all([
      downloadCardCsv(token, TELEHEALTH_CARD),
      downloadCardCsvSafe(token, COACHING_CARD),
      downloadCardCsvSafe(token, THERAPY_CARD),
    ]);

    if (inspect) {
      return json({
        ok: true,
        mode: 'inspect',
        cards: {
          telehealth: cardSnapshot(TELEHEALTH_CARD, teleCsv),
          coaching:   cardSnapshot(COACHING_CARD, coachCsv),
          therapy:    cardSnapshot(THERAPY_CARD, therapyCsv),
        },
      });
    }

    const issues: Record<string, Record<string, number>> = {
      telehealth: {}, coaching: {}, therapy: {},
    };

    // Parse each card. Card values are weekly hours of provider availability.
    const teleByState   = parseTelehealthRows(teleCsv, issues.telehealth);
    const coachByState  = parseStateHours(coachCsv,   issues.coaching);
    const therapyByState= parseStateHours(therapyCsv, issues.therapy);

    if (teleByState.size === 0) {
      return json({ error: `Telehealth card ${TELEHEALTH_CARD} returned no rows` }, 422);
    }

    const monthWeeks = weeksInMonth(targetMonth);
    const monthDays = listMonthDays(targetMonth);

    // ── Telehealth: apply summer trough per state ────────────────────
    type TelehealthRow = {
      raw: number;
      adjusted: number;
      monthly: number;
      dailyTarget: number;
      cohort: string;
      activeMembers: number | null;
    };
    const teleAdjusted = new Map<string, TelehealthRow>();
    for (const [state, row] of teleByState) {
      const adjusted = row.weeklyDemand * SEASONAL_MULTIPLIER;
      const cohort = cohortFor(state);
      teleAdjusted.set(state, {
        raw: row.weeklyDemand,
        adjusted,
        monthly: adjusted * monthWeeks,
        dailyTarget: adjusted / 6,
        cohort,
        activeMembers: row.activeMembers,
      });
    }

    // ── Planning cohort rollup ────────────────────────────────────────
    type CohortAggregate = {
      raw_weekly_hrs: number;
      adjusted_weekly_hrs: number;
      monthly_hrs: number;
      daily_target_hrs: number;
      seasonal_multiplier: number;
      states: string[];
    };
    const cohortNames = ['Core', 'Growth', 'MD-Only', 'DMV', 'DE', '021'];
    const cohortRollup: Record<string, CohortAggregate> = {};
    for (const c of cohortNames) {
      cohortRollup[c] = {
        raw_weekly_hrs: 0,
        adjusted_weekly_hrs: 0,
        monthly_hrs: 0,
        daily_target_hrs: 0,
        seasonal_multiplier: SEASONAL_MULTIPLIER,
        states: [],
      };
    }
    for (const [state, t] of teleAdjusted) {
      cohortRollup[t.cohort].raw_weekly_hrs += t.raw;
      cohortRollup[t.cohort].adjusted_weekly_hrs += t.adjusted;
      cohortRollup[t.cohort].monthly_hrs += t.monthly;
      cohortRollup[t.cohort].daily_target_hrs += t.dailyTarget;
      cohortRollup[t.cohort].states.push(state);
    }
    for (const c of cohortNames) {
      cohortRollup[c].raw_weekly_hrs = round2(cohortRollup[c].raw_weekly_hrs);
      cohortRollup[c].adjusted_weekly_hrs = round2(cohortRollup[c].adjusted_weekly_hrs);
      cohortRollup[c].monthly_hrs = round2(cohortRollup[c].monthly_hrs);
      cohortRollup[c].daily_target_hrs = round2(cohortRollup[c].daily_target_hrs);
      cohortRollup[c].states.sort();
    }

    // ── Service-line totals ───────────────────────────────────────────
    const telehealthRaw = sumMapBy(teleByState, t => t.weeklyDemand);
    const telehealthAdj = sumMapBy(teleAdjusted, t => t.adjusted);

    const coachingRaw = sumValues(coachByState);
    const coachingAdj = coachingRaw * SEASONAL_MULTIPLIER;

    const therapyRaw = sumValues(therapyByState);
    const therapyAdj = therapyRaw * SEASONAL_MULTIPLIER;

    const totalRaw = telehealthRaw + coachingRaw + therapyRaw;
    const totalAdj = telehealthAdj + coachingAdj + therapyAdj;

    const serviceLines = {
      telehealth:  {
        raw_weekly_hrs: round2(telehealthRaw),
        adjusted_weekly_hrs: round2(telehealthAdj),
        monthly_hrs: round2(telehealthAdj * monthWeeks),
        daily_target_hrs: round2(telehealthAdj / 6),
        seasonal_multiplier: SEASONAL_MULTIPLIER,
      },
      mh_coaching: {
        raw_weekly_hrs: round2(coachingRaw),
        adjusted_weekly_hrs: round2(coachingAdj),
        monthly_hrs: round2(coachingAdj * monthWeeks),
        daily_target_hrs: round2(coachingAdj / 6),
        seasonal_multiplier: SEASONAL_MULTIPLIER,
      },
      therapy: {
        raw_weekly_hrs: round2(therapyRaw),
        adjusted_weekly_hrs: round2(therapyAdj),
        monthly_hrs: round2(therapyAdj * monthWeeks),
        daily_target_hrs: round2(therapyAdj / 6),
        seasonal_multiplier: SEASONAL_MULTIPLIER,
      },
      total: {
        raw_weekly_hrs: round2(totalRaw),
        adjusted_weekly_hrs: round2(totalAdj),
        monthly_hrs: round2(totalAdj * monthWeeks),
        daily_target_hrs: round2(totalAdj / 6),
      },
    };

    // ── Distribute telehealth weekly hours across target month days ───
    const states = Array.from(teleAdjusted.keys()).sort();
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
      const t = teleAdjusted.get(state)!;
      const totalWeight = monthDays.reduce((sum, date) => {
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        return sum + ((dow === 0 || dow === 6) ? 0.5 : 1);
      }, 0);
      for (const date of monthDays) {
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        const weight = (dow === 0 || dow === 6) ? 0.5 : 1;
        projections.push({
          date,
          state,
          projected_visits: round2(t.monthly * (weight / totalWeight)),
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
      raw_weekly_hours: number;
      adjusted_weekly_hours: number;
      daily_target_hours: number;
      active_members: number | null;
      methodology_version: string;
      seasonal_multiplier: number;
      growth_multiplier: number;
      forecast_run_id: string;
      computed_at: string;
    };
    const targets: Target[] = [];
    for (const state of states) {
      const t = teleAdjusted.get(state)!;
      const monthlyHours = round2(t.monthly);
      const dailyTargetHours = round2(t.dailyTarget);
      targets.push({
        state,
        month: targetMonth,
        monthly_visits_target: Math.round(monthlyHours),
        monthly_hours_target: monthlyHours,
        daily_target_slots: Math.max(1, Math.round(dailyTargetHours)),
        raw_weekly_hours: round2(t.raw),
        adjusted_weekly_hours: round2(t.adjusted),
        daily_target_hours: dailyTargetHours,
        active_members: t.activeMembers,
        methodology_version: METHODOLOGY_VERSION,
        seasonal_multiplier: SEASONAL_MULTIPLIER,
        growth_multiplier: SEASONAL_MULTIPLIER,
        forecast_run_id: forecastRunId,
        computed_at: computedAt,
      });
    }

    const serviceLineTargets = [
      {
        service_line: 'mh_coaching',
        label: 'MH Coaching',
        scope: 'nationwide',
        source_card_id: COACHING_CARD,
        raw_weekly_hours: round2(coachingRaw),
        adjusted_weekly_hours: round2(coachingAdj),
        monthly_hours_target: round2(coachingAdj * monthWeeks),
        daily_target_hours: round2(coachingAdj / 6),
      },
      {
        service_line: 'therapy',
        label: 'Therapy / LPC',
        scope: 'active_states',
        source_card_id: THERAPY_CARD,
        raw_weekly_hours: round2(therapyRaw),
        adjusted_weekly_hours: round2(therapyAdj),
        monthly_hours_target: round2(therapyAdj * monthWeeks),
        daily_target_hours: round2(therapyAdj / 6),
      },
    ].map(row => ({
      ...row,
      month: targetMonth,
      seasonal_multiplier: SEASONAL_MULTIPLIER,
      methodology_version: METHODOLOGY_VERSION,
      forecast_run_id: forecastRunId,
      computed_at: computedAt,
    }));

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

      const { error: slErr } = await supabase
        .from('service_line_demand_targets')
        .upsert(serviceLineTargets, { onConflict: 'service_line,month' });
      if (slErr) throw new Error(`service_line_demand_targets upsert failed: ${slErr.message}`);
    }

    return json({
      ok: true,
      methodology_version: METHODOLOGY_VERSION,
      forecast_run_id: forecastRunId,
      target_month: targetMonth,
      month_days: monthDays.length,
      month_weeks: round4(monthWeeks),
      seasonal_multiplier: SEASONAL_MULTIPLIER,
      service_lines: serviceLines,
      planning_cohort_rollup: cohortNames.map(c => ({ cohort: c, ...cohortRollup[c] })),
      states: states.length,
      projection_rows: projections.length,
      target_rows: targets.length,
      service_line_rows: serviceLineTargets.length,
      previous_baseline_demoted: demoted,
      dry_run: dryRun,
      issues,
      state_summary: states.map(s => {
        const t = teleAdjusted.get(s)!;
        const target = targets.find(x => x.state === s)!;
        return {
          state: s,
          cohort: t.cohort,
          active_members: t.activeMembers,
          raw_weekly_hrs: round2(t.raw),
          adjusted_weekly_hrs: round2(t.adjusted),
          monthly_hours_target: target.monthly_hours_target,
          daily_target_hrs: target.daily_target_hours,
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
    const stateRaw = col(r, 'State', 'state', 'service_state', 'Appointment State', 'appointment_state');
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
    const v = Number(hoursRaw.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(v) || v < 0) { bump(issues, 'unparseable_value'); continue; }
    result.set(abbr, v);
  }
  return result;
}

function parseTelehealthRows(csv: string, issues: Record<string, number>): Map<string, TelehealthDemand> {
  const result = new Map<string, TelehealthDemand>();
  if (!csv) return result;
  const rows = parseCSV(csv);
  for (const r of rows) {
    const stateRaw = col(r, 'State', 'state', 'service_state', 'Appointment State', 'appointment_state');
    const demandRaw = col(
      r,
      'Weekly Demand', 'weekly_demand', 'weekly demand',
      'Target Hrs', 'target_hrs', 'target hours', 'TargetHrs',
      'weekly_hours', 'hours', 'Hours',
    );
    const membersRaw = col(
      r,
      'Active Members Count', 'active_members_count', 'active members count',
      'Active Members', 'active_members', 'members',
    );
    if (!stateRaw || !demandRaw) { bump(issues, 'missing_field'); continue; }
    const abbr = toAbbreviation(stateRaw);
    if (!abbr) { bump(issues, 'unknown_state'); continue; }
    const weeklyDemand = Number(demandRaw.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(weeklyDemand) || weeklyDemand < 0) {
      bump(issues, 'unparseable_value');
      continue;
    }
    const activeMembers = membersRaw
      ? Number(membersRaw.replace(/[^0-9.-]/g, ''))
      : null;
    result.set(abbr, {
      weeklyDemand,
      activeMembers: Number.isFinite(activeMembers) ? Math.round(activeMembers) : null,
    });
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
    s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
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

function weeksInMonth(monthISO: string): number {
  const [y, m] = monthISO.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return days / 7;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
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
