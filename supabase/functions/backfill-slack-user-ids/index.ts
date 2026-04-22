// One-shot utility: populates profiles.slack_user_id for active providers
// by calling Slack users.lookupByEmail via the Lovable connector gateway.
//
// Usage:
//   POST /backfill-slack-user-ids                  → live backfill
//   POST /backfill-slack-user-ids  { "dry_run": true }  → preview only

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    if (!SLACK_API_KEY) throw new Error('SLACK_API_KEY is not configured');

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }
    const isDryRun = body?.dry_run === true;
    const limit = typeof body?.limit === 'number' ? body.limit : 500;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Pull active providers without a slack_user_id and with an email
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .is('slack_user_id', null)
      .not('email', 'is', null)
      .neq('lifecycle_status', 'terminated')
      .limit(limit);

    if (profErr) throw profErr;

    const results: Array<{ profile_id: string; email: string; name: string; slack_user_id?: string; status: 'matched' | 'not_found' | 'error'; error?: string }> = [];
    let matched = 0;
    let notFound = 0;
    let errors = 0;

    for (const p of profiles ?? []) {
      if (!p.email) continue;
      try {
        const res = await fetch(
          `${GATEWAY_URL}/users.lookupByEmail?email=${encodeURIComponent(p.email)}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': SLACK_API_KEY,
            },
          },
        );
        const data = await res.json();
        if (data.ok && data.user?.id) {
          matched++;
          results.push({ profile_id: p.id, email: p.email, name: p.full_name ?? '', slack_user_id: data.user.id, status: 'matched' });
          if (!isDryRun) {
            await supabase.from('profiles').update({ slack_user_id: data.user.id }).eq('id', p.id);
          }
        } else if (data.error === 'users_not_found') {
          notFound++;
          results.push({ profile_id: p.id, email: p.email, name: p.full_name ?? '', status: 'not_found' });
        } else {
          errors++;
          results.push({ profile_id: p.id, email: p.email, name: p.full_name ?? '', status: 'error', error: data.error ?? 'unknown' });
        }
      } catch (e) {
        errors++;
        const msg = e instanceof Error ? e.message : 'unknown';
        results.push({ profile_id: p.id, email: p.email, name: p.full_name ?? '', status: 'error', error: msg });
      }
      // Slack rate limit: tier 3 = ~50 calls/min. Throttle gently.
      await new Promise((r) => setTimeout(r, 120));
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: isDryRun,
        scanned: profiles?.length ?? 0,
        matched,
        not_found: notFound,
        errors,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('backfill-slack-user-ids error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
