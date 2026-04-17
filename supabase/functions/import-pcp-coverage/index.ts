/**
 * import-pcp-coverage edge function
 *
 * Accepts the "PCP State Coverage" Metabase report.
 * Upserts PCP count and coverage % per state per day.
 *
 * Body schema:
 * {
 *   rows: { state: string; pcp_count?: number | string; coverage_pct?: string | number }[];
 *   report_date?: string;  // YYYY-MM-DD; defaults to today
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
    const stateName = colVal(row, 'State', 'state', 'state_name');
    const countRaw  = colVal(row, 'PCP Count', 'pcp_count', 'count', 'Count', 'PCPs', 'providers');
    const pctRaw    = colVal(row, 'Coverage %', 'coverage_pct', 'coverage', 'Coverage', 'pct', '%');

    if (!stateName) { errors.push(`Row missing state: ${JSON.stringify(row)}`); continue; }

    const abbr = toAbbreviation(stateName);
    if (!abbr) { errors.push(`Unknown state: "${stateName}"`); continue; }

    const pcp_count = countRaw !== null
      ? parseInt(String(countRaw).replace(/[^0-9]/g, ''), 10)
      : null;

    const coverage_pct = pctRaw !== null ? parsePct(pctRaw) : null;

    records.push({
      state_abbreviation: abbr,
      report_date: today,
      pcp_count: pcp_count !== null && !isNaN(pcp_count) ? pcp_count : null,
      coverage_pct,
      imported_at: new Date().toISOString(),
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    // Deduplicate: keep last occurrence per (state_abbreviation, report_date)
    const dedupMap = new Map<string, object>();
    for (const r of records) {
      const key = `${(r as any).state_abbreviation}|${(r as any).report_date}`;
      dedupMap.set(key, r);
    }
    const deduped = Array.from(dedupMap.values());

    const { error } = await supabase
      .from('pcp_state_coverage')
      .upsert(deduped, { onConflict: 'state_abbreviation,report_date' });
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

function parsePct(raw: string): number | null {
  const s = String(raw).trim().replace('%', '');
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return n <= 1 ? Math.round(n * 10000) / 100 : Math.round(n * 100) / 100;
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
