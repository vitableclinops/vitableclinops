import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const url = Deno.env.get('CLINOPS_SUPABASE_URL')!;
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY')!;
    const sb = createClient(url, key);
    if (body.lookup_provider) {
      const { data, error } = await sb.from('providers').select('id, name, email').ilike('name', `%${body.lookup_provider}%`);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, providers: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data, error } = await sb
      .from('schedule_submissions')
      .upsert(body, { onConflict: 'jotform_submission_id' })
      .select();
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : JSON.stringify(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
