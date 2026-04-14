/**
 * import-leftover-slots edge function
 *
 * Accepts a JSON body with CSV rows from either:
 *   Leftover_Visits__past_14_days_.numbers
 *   future_same-day_and_next_day_available_states.numbers
 *
 * Expected columns:
 *   state          – state name or 2-letter abbreviation
 *   date_actual    – "Day" column (YYYY-MM-DD or human-readable)
 *   slots          – "Sum of same_next_day_available_slots"
 *   window_type    – 'historical' | 'forecast' (caller provides this)
 *
 * Body schema:
 * {
 *   rows: { state: string; date: string; slots: number }[];
 *   window_type: 'historical' | 'forecast';
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

  let body: { rows: { state: string; date: string; slots: number }[]; window_type: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { rows, window_type } = body;
  if (!Array.isArray(rows) || !window_type) {
    return new Response(JSON.stringify({ error: 'rows[] and window_type required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const records: object[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    const abbr = toAbbreviation(row.state);
    if (!abbr) { errors.push(`Unknown state: "${row.state}"`); continue; }

    const dateStr = parseDate(row.date);
    if (!dateStr) { errors.push(`Unparseable date: "${row.date}" for ${row.state}`); continue; }

    const slots = Number(row.slots);
    if (isNaN(slots)) { errors.push(`Non-numeric slots: "${row.slots}" for ${row.state}`); continue; }

    records.push({
      state_abbreviation: abbr,
      slot_date: dateStr,
      unfilled_slots: Math.round(slots),
      window_type,
      imported_at: new Date().toISOString(),
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    const { error } = await supabase
      .from('state_leftover_slots')
      .upsert(records, { onConflict: 'state_abbreviation,slot_date,window_type' });
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

/** Parse various date formats to YYYY-MM-DD. */
function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // M/D/YYYY or MM/DD/YYYY
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const m = slash[1].padStart(2, '0');
    const d = slash[2].padStart(2, '0');
    return `${slash[3]}-${m}-${d}`;
  }
  // Try native Date parse as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
