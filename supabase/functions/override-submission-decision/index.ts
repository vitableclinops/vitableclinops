import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { provider_name, target_month, decision, actor_label } = await req.json();
    if (!provider_name || !target_month || !decision) {
      return new Response(JSON.stringify({ error: 'provider_name, target_month, decision required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = Deno.env.get('CLINOPS_SUPABASE_URL')!;
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY')!;
    const sb = createClient(url, key);

    const { data: subs, error: selErr } = await sb
      .from('schedule_submissions')
      .select('id, provider_id, decision_status, decision_notes, raw_requested_hours, normalized_requested_hours, effective_hours_used_for_forecast, submitted_at')
      .eq('target_month', target_month)
      .ilike('provider_name', `%${provider_name}%`)
      .order('submitted_at', { ascending: false });
    if (selErr) throw selErr;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ error: 'No submission found', provider_name, target_month }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sub = subs[0];
    const nowIso = new Date().toISOString();
    const actor = actor_label || 'ClinOps (manual override)';
    const auditLine = `Manual override: ${decision} by ${actor} at ${nowIso}`;
    const newNotes = sub.decision_notes ? `${sub.decision_notes}\n${auditLine}` : auditLine;
    const hours = sub.effective_hours_used_for_forecast ?? sub.normalized_requested_hours ?? sub.raw_requested_hours ?? 0;

    const { error: updErr } = await sb
      .from('schedule_submissions')
      .update({
        decision_status: decision,
        accepted_hours: decision === 'accepted' ? hours : 0,
        declined_hours: decision === 'declined' ? hours : 0,
        decided_at: nowIso,
        decision_notes: newNotes,
      })
      .eq('id', sub.id);
    if (updErr) throw updErr;

    // Trigger shift-recommendations re-emit so the publish stage picks up
    // the overridden decision. We call ClinOps's emit function with the
    // service-role key so it bypasses verify_jwt.
    let emit_status: number | null = null;
    let emit_body: string | null = null;
    try {
      const emitUrl = `${url}/functions/v1/emit-shift-recommendations?target_month=${encodeURIComponent(target_month)}&provider_id=${encodeURIComponent(sub.provider_id)}`;
      const r = await fetch(emitUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'apikey': key,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      emit_status = r.status;
      emit_body = (await r.text()).slice(0, 500);
    } catch (e) {
      emit_body = `emit error: ${String(e?.message || e)}`;
    }

    return new Response(JSON.stringify({ ok: true, submission_id: sub.id, hours, candidates: subs.length, emit_status, emit_body }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});