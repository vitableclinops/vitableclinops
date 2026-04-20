/**
 * import-provider-utilization edge function
 *
 * Accepts rows from provider_utilization_last_14_days.numbers
 * Columns: Provider | Total Timeslots | Avg Time Slot Utilization
 *
 * Each timeslot = 30 min (20 min visit + 10 min charting), so 2 slots/hour.
 * Matches provider name to profiles table via canonicalName + fuzzy scoring.
 *
 * Body schema:
 * {
 *   rows: { provider: string; total_timeslots: number; avg_utilization: string | number }[];
 *   window_start: string;  // YYYY-MM-DD
 *   window_end: string;    // YYYY-MM-DD
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { canonicalName, fuzzyScore, FUZZY_MATCH_THRESHOLD } from '../_shared/nameNormalization.ts';

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
    rows: { provider: string; total_timeslots: number; avg_utilization: string | number }[];
    window_start: string;
    window_end: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { rows, window_start, window_end } = body;
  if (!Array.isArray(rows) || !window_start || !window_end) {
    return new Response(JSON.stringify({ error: 'rows[], window_start, and window_end required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Load profiles for matching
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, first_name, last_name, email')
    .eq('employment_status', 'active');

  const profilesForMatch: { id: string; canonical: string }[] = [];
  for (const p of (profiles ?? [])) {
    const full = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    const c = canonicalName(full);
    if (c) profilesForMatch.push({ id: p.id, canonical: c });
  }

  const records: object[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.provider) { errors.push('Row missing provider name'); continue; }

    const totalSlots = Number(row.total_timeslots);
    if (isNaN(totalSlots)) { errors.push(`Non-numeric timeslots for: "${row.provider}"`); continue; }

    const utilStr = String(row.avg_utilization).replace('%', '');
    const utilPct = parseFloat(utilStr);
    if (isNaN(utilPct)) { errors.push(`Non-numeric utilization for: "${row.provider}"`); continue; }
    // Normalize to percentage if given as decimal
    const normalizedPct = utilPct <= 1 ? utilPct * 100 : utilPct;

    // Match to profile
    const canonical = canonicalName(row.provider);
    let profileId: string | null = null;
    let confidence = 'unmatched';

    // Exact canonical match first
    const exactMatch = profilesForMatch.find(p => p.canonical === canonical);
    if (exactMatch) {
      profileId = exactMatch.id;
      confidence = 'name_exact';
    } else {
      // Fuzzy
      let best = 0, bestId: string | null = null;
      for (const p of profilesForMatch) {
        const score = fuzzyScore(canonical, p.canonical);
        if (score > best) { best = score; bestId = p.id; }
      }
      if (best >= FUZZY_MATCH_THRESHOLD && bestId) {
        profileId = bestId;
        confidence = 'name_fuzzy';
      }
    }

    const nowIso = new Date().toISOString();
    records.push({
      provider_name: row.provider,
      profile_id: profileId,
      match_confidence: confidence,
      window_start,
      window_end,
      total_timeslots: Math.round(totalSlots),
      avg_utilization_pct: Math.round(normalizedPct * 100) / 100,
      imported_at: nowIso,
      source: 'csv_manual',
      synced_at: nowIso,
    });
  }

  let inserted = 0;
  if (records.length > 0) {
    const { error } = await supabase.from('provider_utilization').insert(records);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    inserted = records.length;
  }

  const unmatched = records.filter((r: any) => r.match_confidence === 'unmatched').length;

  return new Response(JSON.stringify({ ok: true, inserted, unmatched, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
