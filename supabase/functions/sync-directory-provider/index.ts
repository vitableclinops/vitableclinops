/**
 * sync-directory-provider edge function
 *
 * Upserts a row into the ClinOps `providers` table whenever a provider is
 * added or updated in the main directory (profiles). Matches by email so a
 * subsequent edit re-uses the same provider row instead of creating
 * duplicates. Runs with the service role to bypass RLS on `providers`.
 *
 * Body:
 *   {
 *     email: string (required, lowercased internally)
 *     name: string  (required)
 *     profession?: string | null
 *     npi?: string | null
 *     employment_type?: string | null
 *     employment_status?: string | null
 *     source?: string                          // default 'directory'
 *     is_telemedicine?: boolean                // default true
 *     is_in_home?: boolean                     // default false
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Body = {
  email?: string;
  name?: string;
  profession?: string | null;
  npi?: string | null;
  employment_type?: string | null;
  employment_status?: string | null;
  source?: string;
  is_telemedicine?: boolean;
  is_in_home?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  if (!email || !name) {
    return json({ error: 'email and name are required' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('CLINOPS_SUPABASE_URL')!,
    Deno.env.get('CLINOPS_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Lookup by email first; update if found, else insert.
  const { data: existing, error: lookupErr } = await supabase
    .from('providers')
    .select('id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  if (lookupErr) return json({ error: lookupErr.message }, 500);

  const payload = {
    email,
    name,
    profession: body.profession ?? null,
    npi: body.npi ?? null,
    employment_type: body.employment_type ?? null,
    employment_status: body.employment_status ?? 'active',
    source: body.source ?? 'directory',
    is_telemedicine: body.is_telemedicine ?? true,
    is_in_home: body.is_in_home ?? false,
    active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { error } = await supabase.from('providers').update(payload).eq('id', existing.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, provider_id: existing.id, action: 'updated' });
  }

  const { data: inserted, error: insErr } = await supabase
    .from('providers')
    .insert(payload)
    .select('id')
    .single();
  if (insErr) return json({ error: insErr.message }, 500);
  return json({ ok: true, provider_id: inserted.id, action: 'inserted' });
});