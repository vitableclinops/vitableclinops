/**
 * sync-metabase edge function
 *
 * Downloads all configured Metabase reports as CSVs, parses them,
 * and upserts into the appropriate Lovable Cloud tables.
 *
 * Triggered daily by a GitHub Actions cron job via HTTP POST.
 *
 * Required Lovable Cloud Secrets (Cloud icon → Secrets):
 *   METABASE_USERNAME   – your Metabase login email
 *   METABASE_PASSWORD   – your Metabase password
 *   SYNC_SECRET         – shared secret that the GitHub Action sends in x-sync-secret header
 *
 * Reports handled:
 *   SLA Attainment Rate by State              → state_sla_attainment
 *   Sum of same_next_day_available_slots ...  → leftover_slots
 *   Weekly demand forecast + active members   → demand_forecast
 *   Utilization Rate by Provider (5-week)     → provider_utilization
 *   rpt_telemedicine_availability_by_state..  → metabase_raw_exports (storage)
 *   Average of SLA Attainment Rate            → metabase_raw_exports (storage)
 *   PCP State Coverage                        → metabase_raw_exports (storage)
 *   Provider Appointment Count                → metabase_raw_exports (storage)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};

const METABASE_URL = 'https://metabase.vitablehealth.com';

// ---------------------------------------------------------------------------
// Report config: name → handler
// ---------------------------------------------------------------------------

type Handler = (rows: Row[], supabase: SupabaseClient) => Promise<ImportResult>;
type Row = Record<string, string>;
type SupabaseClient = ReturnType<typeof createClient>;
type ImportResult = { inserted: number; errors: string[] };

const REPORTS: Array<{ name: string; handler: Handler }> = [
  {
    name: 'SLA Attainment Rate by State',
    handler: handleSlaByState,
  },
  {
    name: 'Average of SLA Attainment Rate',
    handler: handleRawStore('average_sla_attainment'),
  },
  {
    name: 'rpt_telemedicine_availability_by_state_per_day',
    handler: handleRawStore('telemedicine_availability'),
  },
  {
    name: 'Sum of same_next_day_available_slots by state and date_actual: Day',
    handler: handleLeftoverSlots,
  },
  {
    name: 'Weekly demand forecast + active members by state',
    handler: handleDemandForecast,
  },
  {
    name: 'PCP State Coverage',
    handler: handleRawStore('pcp_state_coverage'),
  },
  {
    name: 'Provider Appointment Count',
    handler: handleRawStore('provider_appointment_count'),
  },
  {
    name: 'Utilization Rate by Provider (5-week)',
    handler: handleProviderUtilization,
  },
  {
    name: 'time-slot-utilization-booking-rate',
    handler: handleUtilizationDaily,
  },
];

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Verify sync secret
  const syncSecret = Deno.env.get('SYNC_SECRET');
  if (syncSecret && req.headers.get('x-sync-secret') !== syncSecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Open a sync_runs row up front so failures are visible even if the
  //    function crashes before completing.
  const startedAt = Date.now();
  const { data: runRow } = await supabase
    .from('sync_runs')
    .insert({ function_name: 'sync-metabase', status: 'running' })
    .select('id')
    .single();
  const runId: string | null = (runRow?.id as string) ?? null;

  const finalizeRun = async (
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

  const username = Deno.env.get('METABASE_USERNAME');
  const password = Deno.env.get('METABASE_PASSWORD');
  if (!username || !password) {
    await finalizeRun('error', { error_message: 'METABASE_USERNAME and METABASE_PASSWORD secrets are required' });
    return json({ error: 'METABASE_USERNAME and METABASE_PASSWORD secrets are required' }, 500);
  }

  // Authenticate to Metabase
  let token: string;
  try {
    token = await getMetabaseToken(username, password);
  } catch (err) {
    await finalizeRun('error', { error_message: `Metabase auth failed: ${err}` });
    return json({ error: `Metabase auth failed: ${err}` }, 502);
  }

  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, unknown> = {};
  let totalProcessed = 0;
  let totalFailed = 0;
  let reportFailures = 0;

  for (const report of REPORTS) {
    try {
      // Find card ID by name
      const cardId = await findCardId(token, report.name);
      if (!cardId) {
        results[report.name] = { skipped: true, reason: 'Card not found in Metabase' };
        reportFailures++;
        continue;
      }

      // Download CSV
      const csvText = await downloadCSV(token, cardId);

      // Parse CSV
      const rows = parseCSV(csvText);
      if (rows.length === 0) {
        results[report.name] = { skipped: true, reason: 'Empty CSV' };
        continue;
      }

      // Run handler
      const result = await report.handler(rows, supabase);
      totalProcessed += result.inserted;
      totalFailed += result.errors.length;
      results[report.name] = { ok: true, cardId, rowCount: rows.length, ...result };

    } catch (err) {
      reportFailures++;
      results[report.name] = { ok: false, error: String(err) };
    }
  }

  const status: 'success' | 'partial' | 'error' =
    reportFailures === REPORTS.length ? 'error'
    : reportFailures > 0 ? 'partial'
    : 'success';

  await finalizeRun(status, {
    rows_processed: totalProcessed,
    rows_failed: totalFailed,
    error_message: reportFailures > 0 ? `${reportFailures}/${REPORTS.length} reports failed` : undefined,
    details: results,
  });

  return json({ ok: status !== 'error', date: today, status, results });
});

// ---------------------------------------------------------------------------
// Metabase helpers
// ---------------------------------------------------------------------------

async function getMetabaseToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { id: string };
  return data.id;
}

async function findCardId(token: string, name: string): Promise<number | null> {
  const res = await fetch(
    `${METABASE_URL}/api/search?q=${encodeURIComponent(name)}&models=card`,
    { headers: { 'X-Metabase-Session': token } },
  );
  if (!res.ok) return null;
  const body = await res.json() as { data: { id: number; name: string }[] };
  const exact = body.data?.find(
    (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  return exact?.id ?? null;
}

async function downloadCSV(token: string, cardId: number): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/card/${cardId}/query/csv`, {
    method: 'POST',
    headers: { 'X-Metabase-Session': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`CSV download failed: ${res.status} ${await res.text()}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with commas inside)
// ---------------------------------------------------------------------------

function parseCSV(text: string): Row[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function col(row: Row, ...candidates: string[]): string {
  for (const c of candidates) {
    const key = Object.keys(row).find((k) => k.trim().toLowerCase() === c.toLowerCase());
    if (key && row[key] !== undefined) return row[key].trim();
  }
  return '';
}

function parsePct(raw: string): number | null {
  const s = raw.replace('%', '').trim();
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return n <= 1 ? Math.round(n * 10000) / 100 : Math.round(n * 100) / 100;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Report handlers
// ---------------------------------------------------------------------------

async function handleSlaByState(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const stateName = col(row, 'State', 'state');
    const slaRaw = col(row, 'SLA Attainment Rate', 'sla attainment rate', 'sla');

    const abbr = toAbbreviation(stateName);
    if (!abbr) { errors.push(`Unknown state: "${stateName}"`); continue; }

    const sla = parsePct(slaRaw);
    if (sla === null) { errors.push(`Unparseable SLA: "${slaRaw}" for ${stateName}`); continue; }

    records.push({
      state_abbreviation: abbr,
      window_label: 'daily_auto',
      window_start: today,
      window_end: today,
      sla_pct: sla,
      imported_at: nowIso,
      source: 'metabase_sync',
      synced_at: nowIso,
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('state_sla_attainment')
    .upsert(records, { onConflict: 'state_abbreviation,window_label' });
  if (error) throw new Error(error.message);

  return { inserted: records.length, errors };
}

async function handleLeftoverSlots(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const stateName = col(row, 'State', 'state');
    const dateRaw = col(row, 'date_actual: Day', 'date_actual', 'date', 'Day');
    const slotsRaw = col(row, 'Sum of same_next_day_available_slots', 'slots', 'available_slots');

    const abbr = toAbbreviation(stateName);
    if (!abbr) { errors.push(`Unknown state: "${stateName}"`); continue; }

    const date = parseDate(dateRaw);
    if (!date) { errors.push(`Unparseable date: "${dateRaw}" for ${stateName}`); continue; }

    const slots = parseInt(slotsRaw.replace(/[^0-9.-]/g, ''), 10);
    if (isNaN(slots)) { errors.push(`Non-numeric slots: "${slotsRaw}" for ${stateName}`); continue; }

    records.push({
      state_abbreviation: abbr,
      date_actual: date,
      available_slots: slots,
      window_type: 'forecast',
      imported_at: new Date().toISOString(),
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('leftover_slots')
    .upsert(records, { onConflict: 'state_abbreviation,date_actual' });
  if (error) throw new Error(error.message);

  return { inserted: records.length, errors };
}

async function handleDemandForecast(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];

  for (const row of rows) {
    const stateName = col(row, 'State', 'state');
    const weekRaw = col(row, 'Week', 'week_start', 'date', 'period');
    const visitsRaw = col(row, 'Visits', 'visits', 'projected_visits', 'count', 'active_members', 'members');

    if (!stateName || !weekRaw) { errors.push(`Skipping row missing state/week: ${JSON.stringify(row)}`); continue; }

    const abbr = toAbbreviation(stateName);
    if (!abbr) { errors.push(`Unknown state: "${stateName}"`); continue; }

    const weekStart = toMonday(parseDate(weekRaw) ?? '');
    if (!weekStart) { errors.push(`Unparseable week: "${weekRaw}" for ${stateName}`); continue; }

    const visits = parseInt(visitsRaw.replace(/[^0-9.-]/g, ''), 10);
    if (isNaN(visits)) { errors.push(`Non-numeric visits: "${visitsRaw}" for ${stateName}`); continue; }

    records.push({
      state_abbreviation: abbr,
      week_start: weekStart,
      projected_visits: visits,
      imported_at: new Date().toISOString(),
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('demand_forecast')
    .upsert(records, { onConflict: 'state_abbreviation,week_start' });
  if (error) throw new Error(error.message);

  return { inserted: records.length, errors };
}

async function handleProviderUtilization(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];

  // Compute 5-week window
  const now = new Date();
  const windowEnd = now.toISOString().slice(0, 10);
  const windowStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const row of rows) {
    const providerName = col(row, 'Provider', 'provider', 'name');
    const utilRaw = col(row, 'Avg Time Slot Utilization', 'utilization', 'avg_utilization', 'Utilization Rate');
    const slotsRaw = col(row, 'Total Timeslots', 'total_timeslots', 'timeslots');

    if (!providerName) { errors.push(`Row missing provider name: ${JSON.stringify(row)}`); continue; }

    const utilization = parsePct(utilRaw);
    if (utilization === null) { errors.push(`Unparseable utilization: "${utilRaw}" for ${providerName}`); continue; }

    const totalTimeslots = slotsRaw ? parseInt(slotsRaw.replace(/[^0-9]/g, ''), 10) : null;

    const nowIso = new Date().toISOString();
    records.push({
      provider_name: providerName,
      avg_utilization_pct: utilization,
      total_timeslots: isNaN(totalTimeslots ?? NaN) ? null : totalTimeslots,
      window_start: windowStart,
      window_end: windowEnd,
      imported_at: nowIso,
      source: 'metabase_sync',
      synced_at: nowIso,
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  // Upsert into provider_utilization by name + window
  const { error } = await supabase
    .from('provider_utilization')
    .upsert(records, { onConflict: 'provider_name,window_start' });
  if (error) throw new Error(error.message);

  return { inserted: records.length, errors };
}

async function handleUtilizationDaily(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];

  for (const row of rows) {
    const dateRaw = col(row, 'Date', 'date', 'Period', 'period', 'day', 'Day');
    const pctRaw = col(
      row,
      'Booking Rate',
      'booking_rate',
      'Utilization',
      'utilization',
      'Avg Booking Rate',
      'avg_booking_rate',
      '%',
      'Rate',
      'rate',
    );

    const date = parseDate(dateRaw);
    if (!date) { errors.push(`Unparseable date: "${dateRaw}"`); continue; }

    const pct = parsePct(pctRaw);
    if (pct === null) { errors.push(`Unparseable rate: "${pctRaw}" for ${dateRaw}`); continue; }

    const nowIso = new Date().toISOString();
    records.push({
      util_date: date,
      overall_pct: pct,
      imported_at: nowIso,
      source: 'metabase_sync',
      synced_at: nowIso,
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('utilization_daily')
    .upsert(records, { onConflict: 'util_date' });
  if (error) throw new Error(error.message);

  return { inserted: records.length, errors };
}

/**
 * For reports without a dedicated table, store raw JSONB rows
 * in metabase_raw_exports so they're queryable from the app.
 */
function handleRawStore(reportKey: string): Handler {
  return async (rows: Row[], supabase: SupabaseClient): Promise<ImportResult> => {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from('metabase_raw_exports')
      .upsert(
        { report_key: reportKey, pulled_date: today, rows, row_count: rows.length, pulled_at: new Date().toISOString() },
        { onConflict: 'report_key,pulled_date' },
      );
    if (error) throw new Error(error.message);
    return { inserted: rows.length, errors: [] };
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

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
