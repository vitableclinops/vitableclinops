import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type EventType =
  | 'agreement_activated'
  | 'agreement_invalidated'
  | 'agreement_terminated'
  | 'transfer_initiated';

interface RequestBody {
  agreementId?: string;
  transferId?: string;
  eventType: EventType;
  reason?: string;
  extraRecipients?: { email: string; name: string }[];
}

/**
 * Single endpoint to fan out agreement lifecycle emails to all relevant parties:
 * - Collaborating physician
 * - All active providers on the agreement
 * - Optional extra recipients (e.g. ops admin)
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: RequestBody = await req.json();
    const { agreementId, transferId, eventType, reason, extraRecipients = [] } = body;

    if (!eventType) throw new Error('eventType is required');
    if (!agreementId && !transferId) throw new Error('agreementId or transferId is required');

    let agreement: any = null;
    let transfer: any = null;
    let providers: { email: string; name: string }[] = [];

    if (agreementId) {
      const { data, error } = await supabase
        .from('collaborative_agreements')
        .select('id, state_name, state_abbreviation, physician_name, physician_email, provider_name, provider_email, start_date, terminated_at, termination_reason, next_renewal_date, meeting_cadence')
        .eq('id', agreementId)
        .maybeSingle();
      if (error) throw error;
      agreement = data;

      if (agreement) {
        const { data: aps } = await supabase
          .from('agreement_providers')
          .select('provider_email, provider_name')
          .eq('agreement_id', agreementId)
          .eq('is_active', true);
        providers = (aps || [])
          .filter((p) => p.provider_email)
          .map((p) => ({ email: p.provider_email!, name: p.provider_name || 'Provider' }));
      }
    }

    if (transferId) {
      const { data, error } = await supabase
        .from('agreement_transfers')
        .select('id, state_name, state_abbreviation, source_physician_name, source_physician_email, target_physician_name, target_physician_email, effective_date, provider_message, affected_provider_ids')
        .eq('id', transferId)
        .maybeSingle();
      if (error) throw error;
      transfer = data;

      if (transfer?.affected_provider_ids?.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('email, full_name')
          .in('id', transfer.affected_provider_ids);
        providers = (profs || [])
          .filter((p) => p.email)
          .map((p) => ({ email: p.email!, name: p.full_name || 'Provider' }));
      }
    }

    // Build recipient list (dedup by email)
    const recipientMap = new Map<string, { email: string; name: string }>();
    if (agreement?.physician_email) recipientMap.set(agreement.physician_email, { email: agreement.physician_email, name: agreement.physician_name || 'Physician' });
    if (transfer?.target_physician_email) recipientMap.set(transfer.target_physician_email, { email: transfer.target_physician_email, name: transfer.target_physician_name || 'Physician' });
    if (transfer?.source_physician_email && eventType === 'transfer_initiated') {
      recipientMap.set(transfer.source_physician_email, { email: transfer.source_physician_email, name: transfer.source_physician_name || 'Physician' });
    }
    for (const p of providers) recipientMap.set(p.email, p);
    for (const r of extraRecipients) recipientMap.set(r.email, r);

    const recipients = Array.from(recipientMap.values());
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No recipients with emails' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stateName = agreement?.state_name || transfer?.state_name || 'Unknown';
    const baseData: Record<string, any> = {
      stateName,
      stateAbbreviation: agreement?.state_abbreviation || transfer?.state_abbreviation,
      physicianName: agreement?.physician_name || transfer?.target_physician_name,
      providerName: agreement?.provider_name,
      effectiveDate: agreement?.start_date || transfer?.effective_date,
      renewalDate: agreement?.next_renewal_date,
      meetingCadence: agreement?.meeting_cadence,
      terminatedAt: agreement?.terminated_at,
      reason: reason || agreement?.termination_reason,
      sourcePhysicianName: transfer?.source_physician_name,
      targetPhysicianName: transfer?.target_physician_name,
      providerMessage: transfer?.provider_message,
      actionUrl: agreementId
        ? `https://vitableclinops.lovable.app/admin/agreements/${agreementId}`
        : `https://vitableclinops.lovable.app/admin/agreements`,
    };

    let sent = 0;
    const errors: string[] = [];

    for (const recipient of recipients) {
      try {
        const { error } = await supabase.functions.invoke('send-notification-email', {
          body: {
            type: eventType,
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            data: baseData,
          },
        });
        if (error) errors.push(`${recipient.email}: ${error.message}`);
        else sent++;
      } catch (e: any) {
        errors.push(`${recipient.email}: ${e.message}`);
      }
    }

    // Log to agreement_notifications when scoped to an agreement
    if (agreementId) {
      await supabase.from('agreement_notifications').insert(
        recipients.map((r) => ({
          agreement_id: agreementId,
          notification_type: eventType as any,
          recipient_email: r.email,
          recipient_name: r.name,
          subject: `Agreement event: ${eventType}`,
          delivered: !errors.some((err) => err.startsWith(r.email)),
          sent_at: new Date().toISOString(),
        })),
      );
    }

    return new Response(JSON.stringify({ success: true, sent, recipients: recipients.length, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('notify-agreement-event error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});