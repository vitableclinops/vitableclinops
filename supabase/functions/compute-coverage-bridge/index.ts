/**
 * compute-coverage-bridge edge function
 *
 * Joins SUPPLY (Homebase scheduled hours, allocated by license) with
 * DEMAND (forecast slots + leftover-derived booked slots) per state per day,
 * and writes coverage_bridge_snapshots.
 *
 * Status:
 *   DEFICIT  – coverage_ratio < 1.0
 *   BALANCED – 1.0 ≤ ratio < 1.3
 *   SURPLUS  – ratio ≥ 1.3
 *
 * Body: { window_days?: number } (default 14, max 60)
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

  let windowDays = 14;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.window_days) windowDays = Math.min(60, Math.max(1, Number(body.window_days)));
  } catch { /* ignore */ }

  try {
    const today = new Date();
    const past = new Date(today); past.setDate(past.getDate() - windowDays);
    const future = new Date(today); future.setDate(future.getDate() + windowDays);
    const windowStart = past.toISOString().slice(0, 10);
    const windowEnd = future.toISOString().slice(0, 10);

    // Active states
    const { data: activeRows } = await supabase
      .from('state_activation').select('state_abbreviation').eq('is_active', true);
    const activeStates = new Set((activeRows ?? []).map((r: any) => r.state_abbreviation));

    // Licenses
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

    // Aggregate supply: state|date -> hours
    const supplyMap = new Map<string, number>();
    for (const shift of (shiftRows ?? [])) {
      const profileId = (shift.homebase_employee as any)?.profile_id;
      if (!profileId) continue;
      const date = shift.start_at.slice(0, 10);
      const licenses = licenseMap.get(profileId);
      if (!licenses) continue;
      const eligible = [...licenses].filter(s => activeStates.has(s));
      if (eligible.length === 0) continue;
      const perState = Number(shift.scheduled_hours) / eligible.length;
      for (const state of eligible) {
        const k = `${state}|${date}`;
        supplyMap.set(k, (supplyMap.get(k) ?? 0) + perState);
      }
    }

    // Demand: leftover slots (historical) + forecast hours
    const { data: leftoverRows } = await supabase
      .from('state_leftover_slots')
      .select('state_abbreviation, slot_date, unfilled_slots, window_type')
      .gte('slot_date', windowStart).lte('slot_date', windowEnd);

    const leftoverMap = new Map<string, { unfilled: number; type: string }>();
    for (const r of (leftoverRows ?? [])) {
      leftoverMap.set(`${r.state_abbreviation}|${r.slot_date}`, {
        unfilled: Number(r.unfilled_slots),
        type: r.window_type,
      });
    }

    // SLA
    const { data: slaRows } = await supabase
      .from('state_sla_attainment').select('state_abbreviation, sla_pct, window_label');
    const slaByState = new Map<string, number>();
    for (const r of (slaRows ?? [])) {
      const ex = slaByState.get(r.state_abbreviation);
      if (!ex || r.window_label === 'past_2_weeks') {
        slaByState.set(r.state_abbreviation, Number(r.sla_pct));
      }
    }

    // Build snapshots
    const snapshots: any[] = [];
    const allKeys = new Set<string>([...supplyMap.keys(), ...leftoverMap.keys()]);
    for (const key of allKeys) {
      const [state, date] = key.split('|');
      if (!activeStates.has(state)) continue;
      const supplyHours = supplyMap.get(key) ?? 0;
      const supplySlots = Math.round(supplyHours * SLOTS_PER_HOUR);
      const leftover = leftoverMap.get(key);
      const sla = slaByState.get(state) ?? null;

      let demandSlots = 0;
      let confidence: 'low' | 'medium' | 'high' = 'low';
      let notes = '';

      if (leftover && sla && sla > 0) {
        const booked = Math.max(0, supplySlots - leftover.unfilled);
        demandSlots = Math.round(booked / (sla / 100));
        confidence = leftover.type === 'historical' ? 'high' : 'medium';
        notes = `from ${leftover.type} slots + ${sla}% SLA`;
      } else if (leftover) {
        const booked = Math.max(0, supplySlots - leftover.unfilled);
        demandSlots = booked;
        confidence = 'medium';
        notes = `from ${leftover.type} slots (no SLA)`;
      } else {
        demandSlots = supplySlots;
        confidence = 'low';
        notes = 'fallback: assumed demand = supply';
      }

      const demandHours = demandSlots / SLOTS_PER_HOUR;
      const gapSlots = supplySlots - demandSlots;
      const ratio = demandHours > 0 ? supplyHours / demandHours : null;
      let status = 'BALANCED';
      if (ratio !== null) {
        if (ratio < 1.0) status = 'DEFICIT';
        else if (ratio >= 1.3) status = 'SURPLUS';
      }

      snapshots.push({
        snapshot_date: date,
        state_abbreviation: state,
        supply_hours: Math.round(supplyHours * 100) / 100,
        supply_slots: supplySlots,
        demand_slots: demandSlots,
        demand_hours: Math.round(demandHours * 100) / 100,
        gap_slots: gapSlots,
        coverage_ratio: ratio !== null ? Math.round(ratio * 1000) / 1000 : null,
        status,
        confidence,
        source_notes: notes,
      });
    }

    let written = 0;
    for (let i = 0; i < snapshots.length; i += 500) {
      const batch = snapshots.slice(i, i + 500);
      const { error } = await supabase
        .from('coverage_bridge_snapshots')
        .upsert(batch, { onConflict: 'snapshot_date,state_abbreviation' });
      if (error) throw new Error(error.message);
      written += batch.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      window: { start: windowStart, end: windowEnd },
      snapshots_written: written,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
