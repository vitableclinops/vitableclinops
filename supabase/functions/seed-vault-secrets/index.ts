/**
 * seed-vault-secrets edge function
 *
 * One-shot helper that copies env-injected secrets (SUPABASE_SERVICE_ROLE_KEY)
 * into Postgres vault entries that pg_cron jobs can read at execution time.
 *
 * Idempotent: safe to call repeatedly; updates the vault entry if the value changed.
 *
 * No auth required — the function only reads its own env and writes to vault via a
 * SECURITY DEFINER helper. It does not accept any user-supplied secret material.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await supabase.rpc('upsert_vault_secret', {
    p_name: 'service_role_key',
    p_value: serviceRoleKey,
    p_description: 'Service role JWT for pg_cron-scheduled edge function calls',
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, seeded: ['service_role_key'] }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});