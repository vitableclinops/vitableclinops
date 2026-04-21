import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COOLDOWN_DAYS = 7;

interface OutreachRequest {
  state: string;
  profile_ids?: string[]; // optional: if omitted, uses all candidates from recs engine
  custom_message?: string;
  dry_run?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: authErr } = await userClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (authErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = claims.claims.sub;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify admin role
    const { data: roleCheck } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleCheck) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve sender profile (for sent_by audit)
    const { data: senderProfile } = await supabase
      .from('profiles').select('id, full_name, email').eq('user_id', userId).maybeSingle();

    const body = await req.json() as OutreachRequest;
    if (!body.state) {
      return new Response(JSON.stringify({ error: 'state is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const isDryRun = body.dry_run === true;

    // Fetch latest recommendations to get gap_hours and validate candidates
    const recsRes = await supabase.functions.invoke('compute-coverage-recommendations', {
      body: {},
    });
    if (recsRes.error) throw new Error(`Recs engine failed: ${recsRes.error.message}`);
    const recs = recsRes.data;
    const stateRec = recs.state_recommendations?.find((s: any) => s.state === body.state);
    if (!stateRec) {
      return new Response(JSON.stringify({ error: `No recommendations for state ${body.state}` }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter candidates: requested ids if provided, otherwise all non-cooldown
    let candidates = stateRec.outreach_candidates as Array<{
      profile_id: string; name: string; email: string;
      current_state: string | null; current_state_status: string | null;
      surplus_hours: number; on_cooldown: boolean;
    }>;
    if (body.profile_ids?.length) {
      const ids = new Set(body.profile_ids);
      candidates = candidates.filter(c => ids.has(c.profile_id));
    }

    // Enforce cooldown server-side (re-check)
    const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentSends } = await supabase
      .from('coverage_outreach_log')
      .select('profile_id, sent_at')
      .eq('state_abbreviation', body.state)
      .gte('sent_at', cutoff);
    const blockedIds = new Set((recentSends ?? []).map(r => r.profile_id));
    const sendable = candidates.filter(c => !blockedIds.has(c.profile_id));
    const skipped = candidates.filter(c => blockedIds.has(c.profile_id));

    if (isDryRun) {
      return new Response(JSON.stringify({
        success: true, dry_run: true, state: body.state,
        gap_hours: stateRec.gap_hours,
        would_send: sendable.length, would_skip: skipped.length,
        sendable_recipients: sendable.map(c => ({ name: c.name, email: c.email })),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Send each via send-notification-email
    const dashboardUrl = 'https://vitableclinops.lovable.app/admin/ops';
    const results: Array<{ email: string; success: boolean; error?: string; message_id?: string }> = [];

    for (const candidate of sendable) {
      try {
        const emailRes = await supabase.functions.invoke('send-notification-email', {
          body: {
            type: 'coverage_outreach',
            recipientEmail: candidate.email,
            recipientName: candidate.name,
            data: {
              stateAbbreviation: body.state,
              gapHours: stateRec.gap_hours,
              targetSlots: stateRec.target_slots,
              availableSlots: stateRec.available_slots,
              currentState: candidate.current_state,
              currentStateStatus: candidate.current_state_status,
              surplusHours: candidate.surplus_hours,
              customMessage: body.custom_message,
              actionUrl: 'https://app.joinhomebase.com/',
              dashboardUrl,
            },
          },
        });
        if (emailRes.error) {
          results.push({ email: candidate.email, success: false, error: emailRes.error.message });
          continue;
        }
        const messageId = emailRes.data?.id;
        // Log outreach
        await supabase.from('coverage_outreach_log').insert({
          profile_id: candidate.profile_id,
          state_abbreviation: body.state,
          gap_hours: stateRec.gap_hours,
          sent_by: senderProfile?.id ?? null,
          channel: 'email',
          email_message_id: messageId ?? null,
          notes: body.custom_message ?? null,
        });
        results.push({ email: candidate.email, success: true, message_id: messageId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        results.push({ email: candidate.email, success: false, error: msg });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      state: body.state,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      skipped_cooldown: skipped.length,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('send-coverage-outreach error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});