/**
 * compute-visit-cost edge function
 *
 * For each (state, day) in the window:
 *   total_cost   = sum( provider_hours[state,day] * hourly_rate )
 *   total_visits = booked_slots (supply_slots - leftover_unfilled)
 *   cost_per_visit = total_cost / total_visits
 *
 * Body: { window_days?: number } (default 30, max 90)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SLOTS_PER_HOUR = 2;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let windowDays = 30;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.window_days) windowDays = Math.min(90, Math.max(1, Number(body.window_days)));
  } catch { /* ignore */ }

  const startedAt = Date.now();
  const { data: runRow } = await supabase
    .from('sync_runs')
    .insert({ function_name: 'compute-visit-cost', status: 'running' })
    .select('id')
    .single();
  const runId: string | null = (runRow?.id as string) ?? null;
  const finalizeRun = async (
    status: 'success' | 'partial' | 'error',
    extras: { rows_processed?: number; error_message?: string; details?: unknown } = {},
  ) => {
    if (!runId) return;
    await supabase.from('sync_runs').update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      rows_processed: extras.rows_processed ?? 0,
      error_message: extras.error_message ?? null,
      details: extras.details ?? {},
    }).eq('id', runId);
  };

  try {
    const today = new Date();
    const past = new Date(today); past.setDate(past.getDate() - windowDays);
    const windowStart = past.toISOString().slice(0, 10);
    const windowEnd = today.toISOString().slice(0, 10);

    // Active states
    const { data: activeRows } = await supabase
      .from('state_activation').select('state_abbreviation').eq('is_active', true);
    const activeStates = new Set((activeRows ?? []).map((r: any) => r.state_abbreviation));

    // Cost rates (active = no effective_to or in future)
    const { data: rateRows } = await supabase
      .from('provider_cost_rates')
      .select('profile_id, hourly_rate, effective_from, effective_to');

    // Default rate when none on file (placeholder)
    const DEFAULT_RATE = 75;
    const rateFor = (profileId: string, date: string): number => {
      const matches = (rateRows ?? []).filter((r: any) =>
        r.profile_id === profileId &&
        r.effective_from <= date &&
        (!r.effective_to || r.effective_to >= date)
      );
      if (matches.length === 0) return DEFAULT_RATE;
      // pick most recent effective_from
      matches.sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from));
      return Number(matches[0].hourly_rate);
    };

    // Active licenses
    const { data: licenseRows } = await supabase
      .from('provider_licenses').select('profile_id, state_abbreviation, status')
      .not('profile_id', 'is', null).eq('status', 'active');
    const licenseMap = new Map<string, Set<string>>();
    for (const lic of (licenseRows ?? [])) {
      if (!licenseMap.has(lic.profile_id)) licenseMap.set(lic.profile_id, new Set());
      licenseMap.get(lic.profile_id)!.add(lic.state_abbreviation);
    }

    // Homebase shifts
    const { data: shiftRows } = await supabase
      .from('homebase_shifts')
      .select('scheduled_hours, start_at, homebase_employee:homebase_employees!homebase_shifts_homebase_employee_id_fkey(profile_id)')
      .gte('start_at', `${windowStart}T00:00:00Z`)
      .lte('start_at', `${windowEnd}T23:59:59Z`)
      .eq('scheduled', true)
      .not('scheduled_hours', 'is', null);

    // state|date -> { hours, cost }
    const aggregate = new Map<string, { hours: number; cost: number }>();
    for (const shift of (shiftRows ?? [])) {
      const profileId = (shift.homebase_employee as any)?.profile_id;
      if (!profileId) continue;
      const date = shift.start_at.slice(0, 10);
      const licenses = licenseMap.get(profileId);
      if (!licenses) continue;
      const eligible = [...licenses].filter(s => activeStates.has(s));
      if (eligible.length === 0) continue;
      const hours = Number(shift.scheduled_hours);
      const perState = hours / eligible.length;
      const rate = rateFor(profileId, date);
      const costPerState = perState * rate;
      for (const state of eligible) {
        const k = `${state}|${date}`;
        const ex = aggregate.get(k) ?? { hours: 0, cost: 0 };
        ex.hours += perState;
        ex.cost += costPerState;
        aggregate.set(k, ex);
      }
    }

    // Leftover slots → visits
    const { data: leftoverRows } = await supabase
      .from('state_leftover_slots')
      .select('state_abbreviation, slot_date, unfilled_slots')
      .eq('window_type', 'historical')
      .gte('slot_date', windowStart).lte('slot_date', windowEnd);
    const leftoverMap = new Map<string, number>();
    for (const r of (leftoverRows ?? [])) {
      leftoverMap.set(`${r.state_abbreviation}|${r.slot_date}`, Number(r.unfilled_slots));
    }

    const snapshots: any[] = [];
    for (const [key, agg] of aggregate) {
      const [state, date] = key.split('|');
      const supplySlots = Math.round(agg.hours * SLOTS_PER_HOUR);
      const unfilled = leftoverMap.get(key) ?? 0;
      const visits = Math.max(0, supplySlots - unfilled);
      const costPerVisit = visits > 0 ? agg.cost / visits : null;
      const costPerHour = agg.hours > 0 ? agg.cost / agg.hours : null;

      snapshots.push({
        snapshot_date: date,
        state_abbreviation: state,
        total_hours: Math.round(agg.hours * 100) / 100,
        total_cost: Math.round(agg.cost * 100) / 100,
        total_visits: visits,
        cost_per_visit: costPerVisit !== null ? Math.round(costPerVisit * 100) / 100 : null,
        cost_per_hour: costPerHour !== null ? Math.round(costPerHour * 100) / 100 : null,
      });
    }

    let written = 0;
    for (let i = 0; i < snapshots.length; i += 500) {
      const batch = snapshots.slice(i, i + 500);
      const { error } = await supabase
        .from('visit_cost_snapshots')
        .upsert(batch, { onConflict: 'snapshot_date,state_abbreviation' });
      if (error) throw new Error(error.message);
      written += batch.length;
    }

    await finalizeRun('success', {
      rows_processed: written,
      details: { rates_loaded: (rateRows ?? []).length, default_rate_used: DEFAULT_RATE },
    });
    return new Response(JSON.stringify({
      ok: true,
      window: { start: windowStart, end: windowEnd },
      snapshots_written: written,
      rates_loaded: (rateRows ?? []).length,
      default_rate_used: DEFAULT_RATE,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeRun('error', { error_message: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
