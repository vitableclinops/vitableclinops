/**
 * import-sla-attainment edge function
 *
 * Accepts rows from either SLA attainment CSV:
 *   same_day_and_next_day_feb2026-current.numbers  → window_label: 'feb2026_current'
 *   same-day_and_next-day_past_2_weeks.numbers      → window_label: 'past_2_weeks'
 *
 * Expected columns: State | SLA Attainment Rate
 * SLA value may be "94.3%" or 0.943 or 94.3 — all normalized to 0–100 float.
 *
 * Body schema:
 * {
 *   rows: { state: string; sla: string | number }[];
 *   window_label: 'feb2026_current' | 'past_2_weeks';
 *   window_start?: string;  // YYYY-MM-DD
 *   window_end?: string;    // YYYY-MM-DD
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
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let body: {
    rows: { state: string; sla: string | number }[];
    window_label: string;
    window_start?: string;
    window_end?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { rows, window_label, window_start, window_end } = body;
  if (!Array.isArray(rows) || !window_label) {
    return new Response(JSON.stringify({ error: 'rows[] and window_label required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const records: object[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const abbr = toAbbreviation(row.state);
    if (!abbr) { errors.push(`Unknown state: "${row.state}"`); continue; }

    const sla = parseSla(row.sla);
    if (sla === null) { errors.push(`Unparseable SLA: "${row.sla}" for ${row.state}`); continue; }

    records.push({
      state_abbreviation: abbr,
      window_label,
      window_start: window_start ?? null,
      window_end: window_end ?? null,
      sla_pct: sla,
      imported_at: new Date().toISOString(),
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    const { error } = await supabase
      .from('state_sla_attainment')
      .upsert(records, { onConflict: 'state_abbreviation,window_label' });
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

/**
 * Parse SLA value to a 0–100 float.
 * Accepts: "94.3%", "0.943", 94.3, 0.943
 */
function parseSla(raw: string | number): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim().replace('%', '');
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  // If value is between 0 and 1, treat as a fraction and convert to %
  return n <= 1 ? Math.round(n * 10000) / 100 : Math.round(n * 100) / 100;
}
