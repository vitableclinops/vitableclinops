/**
 * sync-homebase edge function
 *
 * Pulls all Homebase locations → employees → shifts and upserts into Supabase.
 * Matches Homebase employees to provider profiles via:
 *   1. Exact email match
 *   2. Exact canonical name match
 *   3. Manual override (provider_name_mappings table)
 *   4. Fuzzy name score ≥ 0.85
 *   5. Unmatched (recorded for review)
 *
 * Sync window: trailing 30 days + next 30 days.
 *
 * Scheduled hourly via Supabase cron.
 * Can also be triggered manually via POST /functions/v1/sync-homebase.
 *
 * Required secret: HOMEBASE_API_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { HomebaseClient } from '../_shared/homebaseClient.ts';
import { canonicalName, fuzzyScore, FUZZY_MATCH_THRESHOLD } from '../_shared/nameNormalization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const apiKey = Deno.env.get('HOMEBASE_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'HOMEBASE_API_KEY secret not set' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Insert a sync run record
  const { data: runRow, error: runErr } = await supabase
    .from('homebase_sync_runs')
    .insert({ status: 'running' })
    .select('id')
    .single();

  if (runErr || !runRow) {
    return new Response(JSON.stringify({ error: 'Failed to create sync run record' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const runId: string = runRow.id;

  const counters = {
    locations_synced: 0,
    employees_synced: 0,
    shifts_synced: 0,
    employees_matched: 0,
    employees_unmatched: 0,
  };
  const unmatchedSample: { homebase_id: number; name: string }[] = [];

  try {
    const hb = new HomebaseClient(apiKey);

    // ── Date window ───────────────────────────────────────────────────────────
    const now = new Date();
    const past = new Date(now); past.setDate(past.getDate() - 30);
    const future = new Date(now); future.setDate(future.getDate() + 30);
    const startDate = past.toISOString().slice(0, 10);
    const endDate = future.toISOString().slice(0, 10);

    // ── Load provider profiles for matching ───────────────────────────────────
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, first_name, last_name')
      .eq('employment_status', 'active');

    const profilesByEmail = new Map<string, string>(); // email → profile_id
    const profilesByCanonical = new Map<string, string>(); // canonical_name → profile_id
    const profilesForFuzzy: { id: string; canonical: string }[] = [];

    for (const p of (profiles ?? [])) {
      if (p.email) profilesByEmail.set(p.email.toLowerCase(), p.id);
      const full = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
      const c = canonicalName(full);
      if (c) {
        profilesByCanonical.set(c, p.id);
        profilesForFuzzy.push({ id: p.id, canonical: c });
      }
    }

    // ── Load manual name overrides ────────────────────────────────────────────
    const { data: mappings } = await supabase
      .from('provider_name_mappings')
      .select('homebase_name, profile_id');

    const manualOverrides = new Map<string, string>(); // canonical(homebase_name) → profile_id
    for (const m of (mappings ?? [])) {
      manualOverrides.set(canonicalName(m.homebase_name), m.profile_id);
    }

    // ── Sync locations ────────────────────────────────────────────────────────
    const locations = await hb.listLocations();
    for (const loc of locations) {
      await supabase.from('homebase_locations').upsert({
        homebase_uuid: loc.uuid,
        name: loc.name,
        address_1: loc.address_1,
        address_2: loc.address_2,
        city: loc.city,
        state: loc.state,
        zip: loc.zip,
        time_zone: loc.time_zone,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'homebase_uuid' });
      counters.locations_synced++;

      // ── Sync employees for this location ─────────────────────────────────
      for await (const emp of hb.iterateEmployees(loc.uuid)) {
        const rawName = `${emp.first_name} ${emp.last_name}`;
        const canonical = canonicalName(rawName);

        let profileId: string | null = null;
        let confidence = 'unmatched';

        // 1. Email
        if (emp.email && profilesByEmail.has(emp.email.toLowerCase())) {
          profileId = profilesByEmail.get(emp.email.toLowerCase())!;
          confidence = 'email';
        }
        // 2. Manual override
        else if (manualOverrides.has(canonical)) {
          profileId = manualOverrides.get(canonical)!;
          confidence = 'manual';
        }
        // 3. Exact canonical name
        else if (profilesByCanonical.has(canonical)) {
          profileId = profilesByCanonical.get(canonical)!;
          confidence = 'name_exact';
        }
        // 4. Fuzzy score
        else {
          let best = 0;
          let bestId: string | null = null;
          for (const p of profilesForFuzzy) {
            const score = fuzzyScore(canonical, p.canonical);
            if (score > best) { best = score; bestId = p.id; }
          }
          if (best >= FUZZY_MATCH_THRESHOLD && bestId) {
            profileId = bestId;
            confidence = 'name_fuzzy';
          }
        }

        if (profileId) {
          counters.employees_matched++;
        } else {
          counters.employees_unmatched++;
          if (unmatchedSample.length < 20) {
            unmatchedSample.push({ homebase_id: emp.id, name: rawName });
          }
        }

        await supabase.from('homebase_employees').upsert({
          homebase_id: emp.id,
          location_homebase_uuid: loc.uuid,
          email: emp.email || null,
          first_name: emp.first_name,
          last_name: emp.last_name,
          normalized_name: canonical,
          profile_id: profileId,
          match_confidence: confidence,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'homebase_id' });

        counters.employees_synced++;
      }

      // ── Sync shifts for this location ─────────────────────────────────────
      // Build a map of homebase_user_id → homebase_employee row id for FK
      const { data: empRows } = await supabase
        .from('homebase_employees')
        .select('id, homebase_id')
        .eq('location_homebase_uuid', loc.uuid);

      const empIdMap = new Map<number, string>(); // homebase_id → uuid
      for (const e of (empRows ?? [])) empIdMap.set(e.homebase_id, e.id);

      for await (const shift of hb.iterateShifts(loc.uuid, startDate, endDate)) {
        await supabase.from('homebase_shifts').upsert({
          homebase_id: shift.id,
          homebase_user_id: shift.user_id,
          homebase_employee_id: empIdMap.get(shift.user_id) ?? null,
          location_homebase_uuid: loc.uuid,
          role: shift.role || null,
          department: shift.department || null,
          start_at: shift.start_at,
          end_at: shift.end_at,
          scheduled_hours: shift.labor?.scheduled_hours ?? null,
          published: shift.published ?? false,
          scheduled: shift.scheduled ?? true,
          synced_at: new Date().toISOString(),
        }, { onConflict: 'homebase_id' });
        counters.shifts_synced++;
      }
    }

    // ── Finalize sync run ─────────────────────────────────────────────────────
    await supabase.from('homebase_sync_runs').update({
      finished_at: new Date().toISOString(),
      status: 'success',
      ...counters,
      unmatched_sample: unmatchedSample,
    }).eq('id', runId);

    return new Response(JSON.stringify({ ok: true, runId, ...counters }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from('homebase_sync_runs').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      error: message,
      ...counters,
      unmatched_sample: unmatchedSample,
    }).eq('id', runId);

    return new Response(JSON.stringify({ error: message, runId }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
