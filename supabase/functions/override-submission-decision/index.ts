import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const patchParsedShiftTimes = (raw: unknown, dates: Set<string>, startMin: number, endMin: number): unknown => {
  const time = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const dateKeys = ['date', 'shift_date', 'Date', 'Start Date'];
  const startKeys = ['start_time', 'start', 'Start Time', 'startTime'];
  const endKeys = ['end_time', 'end', 'End Time', 'endTime'];
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const obj = { ...(value as Record<string, unknown>) };
    const dateValue = dateKeys.map(k => obj[k]).find(v => typeof v === 'string') as string | undefined;
    const iso = dateValue?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (iso && dates.has(iso)) {
      for (const key of startKeys) if (key in obj) obj[key] = time(startMin);
      for (const key of endKeys) if (key in obj) obj[key] = time(endMin);
      if ('start_min' in obj) obj.start_min = startMin;
      if ('end_min' in obj) obj.end_min = endMin;
      if ('hours' in obj) obj.hours = (endMin - startMin) / 60;
    }
    for (const [key, val] of Object.entries(obj)) obj[key] = walk(val);
    return obj;
  };
  return walk(raw);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { provider_name, target_month, decision, actor_label, mode } = body;

    const url = Deno.env.get('CLINOPS_SUPABASE_URL')!;
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY')!;

    // mode === 'recompute_month' → just re-evaluate + re-emit for the whole month,
    // no per-submission override write. Use this after editing availability overrides.
    if (mode === 'recompute_month') {
      if (!target_month) {
        return new Response(JSON.stringify({ error: 'target_month required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const qs = `?target_month=${encodeURIComponent(target_month)}`;
      const callFn = async (name: string) => {
        const r = await fetch(`${url}/functions/v1/${name}${qs}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
          body: '{}',
        });
        return { status: r.status, body: (await r.text()).slice(0, 800) };
      };
      const only = (body.only as string | undefined) || 'both';
      const out: Record<string, unknown> = { ok: true };
      if (only === 'evaluate' || only === 'both') {
        out.evaluate = await callFn('evaluate-schedule-submissions');
      }
      if (only === 'emit' || only === 'both') {
        out.emit = await callFn('emit-shift-recommendations');
      }
      return new Response(JSON.stringify(out), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // mode === 'set_effective_hours' → cap the latest submission's
    // effective_hours_used_for_forecast for a provider, so the allocator treats
    // them as if they only requested `hours`. Does NOT re-run evaluator/emit —
    // caller should follow up with mode:'recompute_month'.
    // body: { mode, provider_name, target_month, hours, note? }
    if (mode === 'set_effective_hours') {
      const hours = body.hours as number | undefined;
      if (!provider_name || !target_month || hours == null) {
        return new Response(JSON.stringify({ error: 'provider_name, target_month, hours required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const sb3 = createClient(url, key);
      const { data: subs, error: selErr } = await sb3
        .from('schedule_submissions')
        .select('id, decision_notes, effective_hours_used_for_forecast, raw_requested_hours, normalized_requested_hours')
        .eq('target_month', target_month)
        .ilike('provider_name', `%${provider_name}%`)
        .neq('decision_status', 'superseded')
        .order('submitted_at', { ascending: false })
        .limit(1);
      if (selErr) throw selErr;
      if (!subs || !subs.length) {
        return new Response(JSON.stringify({ error: 'No active submission', provider_name }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const sub = subs[0] as any;
      const nowIso = new Date().toISOString();
      const auditLine = `ClinOps cap: effective_hours ${sub.effective_hours_used_for_forecast} → ${hours} at ${nowIso}${body.note ? ` (${body.note})` : ''}`;
      const newNotes = sub.decision_notes ? `${sub.decision_notes}\n${auditLine}` : auditLine;
      const { data: upd, error: updErr } = await sb3
        .from('schedule_submissions')
        .update({ effective_hours_used_for_forecast: hours, decision_notes: newNotes })
        .eq('id', sub.id)
        .select('id, effective_hours_used_for_forecast, decision_notes')
        .maybeSingle();
      if (updErr) throw updErr;
      return new Response(JSON.stringify({ ok: true, updated: upd }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // mode === 'trim_provider_to_hours' → delete publish shift_recommendations
    // rows for a provider until total accepted hours ≤ target_hours, preferring
    // to drop rows from states that are currently over the state demand target
    // for the month. Updates the underlying schedule_submissions accepted/declined
    // to match. Skips re-evaluate; use with mode:'recompute_month' only:'emit' after.
    // body: { mode, provider_name, target_month, target_hours, note? }
    if (mode === 'trim_provider_to_hours') {
      const targetHours = body.target_hours as number | undefined;
      if (!provider_name || !target_month || targetHours == null) {
        return new Response(JSON.stringify({ error: 'provider_name, target_month, target_hours required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const sb4 = createClient(url, key);

      // 1. per-state accepted totals and per-state targets for the month
      const [{ data: allShifts, error: e1 }, { data: stTargets, error: e2 }, { data: myShifts, error: e3 }] = await Promise.all([
        sb4.from('shift_recommendations').select('assigned_state,hours').eq('target_month', target_month).eq('recommendation', 'publish').range(0, 9999),
        sb4.from('state_demand_targets').select('state,monthly_hours_target').eq('month', target_month),
        sb4.from('shift_recommendations').select('id, submission_id, shift_date, assigned_state, hours, start_min, end_min').eq('target_month', target_month).eq('recommendation', 'publish').ilike('provider_name', `%${provider_name}%`),
      ]);
      if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;

      const stateAccepted = new Map<string, number>();
      for (const r of (allShifts || []) as any[]) {
        const s = r.assigned_state || 'UNK';
        stateAccepted.set(s, (stateAccepted.get(s) || 0) + Number(r.hours || 0));
      }
      const stateTargetMap = new Map<string, number>();
      for (const r of (stTargets || []) as any[]) stateTargetMap.set(r.state, Number(r.monthly_hours_target || 0));
      const stateOver = (s: string) => (stateAccepted.get(s) || 0) - (stateTargetMap.get(s) || 0);

      const rows = (myShifts || []) as any[];
      const currentTotal = rows.reduce((s, r) => s + Number(r.hours || 0), 0);
      if (currentTotal <= targetHours) {
        return new Response(JSON.stringify({ ok: true, no_op: true, current: currentTotal, target: targetHours }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Sort rows: highest state overage first, then by date desc (drop later dates first)
      rows.sort((a, b) => {
        const oa = stateOver(a.assigned_state || 'UNK');
        const ob = stateOver(b.assigned_state || 'UNK');
        if (ob !== oa) return ob - oa;
        return String(b.shift_date).localeCompare(String(a.shift_date));
      });
      const toDeleteIds: string[] = [];
      let running = currentTotal;
      for (const r of rows) {
        if (running <= targetHours) break;
        toDeleteIds.push(r.id);
        running -= Number(r.hours || 0);
      }
      const { error: delErr } = await sb4.from('shift_recommendations').delete().in('id', toDeleteIds);
      if (delErr) throw delErr;

      // 2. Update parent submissions
      const submissionIds = Array.from(new Set(rows.map(r => r.submission_id).filter(Boolean)));
      const { data: postRows, error: postErr } = await sb4
        .from('shift_recommendations')
        .select('submission_id, hours, recommendation')
        .in('submission_id', submissionIds);
      if (postErr) throw postErr;
      const acceptedBySub = new Map<string, number>();
      for (const r of (postRows || []) as any[]) {
        if (r.recommendation !== 'publish') continue;
        acceptedBySub.set(r.submission_id, (acceptedBySub.get(r.submission_id) || 0) + Number(r.hours || 0));
      }
      const nowIso = new Date().toISOString();
      const auditLine = `ClinOps manual trim to ${targetHours}h at ${nowIso}${body.note ? ` (${body.note})` : ''}`;
      const subUpdates: unknown[] = [];
      for (const sid of submissionIds) {
        const { data: sub } = await sb4.from('schedule_submissions').select('decision_notes, effective_hours_used_for_forecast, normalized_requested_hours').eq('id', sid).maybeSingle();
        const accepted = Number((acceptedBySub.get(sid) || 0).toFixed(2));
        const eff = Number((sub as any)?.effective_hours_used_for_forecast || (sub as any)?.normalized_requested_hours || 0);
        const declined = Math.max(0, Number((eff - accepted).toFixed(2)));
        const notes = (sub as any)?.decision_notes ? `${(sub as any).decision_notes}\n${auditLine}` : auditLine;
        const { data: u } = await sb4.from('schedule_submissions').update({
          accepted_hours: accepted,
          declined_hours: declined,
          decision_status: accepted > 0 && declined > 0 ? 'partial' : (accepted > 0 ? 'accepted' : 'declined'),
          decision_notes: notes,
        }).eq('id', sid).select('id, accepted_hours, declined_hours, decision_status').maybeSingle();
        subUpdates.push(u);
      }

      return new Response(JSON.stringify({ ok: true, deleted_rows: toDeleteIds.length, new_total: running, target: targetHours, submissions: subUpdates }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // mode === 'patch_shift_times' → manually adjust start/end time on specific publish rows.
    // body: { mode, provider_name, target_month, dates: ['YYYY-MM-DD', ...], start_min, end_min, note? }
    if (mode === 'patch_shift_times') {
      const dates = body.dates as string[] | undefined;
      const start_min = body.start_min as number | undefined;
      const end_min = body.end_min as number | undefined;
      if (!provider_name || !target_month || !dates || !dates.length || start_min == null || end_min == null) {
        return new Response(JSON.stringify({ error: 'provider_name, target_month, dates, start_min, end_min required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const sb2 = createClient(url, key);
      const hours = (end_min - start_min) / 60;
      const { data: rows, error: selErr } = await sb2
        .from('shift_recommendations')
        .select('id, submission_id, shift_date, start_min, end_min, hours, provider_name, notes')
        .eq('target_month', target_month)
        .ilike('provider_name', `%${provider_name}%`)
        .in('shift_date', dates);
      if (selErr) throw selErr;
      const ids = (rows || []).map((r: any) => r.id);
      if (!ids.length) {
        return new Response(JSON.stringify({ error: 'No matching shift_recommendations rows', dates }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const submissionIds = Array.from(new Set((rows || []).map((r: any) => r.submission_id).filter(Boolean)));
      const note = body.note || `ClinOps manual time adjustment: ${start_min}→${end_min} min (per provider comment).`;
      const { data: upd, error: updErr } = await sb2
        .from('shift_recommendations')
        .update({ start_min, end_min, hours, notes: note, updated_at: new Date().toISOString() })
        .in('id', ids)
        .select('id, shift_date, start_min, end_min, hours');
      if (updErr) throw updErr;

      let submission_updates: unknown[] = [];
      if (submissionIds.length) {
        const { data: shiftTotals, error: totalsErr } = await sb2
          .from('shift_recommendations')
          .select('submission_id, recommendation, hours')
          .in('submission_id', submissionIds);
        if (totalsErr) throw totalsErr;
        const acceptedBySubmission = new Map<string, number>();
        for (const row of shiftTotals || []) {
          if ((row as any).recommendation !== 'publish') continue;
          const sid = (row as any).submission_id;
          acceptedBySubmission.set(sid, (acceptedBySubmission.get(sid) || 0) + Number((row as any).hours || 0));
        }
        const { data: submissions, error: subErr } = await sb2
          .from('schedule_submissions')
          .select('id, parsed_shifts, decision_status')
          .in('id', submissionIds);
        if (subErr) throw subErr;
        const dateSet = new Set(dates);
        const updates = [];
        for (const sub of submissions || []) {
          const accepted = Number((acceptedBySubmission.get((sub as any).id) || 0).toFixed(2));
          const patch: Record<string, unknown> = {
            accepted_hours: accepted,
            declined_hours: 0,
            effective_hours_used_for_forecast: accepted,
            normalized_requested_hours: accepted,
            raw_requested_hours: accepted,
            parsed_shifts: patchParsedShiftTimes((sub as any).parsed_shifts, dateSet, start_min, end_min),
            decision_notes: note,
          };
          const { data: updatedSub, error: updateSubErr } = await sb2
            .from('schedule_submissions')
            .update(patch)
            .eq('id', (sub as any).id)
            .select('id, accepted_hours, declined_hours, effective_hours_used_for_forecast')
            .maybeSingle();
          if (updateSubErr) throw updateSubErr;
          updates.push(updatedSub);
        }
        submission_updates = updates;
      }
      return new Response(JSON.stringify({ ok: true, updated: upd, submission_updates }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!provider_name || !target_month || !decision) {
      return new Response(JSON.stringify({ error: 'provider_name, target_month, decision required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(url, key);

    const { data: subs, error: selErr } = await sb
      .from('schedule_submissions')
      .select('id, provider_id, decision_status, decision_notes, raw_requested_hours, normalized_requested_hours, effective_hours_used_for_forecast, submitted_at, parsed_shifts')
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
    const shouldClearDeclineNotes = decision === 'accepted' && body.clear_decline_notes !== false;
    const fullAcceptLine = body.full_accept_note || 'ClinOps manual override: accepted in full; no declined hours.';
    const newNotes = shouldClearDeclineNotes
      ? `${fullAcceptLine}\n${auditLine}`
      : sub.decision_notes
        ? `${sub.decision_notes}\n${auditLine}`
        : auditLine;
    const hours = sub.effective_hours_used_for_forecast ?? sub.normalized_requested_hours ?? sub.raw_requested_hours ?? 0;

    // Optional manual correction flags (e.g. allow_outside_operating_hours).
    const allowOutsideOps = body.allow_outside_operating_hours === true;
    let newParsedShifts = sub.parsed_shifts;
    if (allowOutsideOps && newParsedShifts && typeof newParsedShifts === 'object' && !Array.isArray(newParsedShifts)) {
      const prior = (newParsedShifts as Record<string, unknown>).clinops_manual_correction;
      const priorObj = prior && typeof prior === 'object' && !Array.isArray(prior) ? prior as Record<string, unknown> : {};
      newParsedShifts = {
        ...(newParsedShifts as Record<string, unknown>),
        clinops_manual_correction: { ...priorObj, allow_outside_operating_hours: true, set_by: actor, set_at: nowIso },
      };
    }

    const { error: updErr } = await sb
      .from('schedule_submissions')
      .update({
        decision_status: decision,
        accepted_hours: decision === 'accepted' ? hours : 0,
        declined_hours: decision === 'declined' ? hours : 0,
        decided_at: nowIso,
        decision_notes: newNotes,
        ...(allowOutsideOps ? { parsed_shifts: newParsedShifts } : {}),
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

    const { data: verified } = await sb
      .from('schedule_submissions')
      .select('decision_status, accepted_hours, declined_hours, decision_notes')
      .eq('id', sub.id)
      .maybeSingle();

    return new Response(JSON.stringify({ ok: true, submission_id: sub.id, hours, candidates: subs.length, verified, emit_status, emit_body }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});