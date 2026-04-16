/**
 * import-telemedicine-availability edge function
 *
 * Accepts the "rpt_telemedicine_availability_by_state_per_day" Metabase report.
 * Upserts per-state per-day telemedicine availability into telemedicine_availability.
 *
 * Body schema:
 * {
 *   rows: { state: string; date: string; value: string | number }[];
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: { rows: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return respond({ error: 'Invalid JSON body' }, 400);
  }

  const { rows } = body;
  if (!Array.isArray(rows)) return respond({ error: 'rows[] required' }, 400);

  const records: object[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const stateName = colVal(row, 'State', 'state', 'state_name');
    const dateRaw   = colVal(row, 'Date', 'date', 'day', 'report_date', 'date_actual', 'date_actual: Day');
    const valueRaw  = colVal(row,
      'Availability', 'availability', 'availability_pct',
      'Available', 'available', 'Count', 'count',
      'Telemedicine Availability', 'telemedicine_availability',
    );

    if (!stateName) { errors.push(`Row missing state: ${JSON.stringify(row)}`); continue; }

    const abbr = toAbbreviation(stateName);
    if (!abbr) { errors.push(`Unknown state: "${stateName}"`); continue; }

    const date = parseDate(dateRaw ?? '');
    if (!date) { errors.push(`Unparseable date: "${dateRaw}" for ${stateName}`); continue; }

    // Value may be a percentage or a count — detect by magnitude
    const numRaw = parseFloat(String(valueRaw ?? '').replace('%', '').trim());
    const isPercent = String(valueRaw ?? '').includes('%') || (!isNaN(numRaw) && numRaw <= 1);
    const availability_pct = !isNaN(numRaw) && (isPercent || numRaw <= 100)
      ? (numRaw <= 1 ? Math.round(numRaw * 10000) / 100 : Math.round(numRaw * 100) / 100)
      : null;
    const available_count = !isNaN(numRaw) && numRaw > 100
      ? Math.round(numRaw)
      : null;

    records.push({
      state_abbreviation: abbr,
      report_date: date,
      availability_pct,
      available_count,
      imported_at: new Date().toISOString(),
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    const { error } = await supabase
      .from('telemedicine_availability')
      .upsert(records, { onConflict: 'state_abbreviation,report_date' });
    if (error) return respond({ error: error.message }, 500);
    inserted = records.length;
  }

  return respond({ ok: true, inserted, errors });
});

function colVal(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const match = Object.keys(row).find((r) => r.trim().toLowerCase() === k.toLowerCase());
    if (match !== undefined) return String(row[match] ?? '').trim();
  }
  return null;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) return `${slash[3]}-${slash[1].padStart(2,'0')}-${slash[2].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
