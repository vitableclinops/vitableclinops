import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WARNING_DAYS = [60, 30, 7];

/**
 * Daily cron: find active agreements with next_renewal_date in 60/30/7 days
 * and email both physician + active providers.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const today = new Date();
    const results: { window: number; agreementsNotified: number }[] = [];
    let totalSent = 0;

    for (const days of WARNING_DAYS) {
      const target = new Date(today);
      target.setDate(target.getDate() + days);
      const targetStr = target.toISOString().split('T')[0];

      const { data: agreements, error } = await supabase
        .from('collaborative_agreements')
        .select('id, state_name, physician_name, next_renewal_date')
        .eq('workflow_status', 'active')
        .eq('next_renewal_date', targetStr);

      if (error) {
        console.error(`Failed fetching agreements for ${days}d window:`, error);
        continue;
      }

      let notified = 0;
      for (const agreement of agreements || []) {
        // Idempotency: skip if we've already sent this window for this agreement today
        const { data: existing } = await supabase
          .from('agreement_notifications')
          .select('id')
          .eq('agreement_id', agreement.id)
          .eq('notification_type', 'agreement_renewal_warning' as any)
          .gte('sent_at', new Date(today.toDateString()).toISOString())
          .limit(1);

        if (existing && existing.length > 0) continue;

        const { error: invokeErr } = await supabase.functions.invoke('notify-agreement-event', {
          body: {
            agreementId: agreement.id,
            eventType: 'agreement_renewal_warning',
          },
        });
        if (!invokeErr) {
          notified++;
          totalSent++;
        } else {
          console.error(`Failed renewal notify for ${agreement.id}:`, invokeErr);
        }
      }
      results.push({ window: days, agreementsNotified: notified });
    }

    console.log('check-renewal-warnings:', { totalSent, results });
    return new Response(JSON.stringify({ success: true, totalSent, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('check-renewal-warnings error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});