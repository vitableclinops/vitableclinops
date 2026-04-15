/**
 * import-demand-forecast edge function
 *
 * Accepts weekly demand projections per state from a Metabase CSV export.
 *
 * Body schema:
 * {
 *   rows: { state: string; week_start: string; visits: number | string }[];
 * }
 *
 * Upserts into demand_forecast on (state_abbreviation, week_start).
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
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: { rows: { state: string; week_start: string; visits: number | string }[] };
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
    if (!row.state || !row.week_start) {
      errors.push(`Skipping row missing state or week_start: ${JSON.stringify(row)}`);
      continue;
    }

    const abbr = toAbbreviation(row.state);
    if (!abbr) { errors.push(`Unknown state: "${row.state}"`); continue; }

    const weekStart = parseWeekStart(row.week_start);
    if (!weekStart) { errors.push(`Unparseable week_start: "${row.week_start}" for ${row.state}`); continue; }

    const visits = parseInt(String(row.visits ?? '0').replace(/[^0-9.-]/g, ''), 10);
    if (isNaN(visits)) { errors.push(`Non-numeric visits: "${row.visits}" for ${row.state}`); continue; }

    records.push({
      state_abbreviation: abbr,
      week_start: weekStart,
      projected_visits: visits,
      imported_at: new Date().toISOString(),
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    const { error } = await supabase
      .from('demand_forecast')
      .upsert(records, { onConflict: 'state_abbreviation,week_start' });
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

/** Parse various date/week formats to YYYY-MM-DD (Monday of the week). */
function parseWeekStart(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return toMonday(s);

  // M/D/YYYY or MM/DD/YYYY
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const iso = `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
    return toMonday(iso);
  }

  // Try native Date parse as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toMonday(d.toISOString().slice(0, 10));

  return null;
}

/** Round a date string to the Monday of its week. */
function toMonday(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDay();          // 0 = Sun, 1 = Mon …
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
