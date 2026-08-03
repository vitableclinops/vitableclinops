import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { provider_name, from_month, to_month, dry_run, submission_id } = body as {
      provider_name?: string; from_month?: string; to_month?: string; dry_run?: boolean; submission_id?: string;
    };
    if (!provider_name || !from_month || !to_month) {
      return new Response(JSON.stringify({ error: 'provider_name, from_month, to_month required (YYYY-MM-01)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const url = Deno.env.get('CLINOPS_SUPABASE_URL')!;
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY')!;
    const sb = createClient(url, key);

    let query = sb
      .from('schedule_submissions')
      .select('id, provider_id, provider_name, target_month, decision_status, submitted_at, raw_requested_hours, parsed_shifts')
      .ilike('provider_name', `%${provider_name}%`)
      .eq('target_month', from_month);
    if (submission_id) query = query.eq('id', submission_id);
    const { data: subs, error: selErr } = await query.order('submitted_at', { ascending: false });
    if (selErr) throw selErr;
    if (!subs?.length) {
      return new Response(JSON.stringify({ error: 'No matching submission', provider_name, from_month }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (dry_run) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, candidates: subs }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Shift all parsed_shifts dates from from_month's year-month to to_month's year-month
    const fromYm = from_month.slice(0, 7); // YYYY-MM
    const toYm = to_month.slice(0, 7);
    const shiftDates = (raw: unknown): unknown => {
      if (Array.isArray(raw)) return raw.map(shiftDates);
      if (!raw || typeof raw !== 'object') {
        if (typeof raw === 'string' && raw.startsWith(fromYm)) {
          return toYm + raw.slice(7);
        }
        return raw;
      }
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && v.startsWith(fromYm)) {
          obj[k] = toYm + v.slice(7);
        } else {
          obj[k] = shiftDates(v);
        }
      }
      return obj;
    };

    const updated = [];
    for (const s of subs) {
      const newParsed = shiftDates((s as any).parsed_shifts);
      const auditNote = `ClinOps: moved submission from ${from_month} to ${to_month} at ${new Date().toISOString()}`;
      const { data, error } = await sb
        .from('schedule_submissions')
        .update({
          target_month: to_month,
          parsed_shifts: newParsed,
          decision_status: 'pending',
          accepted_hours: null,
          declined_hours: null,
          decided_at: null,
          decision_notes: auditNote,
        })
        .eq('id', (s as any).id)
        .select('id, target_month, decision_status')
        .maybeSingle();
      if (error) throw error;
      updated.push(data);
    }

    // Clean up any shift_recommendations for the old month/submissions
    const ids = subs.map((s: any) => s.id);
    const { error: delErr } = await sb
      .from('shift_recommendations')
      .delete()
      .in('submission_id', ids);
    if (delErr) console.warn('shift_recommendations cleanup:', delErr.message);

    return new Response(JSON.stringify({ ok: true, moved: updated, deleted_shift_recs_for_submission_ids: ids }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
