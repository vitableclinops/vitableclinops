// One-shot (re-runnable) backfill: for every provider profile with an email
// but no slack_user_id, look up their Slack user via users.lookupByEmail and
// store the ID. Safe to call repeatedly — it only touches rows missing the ID.
//
// Invoke:
//   curl -X POST https://<project>.supabase.co/functions/v1/backfill-slack-user-ids \
//        -H "Authorization: Bearer $SERVICE_ROLE_KEY"
//
// Optional body: { "dry_run": true } to see matches without writing.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
    if (!LOVABLE_API_KEY || !SLACK_API_KEY) throw new Error('Slack gateway creds missing');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const dryRun = body?.dry_run === true;

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .is('slack_user_id', null)
      .not('email', 'is', null);

    if (error) throw error;

    const matched: Array<{ id: string; email: string; slack_user_id: string }> = [];
    const unmatched: Array<{ id: string; email: string; reason: string }> = [];

    for (const p of profiles ?? []) {
      const email = (p.email ?? '').trim().toLowerCase();
      if (!email) continue;

      const res = await fetch(`${GATEWAY_URL}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': SLACK_API_KEY,
        },
      });
      const data = await res.json();
      if (data?.ok && data.user?.id) {
        matched.push({ id: p.id, email, slack_user_id: data.user.id });
      } else {
        unmatched.push({ id: p.id, email, reason: data?.error ?? 'unknown' });
      }
    }

    if (!dryRun && matched.length > 0) {
      for (const m of matched) {
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ slack_user_id: m.slack_user_id })
          .eq('id', m.id);
        if (updErr) console.warn('update failed for', m.id, updErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        scanned: (profiles ?? []).length,
        matched_count: matched.length,
        unmatched_count: unmatched.length,
        matched: matched.slice(0, 50),
        unmatched: unmatched.slice(0, 50),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
