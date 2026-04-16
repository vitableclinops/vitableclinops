/**
 * import-sla-aggregate edge function
 *
 * Accepts the "Average of SLA Attainment Rate" Metabase report.
 * Stores one network-wide average SLA % per day.
 *
 * Body schema:
 * {
 *   rows: { date?: string; avg_sla?: string | number; [key: string]: any }[];
 *   report_date?: string;  // YYYY-MM-DD override; defaults to today
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
  if (!Array.isArray(rows) || rows.length === 0) {
    return respond({ error: 'rows[] required and must not be empty' }, 400);
  }

  const today = report_date ?? new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  const records: object[] = [];

  // The report may have multiple rows (one per date) or a single aggregate
  for (const row of rows) {
    const dateRaw = colVal(row, 'date', 'period', 'day', 'week') ?? today;
    const slaRaw  = colVal(row,
      'Average of SLA Attainment Rate',
      'average of sla attainment rate',
      'avg_sla', 'avg sla', 'sla', 'value', 'average'
    );

    const date = parseDate(dateRaw) ?? today;
    const sla  = parsePct(slaRaw ?? '');

    if (sla === null) {
      errors.push(`Unparseable SLA value: "${slaRaw}" on ${date}`);
      continue;
    }

    records.push({ report_date: date, avg_sla_pct: sla, imported_at: new Date().toISOString() });
  }

  // If no date-keyed rows found, treat the first numeric value as today's aggregate
  if (records.length === 0 && rows.length > 0) {
    const first = rows[0];
    const val = Object.values(first).find((v) => {
      const n = parsePct(String(v ?? ''));
      return n !== null && n > 0;
    });
    if (val !== undefined) {
      const sla = parsePct(String(val))!;
      records.push({ report_date: today, avg_sla_pct: sla, imported_at: new Date().toISOString() });
    } else {
      errors.push('No parseable SLA value found in any row');
    }
  }

  let inserted = 0;
  if (records.length > 0) {
    const { error } = await supabase
      .from('sla_attainment_aggregate')
      .upsert(records, { onConflict: 'report_date' });
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

function parsePct(raw: string): number | null {
  if (!raw) return null;
  const s = String(raw).trim().replace('%', '');
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return n <= 1 ? Math.round(n * 10000) / 100 : Math.round(n * 100) / 100;
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
