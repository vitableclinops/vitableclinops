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
 *   Do not group states into planning buckets, apply group-level buffers, or
 *   use a generic 4.33 month factor. In-home scheduling is intentionally
 *   excluded from this simplified forecast and handled separately.
 *
 * Pipeline:
 *   1. Auth to Metabase.
 *   2. Pull cards 2974 (telehealth), 2973 (MH coach), and 2971 (therapy).
 *   3. Apply the 0.95 seasonal multiplier.
 *   4. Write demand_forecast per-day per-state and state_demand_targets
 *      per (state, month) for telehealth.
 *   5. Write service_line_demand_targets for MH coaching and therapy.
 *   6. Pull card 2940 (PCP State Coverage) and refresh the live
 *      provider_state_active overlay used by provider-state allocation.
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

const METABASE_URL = Deno.env.get('METABASE_URL') ?? 'https://metabase.vitablehealth.com';

const TELEHEALTH_CARD = Number(Deno.env.get('METABASE_BASELINE_CARD_ID') ?? '2974');
const COACHING_CARD = Number(Deno.env.get('METABASE_COACHING_CARD_ID') ?? '2973');
const THERAPY_CARD = Number(Deno.env.get('METABASE_THERAPY_CARD_ID') ?? '2971');
const PCP_STATE_COVERAGE_CARD = Number(
  Deno.env.get('METABASE_PCP_STATE_COVERAGE_CARD_ID') ??
  Deno.env.get('METABASE_ACTIVE_STATE_CARD_ID') ??
  '2940',
);
const SEASONAL_MULTIPLIER = 0.95;
const METHODOLOGY_VERSION = 'july_2026_summer_trough_v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Row = Record<string, string>;
type TelehealthDemand = {
  weeklyDemand: number;
  activeMembers: number | null;
};
type ProviderLookupRow = {
  id: string;
  name: string | null;
  email: string | null;
  npi: string | null;
};
type ProviderStateActiveRow = {
  provider_id: string;
  state: string;
  is_active: boolean;
  source: 'metabase_pcp_state_coverage';
  report_date: string;
  raw_payload: Row;
  provider_name: string | null;
  provider_email: string | null;
  synced_at: string;
};
type PcpCoverageAuditRow = {
  row_key: string;
  provider_id: string | null;
  provider_email: string | null;
  provider_name: string | null;
  npi: string | null;
  state: string;
  is_active: boolean | null;
  active_members: number | null;
  pcp_count: number | null;
  coverage_pct: number | null;
  report_date: string;
  source_card_id: number;
  raw_payload: Row;
  synced_at: string;
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
    const [teleCsv, coachCsv, therapyCsv, pcpCoverageCsv] = await Promise.all([
      downloadCardCsv(token, TELEHEALTH_CARD),
      downloadCardCsvSafe(token, COACHING_CARD),
      downloadCardCsvSafe(token, THERAPY_CARD),
      downloadCardCsvSafe(token, PCP_STATE_COVERAGE_CARD),
    ]);

    if (inspect) {
      return json({
        ok: true,
        mode: 'inspect',
        cards: {
          telehealth: cardSnapshot(TELEHEALTH_CARD, teleCsv),
          coaching:   cardSnapshot(COACHING_CARD, coachCsv),
          therapy:    cardSnapshot(THERAPY_CARD, therapyCsv),
          pcp_state_coverage: cardSnapshot(PCP_STATE_COVERAGE_CARD, pcpCoverageCsv),
        },
      });
    }

    const issues: Record<string, Record<string, number>> = {
      telehealth: {}, coaching: {}, therapy: {}, pcp_state_coverage: {},
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
      activeMembers: number | null;
    };
    const teleAdjusted = new Map<string, TelehealthRow>();
    for (const [state, row] of teleByState) {
      const adjusted = row.weeklyDemand * SEASONAL_MULTIPLIER;
      teleAdjusted.set(state, {
        raw: row.weeklyDemand,
        adjusted,
        monthly: adjusted * monthWeeks,
        dailyTarget: adjusted / 6,
        activeMembers: row.activeMembers,
      });
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
        daily_target_slots: Math.max(5, Math.round(dailyTargetHours)),
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

    // ── Live provider-state active overlay from Metabase card 2940 ────
    const providerLookup = await loadProviderLookup(supabase);
    const pcpStateCoverage = parsePcpStateCoverageRows(
      pcpCoverageCsv,
      providerLookup,
      PCP_STATE_COVERAGE_CARD,
      computedAt.slice(0, 10),
      computedAt,
      issues.pcp_state_coverage,
    );

    // ── Write to Supabase ─────────────────────────────────────────────
    let demoted = 0;
    let pcpCoverageRows = 0;
    let providerStateActiveRows = 0;
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

      if (pcpStateCoverage.auditRows.length > 0) {
        for (const chunk of chunked(pcpStateCoverage.auditRows, 500)) {
          const { error: pcpErr } = await supabase
            .from('metabase_pcp_state_coverage')
            .upsert(chunk, { onConflict: 'row_key' });
          if (pcpErr) throw new Error(`metabase_pcp_state_coverage upsert failed: ${pcpErr.message}`);
          pcpCoverageRows += chunk.length;
        }
      }

      if (pcpStateCoverage.activeRows.length > 0) {
        for (const chunk of chunked(pcpStateCoverage.activeRows, 500)) {
          const { error: activeErr } = await supabase
            .from('provider_state_active')
            .upsert(chunk, { onConflict: 'provider_id,state,source' });
          if (activeErr) throw new Error(`provider_state_active upsert failed: ${activeErr.message}`);
          providerStateActiveRows += chunk.length;
        }
      }
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
      states: states.length,
      projection_rows: projections.length,
      target_rows: targets.length,
      service_line_rows: serviceLineTargets.length,
      pcp_state_coverage: {
        source_card_id: PCP_STATE_COVERAGE_CARD,
        raw_rows: pcpStateCoverage.rawRows,
        matched_provider_state_rows: pcpStateCoverage.activeRows.length,
        audit_rows_written: pcpCoverageRows,
        active_rows_written: providerStateActiveRows,
      },
      previous_baseline_demoted: demoted,
      dry_run: dryRun,
      issues,
      state_summary: states.map(s => {
        const t = teleAdjusted.get(s)!;
        const target = targets.find(x => x.state === s)!;
        return {
          state: s,
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
      'Active Members Count by Active State - Appointment State → Distinct values of Member ID',
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

async function loadProviderLookup(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('providers')
    .select('id, name, email, npi')
    .range(0, 49999);
  if (error) throw new Error(`Provider lookup failed: ${error.message}`);

  const byEmail = new Map<string, ProviderLookupRow>();
  const byName = new Map<string, ProviderLookupRow>();
  const byNpi = new Map<string, ProviderLookupRow>();
  for (const p of (data ?? []) as ProviderLookupRow[]) {
    if (p.email) byEmail.set(normEmail(p.email), p);
    if (p.name) byName.set(normName(p.name), p);
    if (p.npi) byNpi.set(normDigits(p.npi), p);
  }
  return { byEmail, byName, byNpi };
}

function parsePcpStateCoverageRows(
  csv: string,
  providerLookup: Awaited<ReturnType<typeof loadProviderLookup>>,
  sourceCardId: number,
  reportDate: string,
  syncedAt: string,
  issues: Record<string, number>,
): {
  rawRows: number;
  auditRows: PcpCoverageAuditRow[];
  activeRows: ProviderStateActiveRow[];
} {
  const rows = parseCSV(csv);
  const auditRows: PcpCoverageAuditRow[] = [];
  const activeRowsByKey = new Map<string, ProviderStateActiveRow>();

  rows.forEach((row, index) => {
    const stateRaw = col(
      row,
      'State', 'state', 'service_state', 'Appointment State', 'appointment_state',
      'Active State', 'active_state', 'State Abbreviation', 'state_abbreviation',
    );
    const state = stateRaw ? toAbbreviation(stateRaw) : null;
    if (!state) {
      bump(issues, 'missing_or_unknown_state');
      return;
    }

    const providerName = col(
      row,
      'Provider Full Name', 'Provider', 'provider', 'Provider Name', 'provider_name',
      'PCP', 'PCP Name', 'Clinician', 'Clinician Name', 'name',
    ) || null;
    const providerEmail = col(
      row,
      'Provider Email', 'provider_email', 'Email', 'email',
    ) || null;
    const npi = col(row, 'NPI', 'Provider NPI', 'provider_npi') || null;
    const activeRaw = col(
      row,
      'Is Active', 'is_active', 'Active', 'active', 'Coverage Active',
      'pcp_active', 'Status', 'status',
    );
    const activeFlag = activeRaw ? parseActiveFlag(activeRaw) : null;
    const activeMembers = parseIntMaybe(col(
      row,
      'Active Members Count', 'active_members_count', 'Active Members', 'active_members', 'members',
    ));
    const pcpCount = parseIntMaybe(col(
      row,
      'PCP Count', 'pcp_count', 'PCPs', 'providers', 'provider_count', 'count', 'Count',
    ));
    const coveragePct = parsePctMaybe(col(
      row,
      'Coverage %', 'coverage_pct', 'coverage', 'Coverage', 'pct', '%',
    ));

    const matched =
      (providerEmail && providerLookup.byEmail.get(normEmail(providerEmail))) ||
      (npi && providerLookup.byNpi.get(normDigits(npi))) ||
      (providerName && providerLookup.byName.get(normName(providerName))) ||
      null;

    const providerKey =
      matched?.id ??
      (providerEmail ? normEmail(providerEmail) : null) ??
      (providerName ? normName(providerName) : null) ??
      `row-${index}`;

    const rowKey = [
      'metabase_pcp_state_coverage',
      sourceCardId,
      reportDate,
      providerKey,
      state,
    ].filter(Boolean).join('|').toLowerCase();

    const isProviderRow = Boolean(providerName || providerEmail || npi);
    const isActive = activeFlag ?? (isProviderRow ? true : null);

    auditRows.push({
      row_key: rowKey,
      provider_id: matched?.id ?? null,
      provider_email: providerEmail ? normEmail(providerEmail) : matched?.email ?? null,
      provider_name: providerName ?? matched?.name ?? null,
      npi: npi ?? matched?.npi ?? null,
      state,
      is_active: isActive,
      active_members: activeMembers,
      pcp_count: pcpCount,
      coverage_pct: coveragePct,
      report_date: reportDate,
      source_card_id: sourceCardId,
      raw_payload: row,
      synced_at: syncedAt,
    });

    if (isProviderRow && !matched) {
      bump(issues, 'unmatched_provider');
      return;
    }
    if (!matched || isActive === null) return;

    activeRowsByKey.set(`${matched.id}|${state}`, {
      provider_id: matched.id,
      state,
      is_active: isActive,
      source: 'metabase_pcp_state_coverage',
      report_date: reportDate,
      raw_payload: row,
      provider_name: providerName ?? matched.name ?? null,
      provider_email: providerEmail ? normEmail(providerEmail) : matched.email ?? null,
      synced_at: syncedAt,
    });
  });

  return {
    rawRows: rows.length,
    auditRows,
    activeRows: Array.from(activeRowsByKey.values()),
  };
}

function parseActiveFlag(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (['0', 'false', 'no', 'n', 'inactive', 'disabled', 'deactivated'].includes(s)) return false;
  if (['1', 'true', 'yes', 'y', 'active', 'enabled', 'live'].includes(s)) return true;
  if (s.includes('inactive') || s.includes('disabled') || s.includes('deactivated')) return false;
  if (s.includes('active') || s.includes('enabled') || s.includes('live')) return true;
  return null;
}

function parseIntMaybe(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parsePctMaybe(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace('%', '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? round2(n * 100) : round2(n);
}

function normEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normDigits(value: string): string {
  return value.replace(/\D/g, '');
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

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
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
