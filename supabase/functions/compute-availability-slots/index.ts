/**
 * compute-availability-slots edge function
 *
 * Derives projected appointment slot availability directly from Homebase
 * scheduled shifts — no manual CSV export required.
 *
 * Logic (mirrors compute-license-utilization supply allocation):
 *   1. Load active provider licenses per profile.
 *   2. Load Homebase shifts for the date window (scheduled=true, hours not null).
 *   3. Match each shift → profile_id via homebase_employees.
 *   4. For each provider on each day, intersect their active licenses with active
 *      states → even-split shift hours across those states.
 *   5. Convert hours → slots (SLOTS_PER_HOUR = 2, i.e. 30-min visits).
 *   6. Upsert into state_leftover_slots with window_type='forecast'.
 *      Historical rows (from Metabase CSV) are NEVER overwritten.
 *
 * This populates same-day and next-day availability without requiring daily
 * manual exports, and feeds the license optimizer's forward-looking analysis.
 *
 * Body: { days_back?: number; days_ahead?: number }
 *   days_back   defaults to 7  (backfill past days missing historical data)
 *   days_ahead  defaults to 14 (covers same-day + next-day + 2-week horizon)
 *
 * Runs nightly via cron (after sync-homebase, before compute-license-utilization).
 * Also callable on-demand via POST /functions/v1/compute-availability-slots.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SLOTS_PER_HOUR = 2; // 30-min appointment slots (20 min visit + 10 min charting)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let daysBack = 7;
  let daysAhead = 14;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.days_back  != null) daysBack  = Math.min(30, Math.max(0, Number(body.days_back)));
    if (body.days_ahead != null) daysAhead = Math.min(30, Math.max(1, Number(body.days_ahead)));
  } catch { /* ignore */ }

  try {
    const today = new Date();
    const pastDate   = new Date(today); pastDate.setDate(today.getDate() - daysBack);
    const futureDate = new Date(today); futureDate.setDate(today.getDate() + daysAhead);
    const windowStart = pastDate.toISOString().slice(0, 10);
    const windowEnd   = futureDate.toISOString().slice(0, 10);

    // ── 1. Load active states ─────────────────────────────────────────────────
    const { data: activeStateRows } = await supabase
      .from('state_activation')
      .select('state_abbreviation')
      .eq('is_active', true);
    const activeStates = new Set((activeStateRows ?? []).map((r: any) => r.state_abbreviation as string));

    if (activeStates.size === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No active states configured', rows_written: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Load existing historical slot dates (to avoid overwriting them) ────
    const { data: historicalRows } = await supabase
      .from('state_leftover_slots')
      .select('state_abbreviation, slot_date')
      .eq('window_type', 'historical')
      .gte('slot_date', windowStart)
      .lte('slot_date', windowEnd);

    // Set of "state|date" keys that already have real historical data
    const historicalKeys = new Set<string>(
      (historicalRows ?? []).map((r: any) => `${r.state_abbreviation}|${r.slot_date}`)
    );

    // ── 3. Load provider active licenses ─────────────────────────────────────
    const { data: licenseRows } = await supabase
      .from('provider_licenses')
      .select('profile_id, state_abbreviation')
      .eq('status', 'active')
      .not('profile_id', 'is', null);

    // profileId → Set<state> of active licensed states
    const licenseMap = new Map<string, Set<string>>();
    for (const lic of (licenseRows ?? [])) {
      if (!licenseMap.has(lic.profile_id)) licenseMap.set(lic.profile_id, new Set());
      licenseMap.get(lic.profile_id)!.add(lic.state_abbreviation);
    }

    // ── 4. Load Homebase shifts in window ─────────────────────────────────────
    // Include both published and unpublished scheduled shifts for capacity planning.
    const { data: shiftRows } = await supabase
      .from('homebase_shifts')
      .select(`
        scheduled_hours,
        start_at,
        homebase_employee:homebase_employees!homebase_shifts_homebase_employee_id_fkey(profile_id)
      `)
      .gte('start_at', `${windowStart}T00:00:00Z`)
      .lte('start_at', `${windowEnd}T23:59:59Z`)
      .eq('scheduled', true)
      .not('scheduled_hours', 'is', null);

    // ── 5. Aggregate shift hours: "profileId|date" → total hours ──────────────
    const hoursMap = new Map<string, number>();
    let shiftsProcessed = 0;
    let shiftsUnmatched = 0;

    for (const shift of (shiftRows ?? [])) {
      const profileId = (shift.homebase_employee as any)?.profile_id;
      if (!profileId) { shiftsUnmatched++; continue; }

      const date = (shift.start_at as string).slice(0, 10);
      const key  = `${profileId}|${date}`;
      hoursMap.set(key, (hoursMap.get(key) ?? 0) + Number(shift.scheduled_hours));
      shiftsProcessed++;
    }

    // ── 6. Even-split hours across licensed+active states → slots per state/day
    // stateDate → total available slots
    const slotsMap = new Map<string, number>();

    for (const [key, hours] of hoursMap) {
      const [profileId, date] = key.split('|');
      const licenses = licenseMap.get(profileId);
      if (!licenses) continue;

      // States where provider is both actively licensed AND operationally active
      const eligible = [...licenses].filter(s => activeStates.has(s));
      if (eligible.length === 0) continue;

      const hoursPerState = hours / eligible.length;
      const slotsPerState = hoursPerState * SLOTS_PER_HOUR;

      for (const state of eligible) {
        const sk = `${state}|${date}`;
        slotsMap.set(sk, (slotsMap.get(sk) ?? 0) + slotsPerState);
      }
    }

    // ── 7. Build upsert records, skipping state/dates with historical data ─────
    const records: object[] = [];
    const skippedHistorical: number[] = [];

    for (const [key, slots] of slotsMap) {
      const [state, date] = key.split('|');

      // Never overwrite Metabase-imported historical data
      if (historicalKeys.has(`${state}|${date}`)) {
        skippedHistorical.push(1);
        continue;
      }

      records.push({
        state_abbreviation: state,
        slot_date:          date,
        unfilled_slots:     Math.round(slots),
        window_type:        'forecast',
        imported_at:        new Date().toISOString(),
      });
    }

    // ── 8. Upsert in batches of 500 ───────────────────────────────────────────
    let rowsWritten = 0;
    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500);
      const { error } = await supabase
        .from('state_leftover_slots')
        .upsert(batch, { onConflict: 'state_abbreviation,slot_date,window_type' });
      if (error) throw new Error(`Slot upsert error: ${error.message}`);
      rowsWritten += batch.length;
    }

    return new Response(JSON.stringify({
      ok:                  true,
      window:              { start: windowStart, end: windowEnd },
      shifts_processed:    shiftsProcessed,
      shifts_unmatched:    shiftsUnmatched,
      active_states:       activeStates.size,
      rows_written:        rowsWritten,
      rows_skipped_historical: skippedHistorical.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
