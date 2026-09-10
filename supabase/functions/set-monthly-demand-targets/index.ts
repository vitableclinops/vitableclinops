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
    // Runs either from the Lovable project (cross-project creds) or from
    // inside ClinOps itself (its own service role).
    const url = Deno.env.get('CLINOPS_SUPABASE_URL') ?? Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
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

    // The allocator reads daily demand_forecast rows (via v_monthly_demand),
    // not state_demand_targets. Spread each state's monthly hours across the
    // month: weekdays carry twice the weight of weekend days, matching the
    // shape produced by compute-demand-forecast.
    let dailyRows = 0;
    if (body.write_daily || body.daily_from_targets) {
      const [y, m] = month.split('-').map(Number);
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const days: Array<{ date: string; weight: number }> = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(Date.UTC(y, m - 1, d));
        const dow = dt.getUTCDay();
        days.push({
          date: `${month.slice(0, 8)}${String(d).padStart(2, '0')}`,
          weight: dow === 0 || dow === 6 ? 1 : 2,
        });
      }
      const weightTotal = days.reduce((s, d) => s + d.weight, 0);
      const runId = crypto.randomUUID();
      const computedAt = new Date().toISOString();
      const forecast = rows.flatMap(r =>
        days.map(d => ({
          date: d.date,
          state: r.state,
          projected_visits: Math.round(((r.hours * d.weight) / weightTotal) * 1e6) / 1e6,
          forecast_run_id: runId,
          is_baseline: true,
          computed_at: computedAt,
        })),
      );

      const monthEnd = `${month.slice(0, 8)}${String(daysInMonth).padStart(2, '0')}`;
      const del = await supabase
        .from('demand_forecast')
        .delete()
        .gte('date', month)
        .lte('date', monthEnd);
      if (del.error) return json({ error: del.error.message }, 500);

      for (let i = 0; i < forecast.length; i += 500) {
        const chunk = forecast.slice(i, i + 500);
        const ins = await supabase
          .from('demand_forecast')
          .insert(chunk);
        if (ins.error) return json({ error: ins.error.message }, 500);
        dailyRows += chunk.length;
      }
    }

    return json({
      ok: true,
      month,
      states: records.length,
      total_hours: round2(rows.reduce((s, r) => s + r.hours, 0)),
      daily_forecast_rows: dailyRows,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
