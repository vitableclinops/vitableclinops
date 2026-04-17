/**
 * import-provider-appointments edge function
 *
 * Accepts the "Provider Appointment Count" Metabase report.
 * Upserts appointment counts per provider per day.
 *
 * Body schema:
 * {
 *   rows: { provider: string; count: number | string; date?: string }[];
 *   report_date?: string;  // YYYY-MM-DD; defaults to today
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  let body: { rows: Record<string, unknown>[]; report_date?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: 'Invalid JSON body' }, 400);
  }

  const { rows, report_date } = body;
  if (!Array.isArray(rows)) return respond({ error: 'rows[] required' }, 400);

  const today = report_date ?? new Date().toISOString().slice(0, 10);
  const records: object[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const providerRaw = colVal(row, 'Provider', 'provider', 'Provider Name', 'provider_name', 'name');
    const countRaw    = colVal(row,
      'Provider Appointment Count',
      'appointment_count', 'Appointment Count',
      'Count', 'count', 'appointments', 'Appointments',
      'Total', 'total',
    );
    const dateRaw     = colVal(row, 'Date', 'date', 'day', 'report_date');

    if (!providerRaw) { errors.push(`Row missing provider: ${JSON.stringify(row)}`); continue; }

    const date = (dateRaw ? parseDate(dateRaw) : null) ?? today;
    const count = parseInt(String(countRaw ?? '0').replace(/[^0-9]/g, ''), 10);

    if (isNaN(count)) { errors.push(`Non-numeric count for "${providerRaw}": "${countRaw}"`); continue; }

    records.push({
      provider_name_raw: providerRaw,
      report_date: date,
      appointment_count: count,
      imported_at: new Date().toISOString(),
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    // Deduplicate: aggregate counts per (provider_name_raw, report_date)
    const dedupMap = new Map<string, any>();
    for (const r of records as any[]) {
      const key = `${r.provider_name_raw}|${r.report_date}`;
      const existing = dedupMap.get(key);
      if (existing) {
        existing.appointment_count += r.appointment_count;
      } else {
        dedupMap.set(key, { ...r });
      }
    }
    const deduped = Array.from(dedupMap.values());

    const { error } = await supabase
      .from('provider_appointment_count')
      .upsert(deduped, { onConflict: 'provider_name_raw,report_date' });
    if (error) return respond({ error: error.message }, 500);
    inserted = deduped.length;
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
