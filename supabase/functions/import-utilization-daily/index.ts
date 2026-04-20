/**
 * import-utilization-daily edge function
 *
 * Accepts rows from utilization_rate_past_2_months.numbers
 * Columns: Period | %
 *
 * Body schema:
 * { rows: { date: string; pct: string | number }[] }
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
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: { rows: { date: string; pct: string | number }[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { rows } = body;
  if (!Array.isArray(rows)) {
    return new Response(JSON.stringify({ error: 'rows[] required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const records: object[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const dateStr = parseDate(row.date);
    if (!dateStr) { errors.push(`Unparseable date: "${row.date}"`); continue; }

    const pctStr = String(row.pct).replace('%', '').trim();
    const pct = parseFloat(pctStr);
    if (isNaN(pct)) { errors.push(`Non-numeric %: "${row.pct}" for ${row.date}`); continue; }
    const normalizedPct = pct <= 1 ? pct * 100 : pct;

    records.push({
      util_date: dateStr,
      overall_pct: Math.round(normalizedPct * 100) / 100,
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    const { error } = await supabase
      .from('utilization_daily')
      .upsert(records, { onConflict: 'util_date' });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    inserted = records.length;
  }

  return new Response(JSON.stringify({ ok: true, inserted, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

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
