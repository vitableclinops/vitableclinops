/**
 * sync-homebase edge function
 *
 * Pulls all Homebase locations → employees → shifts and upserts into Supabase.
 * Matches Homebase employees to ClinOps providers via:
 *   1. Exact email match
 *   2. Exact canonical name match
 *   3. Manual override (provider_name_mappings table)
 *   4. Fuzzy name score ≥ 0.85
 *   5. Unmatched (recorded for review)
 *
 * Sync window: explicit start_date/end_date or month when provided;
 * otherwise a rolling 30-day window. Longer explicit windows are pulled in
 * 30-day chunks so dashboard/manual workflows can inspect arbitrary spans
 * without depending on one oversized Homebase API request.
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

const HOMEBASE_SHIFT_CHUNK_DAYS = 30;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const body = req.method === 'POST'
    ? await req.json().catch(() => ({} as Record<string, unknown>))
    : {};
  const syncWindow = resolveSyncWindow(url, body);

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

  // Open both run records up front: the legacy homebase-specific one for the
  // existing UI, and the generic sync_runs row used by the unified health widget.
  const startedAt = Date.now();
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

  const { data: genericRunRow } = await supabase
    .from('sync_runs')
    .insert({ function_name: 'sync-homebase', status: 'running' })
    .select('id')
    .single();
  const genericRunId: string | null = (genericRunRow?.id as string) ?? null;

  const finalizeGenericRun = async (
    status: 'success' | 'partial' | 'error',
    extras: { rows_processed?: number; rows_failed?: number; error_message?: string; details?: unknown } = {},
  ) => {
    if (!genericRunId) return;
    await supabase.from('sync_runs').update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      rows_processed: extras.rows_processed ?? 0,
      rows_failed: extras.rows_failed ?? 0,
      error_message: extras.error_message ?? null,
      details: extras.details ?? {},
    }).eq('id', genericRunId);
  };

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

    // ── Load ClinOps providers for matching ───────────────────────────────────
    // Source of truth is `profiles` (employment_status = 'active'). The legacy
    // `providers` table was removed; reading it here silently returned zero
    // rows and caused every Homebase employee to land as `unmatched`.
    const { data: providers } = await supabase
      .from('profiles')
      .select('id, email, full_name, employment_status')
      .eq('employment_status', 'active');

    const providersByEmail = new Map<string, string>(); // email → providers.id
    const providersByCanonical = new Map<string, string>(); // canonical_name → providers.id
    const providersForFuzzy: { id: string; canonical: string }[] = [];

    for (const p of (providers ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
      if (p.email) providersByEmail.set(p.email.toLowerCase(), p.id);
      const c = canonicalName(p.full_name);
      if (c) {
        providersByCanonical.set(c, p.id);
        providersForFuzzy.push({ id: p.id, canonical: c });
      }
    }

    // ── Load manual name overrides ────────────────────────────────────────────
    const { data: mappings } = await supabase
      .from('provider_name_mappings')
      .select('homebase_name, profile_id');

    const manualOverrides = new Map<string, string>(); // canonical(homebase_name) → providers.id
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

        let providerId: string | null = null;
        let confidence = 'unmatched';

        // 1. Email
        if (emp.email && providersByEmail.has(emp.email.toLowerCase())) {
          providerId = providersByEmail.get(emp.email.toLowerCase())!;
          confidence = 'email';
        }
        // 2. Manual override
        else if (manualOverrides.has(canonical)) {
          providerId = manualOverrides.get(canonical)!;
          confidence = 'manual';
        }
        // 3. Exact canonical name
        else if (providersByCanonical.has(canonical)) {
          providerId = providersByCanonical.get(canonical)!;
          confidence = 'name_exact';
        }
        // 4. Fuzzy score
        else {
          let best = 0;
          let bestId: string | null = null;
          for (const p of providersForFuzzy) {
            const score = fuzzyScore(canonical, p.canonical);
            if (score > best) { best = score; bestId = p.id; }
          }
          if (best >= FUZZY_MATCH_THRESHOLD && bestId) {
            providerId = bestId;
            confidence = 'name_fuzzy';
          }
        }

        if (providerId) {
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
          // Legacy column name; value is ClinOps providers.id.
          profile_id: providerId,
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

      for (const chunk of syncWindow.chunks) {
        for await (const shift of hb.iterateShifts(loc.uuid, chunk.startDate, chunk.endDate)) {
          const { error: shiftErr } = await supabase.from('homebase_shifts').upsert({
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
          if (shiftErr) {
            console.error('Shift upsert error:', shift.id, shiftErr.message);
          }
          counters.shifts_synced++;
        }
      }
    }

    // ── Finalize sync run ─────────────────────────────────────────────────────
    await supabase.from('homebase_sync_runs').update({
      finished_at: new Date().toISOString(),
      status: 'success',
      ...counters,
      unmatched_sample: unmatchedSample,
    }).eq('id', runId);

    // Surface unmatched ratio so the alerter can flag >10% unmatched
    const unmatchedRatio = counters.employees_synced > 0
      ? counters.employees_unmatched / counters.employees_synced
      : 0;
    const partial = unmatchedRatio > 0.10;
    await finalizeGenericRun(partial ? 'partial' : 'success', {
      rows_processed: counters.employees_synced + counters.shifts_synced + counters.locations_synced,
      details: { ...counters, sync_window: syncWindow, unmatched_ratio: Math.round(unmatchedRatio * 100) / 100 },
      error_message: partial ? `High unmatched ratio: ${(unmatchedRatio * 100).toFixed(1)}% (>10% threshold)` : undefined,
    });

    return new Response(JSON.stringify({ ok: true, runId, sync_window: syncWindow, ...counters }), {
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

    await finalizeGenericRun('error', { error_message: message, details: { ...counters, sync_window: syncWindow } });

    return new Response(JSON.stringify({ error: message, runId }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function resolveSyncWindow(url: URL, body: Record<string, unknown>) {
  const fromParam = (key: string) => {
    const fromUrl = url.searchParams.get(key);
    if (fromUrl) return fromUrl;
    const fromBody = body[key];
    return typeof fromBody === 'string' ? fromBody : null;
  };

  const explicitStart = fromParam('start_date') ?? fromParam('startDate');
  const explicitEnd = fromParam('end_date') ?? fromParam('endDate');
  if (isIsoDate(explicitStart) && isIsoDate(explicitEnd) && explicitStart <= explicitEnd) {
    return {
      startDate: explicitStart,
      endDate: explicitEnd,
      mode: 'explicit',
      chunks: buildDateChunks(explicitStart, explicitEnd),
    };
  }

  const month = fromParam('month') ?? fromParam('target_month') ?? fromParam('targetMonth');
  if (isMonthStart(month)) {
    const [year, monthNumber] = month.split('-').map(Number);
    const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
      startDate: `${year}-${String(monthNumber).padStart(2, '0')}-01`,
      endDate: `${year}-${String(monthNumber).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
      mode: 'month',
      chunks: buildDateChunks(
        `${year}-${String(monthNumber).padStart(2, '0')}-01`,
        `${year}-${String(monthNumber).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
      ),
    };
  }

  const now = new Date();
  const past = new Date(now);
  past.setUTCDate(past.getUTCDate() - 14);
  const future = new Date(now);
  future.setUTCDate(future.getUTCDate() + 15);
  const startDate = past.toISOString().slice(0, 10);
  const endDate = future.toISOString().slice(0, 10);
  return {
    startDate,
    endDate,
    mode: 'default_rolling_30_days',
    chunks: buildDateChunks(startDate, endDate),
  };
}

function buildDateChunks(startDate: string, endDate: string) {
  const chunks: Array<{ startDate: string; endDate: string }> = [];
  let cursor = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);

  while (cursor <= end) {
    const chunkStart = cursor;
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + HOMEBASE_SHIFT_CHUNK_DAYS - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    chunks.push({
      startDate: formatUtcDate(chunkStart),
      endDate: formatUtcDate(chunkEnd),
    });

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return chunks;
}

function parseUtcDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function isIsoDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isMonthStart(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-01$/.test(value));
}
