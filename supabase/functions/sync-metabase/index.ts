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
 *   Provider State Utilization                → provider_state_utilization
 *   Daily Provider Utilization                → provider_utilization_daily (per-provider-per-day, powers same-day activation candidates)
 *   rpt_telemedicine_availability_by_state..  → metabase_raw_exports (storage)
 *   Average of SLA Attainment Rate            → metabase_raw_exports (storage)
 *   PCP State Coverage                        → metabase_raw_exports (storage)
 *   Provider Appointment Count                → metabase_raw_exports (storage)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { canonicalName } from '../_shared/nameNormalization.ts';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};

const METABASE_URL = Deno.env.get('METABASE_URL') ?? 'https://metabase.vitablehealth.com';

// ---------------------------------------------------------------------------
// Report config: name → handler
// ---------------------------------------------------------------------------

type Handler = (rows: Row[], supabase: SupabaseClient) => Promise<ImportResult>;
type Row = Record<string, string>;
type SupabaseClient = ReturnType<typeof createClient<any, 'public', any>>;
type ImportResult = { inserted: number; errors: string[] };
type ReportConfig = { name: string; cardId?: number; handler: Handler; optional?: boolean };

// Known card IDs are pinned to bypass fuzzy search and avoid "Card not found".
// Names are still used for fuzzy fallback if a card is moved/renamed.
const REPORTS: ReportConfig[] = [
  {
    name: 'SLA Attainment Rate by State',
    handler: handleSlaByState,
  },
  {
    cardId: 2931,
    name: 'SD/ND SLA Attainment Rate - MTD',
    handler: handleRawStore('average_sla_attainment'),
  },
  {
    cardId: 2429,
    name: 'rpt_telemedicine_availability_by_state_per_day',
    handler: handleStateAccessSlotsDaily,
  },
  {
    cardId: 2431,
    name: 'Same & Next Day Available Slots By State and Day (Next 7 days)',
    handler: handleLeftoverSlots,
  },
  {
    name: 'Weekly demand forecast + active members by state',
    handler: handleDemandForecast,
  },
  {
    cardId: 2940,
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
    name: 'Provider State Utilization',
    handler: handleProviderStateUtilization,
    optional: true,
  },
  {
    cardId: 2424,
    name: 'time-slot-utilization-booking-rate',
    handler: handleUtilizationDaily,
  },
  {
    // Daily per-provider utilization, used for same-day activation candidates.
    // Expected columns (any of the aliases below work): Provider Full Name,
    // Date, Booked Timeslots, Total Timeslots, Utilization Rate.
    cardId: 3295,
    name: 'Daily Provider Utilization',
    handler: handleProviderUtilizationDaily,
  },
];

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Verify sync secret
  const syncSecret = Deno.env.get('SYNC_SECRET');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : '';

  const hasValidSecret = !!syncSecret && req.headers.get('x-sync-secret') === syncSecret;
  const hasValidServiceJwt = !!serviceRoleKey && bearer === serviceRoleKey;

  if (!hasValidSecret && !hasValidServiceJwt) {
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

  // Optional subset filter: POST { "only": ["Same & Next Day"] } or ?only=...
  // Running all reports in one invocation can exceed the worker memory limit,
  // so callers can slice the work into smaller batches.
  let onlyFilters: string[] = [];
  try {
    const url = new URL(req.url);
    const qp = url.searchParams.get('only');
    if (qp) onlyFilters = qp.split(',').map((s) => s.trim()).filter(Boolean);
    if (onlyFilters.length === 0 && req.method === 'POST') {
      const parsed = await req.json().catch(() => null);
      const raw = parsed && typeof parsed === 'object' ? (parsed as any).only : null;
      if (Array.isArray(raw)) onlyFilters = raw.map(String);
      else if (typeof raw === 'string') onlyFilters = [raw];
    }
  } catch { /* no body / bad JSON → run everything */ }

  const selectedReports = onlyFilters.length > 0
    ? REPORTS.filter((r) =>
        onlyFilters.some((f) =>
          r.name.toLowerCase().includes(f.toLowerCase()) || String(r.cardId ?? '') === f,
        ))
    : REPORTS;

  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, unknown> = {};
  let totalProcessed = 0;
  let totalFailed = 0;
  let reportFailures = 0;

  for (const report of selectedReports) {

    try {
      // Use pinned card ID if available, otherwise fuzzy-search by name
      const cardId = report.cardId ?? await findCardId(token, report.name);
      if (!cardId) {
        results[report.name] = { skipped: true, reason: 'Card not found in Metabase' };
        if (!report.optional) reportFailures++;
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
  const candidates = body.data ?? [];
  const target = name.trim().toLowerCase();

  // 1) Exact match (case-insensitive)
  const exact = candidates.find((c) => c.name.trim().toLowerCase() === target);
  if (exact) return exact.id;

  // 2) Normalized match: collapse whitespace + strip punctuation
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tNorm = norm(name);
  const normMatch = candidates.find((c) => norm(c.name) === tNorm);
  if (normMatch) return normMatch.id;

  // 3) Substring match (target words all appear in candidate)
  const words = tNorm.split(' ').filter((w) => w.length > 2);
  const substr = candidates.find((c) => {
    const cn = norm(c.name);
    return words.every((w) => cn.includes(w));
  });
  return substr?.id ?? null;
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
  // Normalize key: lowercase, collapse internal whitespace, strip BOM/zero-width chars
  const norm = (s: string) =>
    s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const c of candidates) {
    const target = norm(c);
    const key = Object.keys(row).find((k) => norm(k) === target);
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

function intOrNull(raw: string): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function stateAccessMetric(header: string): 'booked' | 'available' | null {
  const h = header.toLowerCase();
  if (/\bbook/.test(h) || /\bappointment/.test(h)) return 'booked';
  if (/\bremain/.test(h) || /\bavail/.test(h) || /same_next_day_available_slots/.test(h)) return 'available';
  if (stateAccessDateFromHeader(header, new Date().toISOString().slice(0, 10))) return 'available';
  return null;
}

function stateAccessDateFromHeader(header: string, today: string): string | null {
  const cleaned = header.replace(/\b(booked|remaining|available|avail|slots|appointments?)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  const explicit = parseDate(cleaned);
  if (explicit) return explicit;

  const monthDayYear = /(?:sun|mon|tue|wed|thu|fri|sat)?[,]?\s*([A-Z][a-z]{2,8})\s+(\d{1,2})(?:,\s*(\d{4}))?/i.exec(cleaned);
  if (monthDayYear) {
    const year = monthDayYear[3] ?? today.slice(0, 4);
    const parsed = parseDate(`${monthDayYear[1]} ${monthDayYear[2]}, ${year}`);
    if (parsed) return parsed;
  }

  const dowMatch = /^(sun|mon|tue|wed|thu|fri|sat)\b/i.exec(cleaned);
  if (!dowMatch) return null;
  const targetDow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(dowMatch[1].toLowerCase().slice(0, 3));
  if (targetDow < 0) return null;
  const base = new Date(today + 'T00:00:00Z');
  const baseDow = base.getUTCDay();
  const diff = (targetDow - baseDow + 7) % 7;
  base.setUTCDate(base.getUTCDate() + diff);
  return base.toISOString().slice(0, 10);
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
      slot_date: date,
      unfilled_slots: slots,
      window_type: 'historical',
      imported_at: nowIso,
      source: 'metabase_sync',
      synced_at: nowIso,
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('state_leftover_slots')
    .upsert(records, { onConflict: 'state_abbreviation,slot_date,window_type' });
  if (error) throw new Error(error.message);

  return { inserted: records.length, errors };
}

async function handleStateAccessSlotsDaily(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  try {
    await storeRawExport(supabase, 'telemedicine_availability', rows, today);
  } catch (e) {
    errors.push(`Raw export store failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const byKey = new Map<string, {
    access_date: string;
    state: string;
    booked_slots: number | null;
    available_slots: number | null;
    total_slots: number | null;
    source: string;
    source_card_id: number;
    raw_payload: Record<string, string>;
    synced_at: string;
  }>();

  for (const row of rows) {
    const stateName = col(row, 'State', 'state', 'Appointment State', 'appointment_state', 'service_state');
    const state = toAbbreviation(stateName);
    if (!state) { errors.push(`Unknown state: "${stateName}"`); continue; }

    const explicitDate = parseDate(col(row, 'Date', 'date', 'Day', 'day', 'report_date', 'date_actual', 'date_actual: Day'));
    if (explicitDate) {
      const booked = intOrNull(col(row, 'same_next_day_booked_slots', 'Same Next Day Booked Slots', 'Booked', 'booked', 'Booked Slots', 'booked_slots', 'Appointments', 'appointments', 'appointment_count', 'Appointment Count'));
      const available = intOrNull(col(row, 'same_next_day_available_slots', 'Sum of same_next_day_available_slots', 'Same Next Day Available Slots', 'Remaining', 'remaining', 'Available', 'available', 'Available Slots', 'available_slots'));
      const total = booked !== null && available !== null
        ? booked + available
        : intOrNull(col(row, 'same_next_day_total_slots', 'Same Next Day Total Slots', 'Total', 'total', 'Total Slots', 'total_slots'));
      if (booked === null && available === null && total === null) {
        errors.push(`No state access counts for ${state} on ${explicitDate}`);
        continue;
      }
      mergeStateAccess(byKey, {
        access_date: explicitDate,
        state,
        booked_slots: booked,
        available_slots: available,
        total_slots: total,
        source: 'metabase_sync',
        source_card_id: 2429,
        raw_payload: row,
        synced_at: nowIso,
      });
      continue;
    }

    for (const [header, rawValue] of Object.entries(row)) {
      const metric = stateAccessMetric(header);
      if (!metric) continue;
      const accessDate = stateAccessDateFromHeader(header, today);
      if (!accessDate) continue;
      const value = intOrNull(String(rawValue ?? ''));
      if (value === null) continue;
      const key = `${accessDate}|${state}`;
      const current = byKey.get(key) ?? {
        access_date: accessDate,
        state,
        booked_slots: null,
        available_slots: null,
        total_slots: null,
        source: 'metabase_sync',
        source_card_id: 2429,
        raw_payload: row,
        synced_at: nowIso,
      };
      if (metric === 'booked') current.booked_slots = value;
      else current.available_slots = value;
      if (current.booked_slots !== null && current.available_slots !== null) {
        current.total_slots = current.booked_slots + current.available_slots;
      }
      byKey.set(key, current);
    }
  }

  const records = Array.from(byKey.values()).filter((row) =>
    row.booked_slots !== null || row.available_slots !== null || row.total_slots !== null
  );
  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('state_access_slots_daily')
    .upsert(records, { onConflict: 'access_date,state,source' });
  if (error) throw new Error(error.message);

  return { inserted: records.length, errors };
}

function mergeStateAccess(
  byKey: Map<string, {
    access_date: string;
    state: string;
    booked_slots: number | null;
    available_slots: number | null;
    total_slots: number | null;
    source: string;
    source_card_id: number;
    raw_payload: Record<string, string>;
    synced_at: string;
  }>,
  row: {
    access_date: string;
    state: string;
    booked_slots: number | null;
    available_slots: number | null;
    total_slots: number | null;
    source: string;
    source_card_id: number;
    raw_payload: Record<string, string>;
    synced_at: string;
  },
) {
  const key = `${row.access_date}|${row.state}`;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, row);
    return;
  }
  existing.booked_slots = row.booked_slots ?? existing.booked_slots;
  existing.available_slots = row.available_slots ?? existing.available_slots;
  existing.total_slots = row.total_slots ?? (
    existing.booked_slots !== null && existing.available_slots !== null
      ? existing.booked_slots + existing.available_slots
      : existing.total_slots
  );
}

async function handleDemandForecast(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];

  // Card 2957 returns: State | Weekly Demand | Active Members Count
  // No week column — fall back to current Monday.
  const now = new Date();
  const dow = now.getUTCDay(); // 0=Sun
  const daysToMonday = (dow + 6) % 7;
  const monday = new Date(now.getTime() - daysToMonday * 864e5).toISOString().slice(0, 10);

  for (const row of rows) {
    const stateName = col(row, 'State', 'state');
    const weekRaw = col(
      row, 'Week', 'week_start', 'Week Start',
      'date_actual', 'date_actual: Week', 'date', 'Period', 'Day',
    );
    const visitsRaw = col(
      row, 'Weekly Demand', 'Visits', 'visits', 'projected_visits',
      'Forecasted Visits', 'Forecast', 'Count',
      'Active Members', 'Active Members Count', 'members', 'Sum',
    );

    if (!stateName) { errors.push(`Skipping row missing state: ${JSON.stringify(row)}`); continue; }

    const abbr = toAbbreviation(stateName);
    if (!abbr) { errors.push(`Unknown state: "${stateName}"`); continue; }

    const weekStart = toMonday(parseDate(weekRaw) ?? '') ?? monday;

    const visits = parseInt(visitsRaw.replace(/[^0-9.-]/g, ''), 10);
    if (isNaN(visits)) { errors.push(`Non-numeric visits: "${visitsRaw}" for ${stateName}`); continue; }

    records.push({
      state_abbreviation: abbr,
      week_start: weekStart,
      projected_visits: visits,
      imported_at: new Date().toISOString(),
      source: 'metabase_sync',
      synced_at: new Date().toISOString(),
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
    const providerName = col(
      row, 'Provider Full Name', 'Provider', 'provider', 'Provider Name', 'provider_full_name', 'Name', 'name',
    );
    const utilRaw = col(
      row,
      'Average of Utilization rate', 'Average of Utilization Rate',
      'Avg Time Slot Utilization', 'Average of Time Slot Utilization',
      'Utilization Rate', 'utilization', 'avg_utilization', 'Avg Utilization',
    );
    const slotsRaw = col(
      row,
      'Sum of Distinct values of Time Slot ID',
      'Total Timeslots', 'Sum of Total Timeslots',
      'total_timeslots', 'timeslots', 'Timeslots',
    );

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

async function handleProviderStateUtilization(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  const { data: providers } = await supabase
    .from('providers')
    .select('id, name')
    .range(0, 49999);
  const providerIdByCanonical = new Map<string, string>();
  for (const provider of (providers ?? []) as Array<{ id: string; name: string | null }>) {
    const key = canonicalName(provider.name);
    if (key && !providerIdByCanonical.has(key)) providerIdByCanonical.set(key, provider.id);
  }

  for (const row of rows) {
    const monthRaw = col(row, 'month_date', 'Month Date', 'Month', 'month', 'Report Month', 'report_month');
    const providerName = col(
      row,
      'provider_full_name',
      'Provider Full Name',
      'Provider',
      'provider',
      'Provider Name',
      'provider_name',
      'Name',
      'name',
    );
    const appointmentType = col(
      row,
      'covered_appointment_type',
      'Covered Appointment Type',
      'Appointment Type',
      'appointment_type',
    ) || 'unknown';
    const roleCategory = col(
      row,
      'provider_role_category',
      'Provider Role Category',
      'Role Category',
      'role_category',
      'Provider Role',
    ) || 'unknown';
    const stateRaw = col(row, 'state', 'State', 'State Abbreviation', 'state_abbreviation');
    const availableRaw = col(row, 'available_count', 'Available Count', 'Available', 'available', 'Total Timeslots', 'total_timeslots');
    const bookedRaw = col(row, 'booked_count', 'Booked Count', 'Booked', 'booked', 'Booked Timeslots', 'booked_timeslots');
    const rateRaw = col(row, 'booking_rate', 'Booking Rate', 'Utilization Rate', 'utilization', 'Utilization');

    const monthDate = parseDate(monthRaw);
    if (!monthDate) { errors.push(`Unparseable month_date: "${monthRaw}"`); continue; }
    if (!providerName) { errors.push(`Row missing provider name: ${JSON.stringify(row)}`); continue; }

    const state = (toAbbreviation(stateRaw) ?? stateRaw).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) { errors.push(`Unknown state: "${stateRaw}" for ${providerName}`); continue; }

    const available = intOrNull(availableRaw);
    const booked = intOrNull(bookedRaw);
    if (available === null) { errors.push(`Missing available_count for ${providerName} ${state}`); continue; }
    if (booked === null) { errors.push(`Missing booked_count for ${providerName} ${state}`); continue; }

    let bookingRate = parsePct(rateRaw);
    if (bookingRate === null && available > 0) {
      bookingRate = Math.round((booked / available) * 10000) / 100;
    }
    if (bookingRate === null) bookingRate = 0;

    records.push({
      month_date: monthDate,
      provider_id: providerIdByCanonical.get(canonicalName(providerName)) ?? null,
      provider_name: providerName,
      covered_appointment_type: appointmentType,
      provider_role_category: roleCategory,
      state,
      available_count: available,
      booked_count: booked,
      booking_rate_pct: bookingRate,
      imported_at: nowIso,
      source: 'metabase_sync',
      synced_at: nowIso,
      raw_payload: row,
      updated_at: nowIso,
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('provider_state_utilization')
    .upsert(records, {
      onConflict: 'provider_name,month_date,state,covered_appointment_type,provider_role_category',
    });
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

async function handleProviderUtilizationDaily(rows: Row[], supabase: SupabaseClient): Promise<ImportResult> {
  const records = [];
  const errors: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const providerName = col(
      row, 'Provider Full Name', 'Provider', 'provider', 'Provider Name', 'provider_full_name', 'Name', 'name',
    );
    const dateRaw = col(row, 'Date', 'date', 'Day', 'day', 'util_date', 'date_actual', 'date_actual: Day');
    const utilRaw = col(
      row, 'Utilization Rate', 'utilization', 'Utilization', 'booking_rate', 'Booking Rate', 'Avg Utilization',
      'Average of Utilization rate', 'Average of Utilization Rate', 'Avg Utilization Rate',
    );
    const bookedRaw = col(
      row, 'Booked Timeslots', 'booked_timeslots', 'Booked', 'booked', 'Appointments', 'Bookings',
    );
    const totalRaw = col(
      row, 'Total Timeslots', 'total_timeslots', 'Timeslots', 'timeslots', 'Available Timeslots',
      'Sum of Distinct values of Time Slot ID',
    );

    if (!providerName) { errors.push(`Row missing provider name: ${JSON.stringify(row)}`); continue; }

    // Prefer an explicit date; if absent (card shows "today"), default to today.
    const utilDate = parseDate(dateRaw) ?? today;

    const parsedBooked = bookedRaw ? parseInt(bookedRaw.replace(/[^0-9]/g, ''), 10) : NaN;
    const parsedTotal = totalRaw ? parseInt(totalRaw.replace(/[^0-9]/g, ''), 10) : NaN;
    const total = Number.isFinite(parsedTotal) ? parsedTotal : null;

    let utilizationPct = parsePct(utilRaw);
    let booked = Number.isFinite(parsedBooked) ? parsedBooked : null;
    if (utilizationPct === null && booked !== null && total && total > 0) {
      utilizationPct = Math.round((booked / total) * 10000) / 100;
    }
    if (utilizationPct === null) {
      errors.push(`Unparseable utilization for ${providerName} on ${utilDate}`);
      continue;
    }
    if (booked === null && total && total > 0) {
      booked = Math.round(total * (utilizationPct / 100));
    }

    records.push({
      date: utilDate,
      provider_name: providerName,
      util_date: utilDate,
      booked_timeslots: booked,
      total_timeslots: total,
      utilization_pct: utilizationPct,
      imported_at: nowIso,
      data_source: 'daily',
      source: 'metabase_sync',
      synced_at: nowIso,
    });
  }

  if (records.length === 0) return { inserted: 0, errors };

  const { error } = await supabase
    .from('provider_utilization_daily')
    .upsert(records, { onConflict: 'provider_name,util_date' });
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
    await storeRawExport(supabase, reportKey, rows, today);
    return { inserted: rows.length, errors: [] };
  };
}

async function storeRawExport(supabase: SupabaseClient, reportKey: string, rows: Row[], pulledDate: string) {
  const { error } = await supabase
    .from('metabase_raw_exports')
    .upsert(
      { report_key: reportKey, pulled_date: pulledDate, rows, row_count: rows.length, pulled_at: new Date().toISOString() },
      { onConflict: 'report_key,pulled_date' },
    );
  if (error) throw new Error(error.message);
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
