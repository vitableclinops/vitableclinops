/**
 * set-monthly-demand-targets
 *
 * Writes the per-state telehealth demand targets for a month into the ClinOps
 * project (state_demand_targets). Two modes:
 *
 *   { month, rows: [{ state, hours }] }
 *     → exact per-state hours (what ClinOps enters from the forecast model)
 *
 *   { month, total_hours, shape_from_month }
 *     → distribute total_hours across states using another month's state mix
 *
 * daily_target_slots follows the canonical formula:
 *   monthly_visits_target / 20 * 1.5
 * and monthly_visits_target stores the same value as monthly_hours_target
 * (hours of provider availability; the "visits" column name is legacy).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m.slice(0, 10));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('CLINOPS_SUPABASE_URL');
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
    if (!url || !key) return json({ error: 'ClinOps credentials are not configured' }, 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient<any, 'public', any>(url, key);

    const body = await req.json().catch(() => null) as {
      month?: string;
      rows?: Array<{ state: string; hours: number | string }>;
      total_hours?: number;
      shape_from_month?: string;
      replace?: boolean;
      /** Also write daily demand_forecast rows for the month (what the allocator reads). */
      write_daily?: boolean;
      /** Build rows from the month's existing state_demand_targets. */
      daily_from_targets?: boolean;
    } | null;

    if (!body?.month || !/^\d{4}-\d{2}(-\d{2})?$/.test(body.month)) {
      return json({ error: 'month (YYYY-MM or YYYY-MM-01) is required' }, 400);
    }
    const month = monthIso(body.month);

    let rows: Array<{ state: string; hours: number }> = [];

    if (Array.isArray(body.rows) && body.rows.length > 0) {
      for (const row of body.rows) {
        const state = String(row.state ?? '').trim().toUpperCase();
        const hours = Number(row.hours);
        if (state.length !== 2 || !Number.isFinite(hours) || hours < 0) {
          return json({ error: `Invalid row: ${JSON.stringify(row)}` }, 400);
        }
        rows.push({ state, hours: round2(hours) });
      }
    } else if (Number.isFinite(body.total_hours) && body.shape_from_month) {
      const shapeMonth = monthIso(body.shape_from_month);
      const { data, error } = await supabase
        .from('state_demand_targets')
        .select('state, monthly_hours_target')
        .eq('month', shapeMonth);
      if (error) return json({ error: error.message }, 500);
      const shape = (data ?? []).map((r: { state: string; monthly_hours_target: number | string }) => ({
        state: r.state,
        hours: Number(r.monthly_hours_target) || 0,
      })).filter(r => r.hours > 0);
      const shapeTotal = shape.reduce((s, r) => s + r.hours, 0);
      if (shapeTotal <= 0) return json({ error: `No demand targets found for ${shapeMonth}` }, 400);
      const factor = Number(body.total_hours) / shapeTotal;
      rows = shape.map(r => ({ state: r.state, hours: round2(r.hours * factor) }));
    } else if (body.daily_from_targets) {
      const { data, error } = await supabase
        .from('state_demand_targets')
        .select('state, monthly_hours_target')
        .eq('month', month);
      if (error) return json({ error: error.message }, 500);
      rows = (data ?? [])
        .map((r: { state: string; monthly_hours_target: number | string }) => ({
          state: r.state,
          hours: Number(r.monthly_hours_target) || 0,
        }))
        .filter(r => r.hours > 0);
      if (rows.length === 0) return json({ error: `No demand targets found for ${month}` }, 400);
    } else {
      return json({ error: 'Provide rows[] or total_hours + shape_from_month' }, 400);
    }

    if (body.replace) {
      const { error } = await supabase.from('state_demand_targets').delete().eq('month', month);
      if (error) return json({ error: error.message }, 500);
    }

    const records = rows.map(r => ({
      state: r.state,
      month,
      monthly_hours_target: r.hours,
      monthly_visits_target: Math.round(r.hours),
      daily_target_slots: Math.round((r.hours / 20) * 1.5),
      computed_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('state_demand_targets')
      .upsert(records, { onConflict: 'state,month' });
    if (error) return json({ error: error.message }, 500);

    return json({
      ok: true,
      month,
      states: records.length,
      total_hours: round2(rows.reduce((s, r) => s + r.hours, 0)),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
