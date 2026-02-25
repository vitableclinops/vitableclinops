import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Daily cron job: Auto-activate draft collaborative agreements
 * linked to completed transfers when their effective date arrives.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const today = new Date().toISOString().split('T')[0];

    // Find draft/in_progress agreements created by transfers where effective date has arrived
    const { data: transfers, error: fetchError } = await supabase
      .from('agreement_transfers')
      .select('id, target_agreement_id, effective_date, target_physician_name, affected_provider_count, source_agreement_id, affected_provider_ids')
      .not('target_agreement_id', 'is', null)
      .lte('effective_date', today);

    if (fetchError) throw fetchError;

    let activatedCount = 0;

    for (const transfer of transfers || []) {
      if (!transfer.target_agreement_id) continue;

      // Check if agreement is still in draft or in_progress
      const { data: agreement } = await supabase
        .from('collaborative_agreements')
        .select('id, workflow_status')
        .eq('id', transfer.target_agreement_id)
        .in('workflow_status', ['draft', 'in_progress'])
        .maybeSingle();

      if (!agreement) continue;

      // Activate the agreement
      const { error: updateError } = await supabase
        .from('collaborative_agreements')
        .update({ workflow_status: 'active' })
        .eq('id', agreement.id);

      if (updateError) {
        console.error(`Failed to activate agreement ${agreement.id}:`, updateError);
        continue;
      }

      // Log the activation
      await supabase.from('transfer_activity_log').insert({
        transfer_id: transfer.id,
        activity_type: 'agreement_activated',
        actor_name: 'System (Scheduled Job)',
        actor_role: 'system',
        description: `Agreement ${agreement.id} auto-activated on effective date ${transfer.effective_date}.`,
      });

      activatedCount++;
    }

    console.log(`activate-transfer-agreements: ${activatedCount} agreements activated`);

    return new Response(
      JSON.stringify({ success: true, activated: activatedCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in activate-transfer-agreements:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
