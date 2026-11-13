import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildSubmissionTimeline } from '../_shared/submissionTimeline.ts';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Content-Type': 'application/json' };
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { headers, status });
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return respond({ error: 'Sign in required' }, 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return respond({ error: 'Sign in required' }, 401);
  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', data.user.id);
  if (!roles?.some(row => ['admin', 'scheduling'].includes(row.role))) return respond({ error: 'Scheduling access required' }, 403);
  const { email, action, name } = await req.json();
  if (action === 'december_hours_by_provider') {
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
    const url = Deno.env.get('CLINOPS_SUPABASE_URL');
    if (!key || !url) return respond({ error: 'Scheduling source unavailable' }, 503);
    const db = createClient(url, key);
    const { data: workflow } = await db.from('scheduling_month_workflows').select('locked_build_id,active_build_id').eq('target_month', '2026-12-01').single();
    const buildId = workflow?.locked_build_id ?? workflow?.active_build_id;
    const totals: Record<string, number> = {};
    for (let from = 0; ; from += 1000) {
      const { data: rows, error: rErr } = await db.from('schedule_build_rows').select('provider_name,hours,recommendation').eq('build_id', buildId).range(from, from + 999);
      if (rErr) return respond({ error: rErr.message }, 500);
      for (const r of rows ?? []) { const k = `${r.provider_name}|${r.recommendation}`; totals[k] = (totals[k] ?? 0) + Number(r.hours); }
      if (!rows || rows.length < 1000) break;
    }
    return respond({ buildId, totals });
  }
  if (action === 'add_nancy_distefano_december') {
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
    const url = Deno.env.get('CLINOPS_SUPABASE_URL');
    if (!key || !url) return respond({ error: 'Scheduling source unavailable' }, 503);
    const db = createClient(url, key);
    const email = 'nancy.distefano@vitablehealth.com';
    let { data: provider, error: pErr } = await db.from('providers').select('id,name,email').ilike('email', email).maybeSingle();
    if (!provider) {
      const { data: similar } = await db.from('providers').select('id,name,email').or('name.ilike.%stefano%,email.ilike.%stefano%');
      if (similar?.length) return respond({ error: 'Possible existing record; not creating a duplicate', similar }, 409);
      const created = await db.from('providers').insert({ name: 'Nancy DiStefano', email, profession: 'THERAPIST', active: true }).select('id,name,email').single();
      provider = created.data; pErr = created.error;
    }
    if (pErr || !provider) {
      const { data: candidates } = await db.from('providers').select('id,name,email,profession,active').or('name.ilike.%stefano%,email.ilike.%stefano%');
      return respond({ error: 'Exact provider identity required', detail: pErr?.message, candidates }, 409);
    }
    const { data: sub } = await db.from('schedule_submissions').select('id,submitted_at,parsed_shifts').eq('id', 'b8e40926-1851-4cd7-b441-d43d7c1a1e12').single();
    if (!sub || (sub.parsed_shifts as any)?.email !== email) return respond({ error: 'Nancy December form not found' }, 404);
    const { data: workflow } = await db.from('scheduling_month_workflows').select('locked_build_id').eq('target_month', '2026-12-01').single();
    const buildId = workflow?.locked_build_id;
    if (!buildId) return respond({ error: 'Locked December build required' }, 409);
    const { data: build } = await db.from('schedule_builds').select('source_decision_run_id').eq('id', buildId).single();
    const { data: existing } = await db.from('schedule_build_rows').select('id').eq('build_id', buildId).eq('provider_id', provider.id);
    if (existing?.length) return respond({ ok: true, already_added: true, rows: existing.length });
    const timeline = buildSubmissionTimeline([{ id: sub.id, submitted_at: sub.submitted_at, parsed_shifts: sub.parsed_shifts }], { providerId: provider.id, name: provider.name, email }, '2026-12-01');
    const hours = timeline.summary.final_approvable_hours;
    if (Math.abs(hours - 29.75) > 0.01 || timeline.timeline.length !== 30 || timeline.timeline.some(r => ['2026-12-02','2026-12-23','2026-12-24','2026-12-25'].includes(r.date))) return respond({ error: 'Source validation mismatch', hours, rows: timeline.timeline.length, timeline: timeline.timeline.map(r => [r.date, r.startMin, r.endMin]), summary: timeline.summary, parsed: sub.parsed_shifts }, 409);
    const note = 'Maddi Swanagan approved adding all of Nancy DiStefano (therapist) December form (29.75h) after lock; therapy was short of its 66h target. No other provider shifts changed.';
    const { error: upErr } = await db.from('schedule_submissions').update({ provider_id: provider.id, provider_name: provider.name, decision_status: 'accepted', accepted_hours: hours, declined_hours: 0, effective_hours_used_for_forecast: hours, decision_notes: note, decided_at: new Date().toISOString() }).eq('id', sub.id);
    if (upErr) return respond({ error: upErr.message }, 500);
    const rows = timeline.timeline.map(r => ({ submission_id: sub.id, provider_id: provider.id, provider_name: provider.name, target_month: '2026-12-01', shift_date: r.date, start_min: r.startMin, end_min: r.endMin, hours: (r.endMin - r.startMin) / 60, shift_type: ['2026-12-09','2026-12-17'].includes(r.date) && r.startMin === 600 ? 'virtual_oneoff' : 'virtual_recurring', assigned_state: null, recommendation: 'publish', recommendation_reason: note, publish_status: 'pending' }));
    const { error: rowsError } = await db.from('schedule_build_rows').insert(rows.map(r => ({ ...r, build_id: buildId, source_publish_status: 'pending' })));
    if (rowsError) return respond({ error: rowsError.message }, 500);
    const { error: recError } = await db.from('shift_recommendations').insert(rows.map(r => ({ ...r, decision_run_id: build?.source_decision_run_id })));
    if (recError) return respond({ error: recError.message, build_rows_added: true }, 500);
    await db.from('schedule_amendment_requests').insert({ target_month: '2026-12-01', build_id: buildId, submission_id: sub.id, provider_id: provider.id, provider_name: provider.name, request_type: 'resubmission', status: 'applied', summary: 'Added late December therapy availability: 29.75h', notes: note, requested_by_label: 'Maddi Swanagan', resolved_by_label: 'Maddi Swanagan', resolved_at: new Date().toISOString() });
    return respond({ ok: true, hours_added: hours, rows_added: rows.length });
  }
  if (action === 'inspect_provider_december') {
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
    const url = Deno.env.get('CLINOPS_SUPABASE_URL');
    if (!key || !url) return respond({ error: 'Scheduling source unavailable' }, 503);
    const db = createClient(url, key);
    const { data: subs } = await db.from('schedule_submissions').select('id,provider_id,provider_name,submitted_at,decision_status,accepted_hours,declined_hours,decision_notes,parsed_shifts').ilike('provider_name', `%${name}%`).order('submitted_at', { ascending: false }).limit(5);
    const { data: workflow } = await db.from('scheduling_month_workflows').select('locked_build_id').eq('target_month', '2026-12-01').single();
    const pid = subs?.[0]?.provider_id ?? null;
    const { data: recs } = pid ? await db.from('shift_recommendations').select('shift_date,start_min,end_min,hours,recommendation,recommendation_reason,publish_status').eq('provider_id', pid).eq('target_month', '2026-12-01') : { data: [] };
    const { data: allRows } = workflow?.locked_build_id ? await db.from('schedule_build_rows').select('provider_id,provider_name,shift_date,start_min,end_min,hours,recommendation,shift_type').eq('build_id', workflow.locked_build_id).limit(5000) : { data: [] };
    const timelines = (subs ?? []).filter(s => s.provider_id === pid).map(s => ({ id: s.id, submitted_at: s.submitted_at, parsed_shifts: s.parsed_shifts }));
    const timeline = pid ? buildSubmissionTimeline(timelines, { providerId: pid, name: subs![0].provider_name, email: '' }, '2026-12-01') : null;
    return respond({ subs: subs?.map(s => ({ ...s, month: (s.parsed_shifts as any)?.target_month ?? null, notes: (s.parsed_shifts as any)?.notes ?? (s.parsed_shifts as any)?.comments ?? null })), workflow, recs, timeline, rows: allRows });
  }
  if (action === 'add_andrea_shepherd_december') {
    const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
    const url = Deno.env.get('CLINOPS_SUPABASE_URL');
    if (!key || !url) return respond({ error: 'Scheduling source unavailable' }, 503);
    const db = createClient(url, key);
    const providerId = 'f99b23db-78f0-4151-8737-44bc48a50ea0';
    const { data: sub, error: subError } = await db.from('schedule_submissions').select('id,provider_id,provider_name,submitted_at,parsed_shifts').eq('id', 'd3bcecb5-3bfe-447e-a6dd-5b4c21532d50').single();
    if (subError || !sub || sub.provider_id !== providerId) return respond({ error: 'Andrea December form not found' }, 404);
    const { data: workflow } = await db.from('scheduling_month_workflows').select('locked_build_id').eq('target_month', '2026-12-01').single();
    if (!workflow?.locked_build_id) return respond({ error: 'Locked December build required' }, 409);
    const buildId = workflow.locked_build_id;
    const { data: existing } = await db.from('schedule_build_rows').select('id').eq('build_id', buildId).eq('provider_id', providerId);
    const { data: build } = await db.from('schedule_builds').select('source_decision_run_id').eq('id', buildId).single();
    const { data: recsExisting } = await db.from('shift_recommendations').select('id').eq('provider_id', providerId).eq('target_month', '2026-12-01');
    if (existing?.length && recsExisting?.length) return respond({ ok: true, already_added: true, rows: existing.length });
    const timeline = buildSubmissionTimeline([{ id: sub.id, submitted_at: sub.submitted_at, parsed_shifts: sub.parsed_shifts }], { providerId, name: sub.provider_name, email: 'andrea.shepherd@vitablehealth.com' }, '2026-12-01');
    const hours = timeline.summary.final_approvable_hours;
    if (hours !== 37 || timeline.timeline.length !== 14 || timeline.timeline.some(row => row.date === '2026-12-25')) return respond({ error: 'Source validation mismatch', hours, rows: timeline.timeline.length }, 409);
    const note = 'Maddi Swanagan approved adding all of Andrea Shepherd December form (37h) after lock, without reallocating or changing any other provider shifts. Form submitted Nov 11 after the Nov 10 lock.';
    const { error: upErr } = await db.from('schedule_submissions').update({ decision_status: 'accepted', accepted_hours: hours, declined_hours: 0, effective_hours_used_for_forecast: hours, decision_notes: note, decided_at: new Date().toISOString() }).eq('id', sub.id);
    if (upErr) return respond({ error: upErr.message }, 500);
    const rows = timeline.timeline.map(row => ({ submission_id: sub.id, provider_id: providerId, provider_name: sub.provider_name, target_month: '2026-12-01', shift_date: row.date, start_min: row.startMin, end_min: row.endMin, hours: (row.endMin - row.startMin) / 60, shift_type: 'virtual_oneoff', assigned_state: null, recommendation: 'publish', recommendation_reason: note, publish_status: 'pending' }));
    if (!existing?.length) {
      const { error: rowsError } = await db.from('schedule_build_rows').insert(rows.map(row => ({ ...row, build_id: buildId, source_publish_status: 'pending' })));
      if (rowsError) return respond({ error: rowsError.message }, 500);
    }
    const { error: recError } = await db.from('shift_recommendations').insert(rows.map(row => ({ ...row, decision_run_id: build?.source_decision_run_id })));
    if (recError) return respond({ error: recError.message, build_rows_added: true }, 500);
    await db.from('schedule_amendment_requests').insert({ target_month: '2026-12-01', build_id: buildId, submission_id: sub.id, provider_id: providerId, provider_name: sub.provider_name, request_type: 'resubmission', status: 'applied', summary: 'Added late December availability: 37h', notes: note, requested_by_label: 'Maddi Swanagan', resolved_by_label: 'Maddi Swanagan', resolved_at: new Date().toISOString() });
    return respond({ ok: true, hours_added: hours, rows_added: rows.length });
  }
  if (!['sara.hammond@vitablehealth.com', 'andrea.leffet@vitablehealth.com'].includes(email)) return respond({ error: 'Unsupported source lookup' }, 400);
  const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
  const url = Deno.env.get('CLINOPS_SUPABASE_URL');
  if (!key || !url) return respond({ error: 'Scheduling source unavailable' }, 503);
  const response = await fetch(`${url}/functions/v1/sync-jotform-submissions?preview_email=${encodeURIComponent(email)}&since=2026-09-01`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'x-source-lookup-key': key, 'Content-Type': 'application/json' }, body: '{}' });
  if (action === 'add_sara_december') {
    if (email !== 'sara.hammond@vitablehealth.com' || !response.ok) return respond({ error: 'Verified December source required' }, 400);
    const source = await response.json();
    const submission = source.submissions.find((row: { parsed: { targetMonth: string }; id: string }) => row.parsed.targetMonth === '2026-12-01' && row.id === '6701438434914671780');
    if (!submission) return respond({ error: 'Sara December form not found' }, 404);
    const db = createClient(url, key);
    const { data: provider, error: providerError } = await db.from('providers').select('id,name,email').eq('email', email).single();
    if (providerError || !provider) return respond({ error: 'Exact provider identity required' }, 409);
    const { data: workflow, error: workflowError } = await db.from('scheduling_month_workflows').select('active_build_id,locked_build_id,current_stage').eq('target_month', '2026-12-01').single();
    if (workflowError || !workflow?.locked_build_id) return respond({ error: 'Locked December build required' }, 409);
    const buildId = workflow.locked_build_id;
    const { data: existing, error: existingError } = await db.from('schedule_build_rows').select('id').eq('build_id', buildId).eq('provider_id', provider.id);
    if (existingError) return respond({ error: existingError.message }, 500);
    if (existing?.length) return respond({ ok: true, already_added: true, rows: existing.length });
    const parsed = submission.parsed;
    const blob = { recurring_virtual: parsed.recurringVirtual, one_off_virtual: parsed.oneOffVirtual, in_home_clinic: parsed.inHomeClinic, unavailable_dates: parsed.unavailableDates, email, requested_hours_total: parsed.totalHours, shift_types: parsed.shiftTypes, target_month_source: parsed.targetMonthSource, target_month_dropdown: parsed.dropdownMonth, match_confidence: 'email', comments: parsed.comments };
    const id = crypto.randomUUID();
    const timeline = buildSubmissionTimeline([{ id, submitted_at: submission.submitted_at, parsed_shifts: blob }], { providerId: provider.id, name: provider.name, email }, '2026-12-01');
    const hours = timeline.summary.final_approvable_hours;
    if (hours !== 84 || timeline.timeline.length !== 14 || timeline.timeline.some(row => row.date === '2026-12-25')) return respond({ error: 'Source validation mismatch', hours, rows: timeline.timeline.length }, 409);
    const note = 'Maddi Swanagan approved adding Sara Hammond December form (84h) without reallocating or changing any existing provider shifts. Source form submitted Nov 10 at 18:17 UTC; missed by prior import.';
    const { data: saved, error: saveError } = await db.from('schedule_submissions').upsert({ jotform_submission_id: submission.id, provider_id: provider.id, provider_name: provider.name, target_month: '2026-12-01', submitted_at: submission.submitted_at, raw_answers: submission.raw_answers, parsed_shifts: blob, decision_status: 'accepted', accepted_hours: hours, declined_hours: 0, effective_hours_used_for_forecast: hours, normalized_requested_hours: hours, raw_requested_hours: hours, decision_notes: note, decided_at: new Date().toISOString() }, { onConflict: 'jotform_submission_id' }).select('id').single();
    if (saveError || !saved) return respond({ error: saveError?.message ?? 'Unable to save form' }, 500);
    const rows = timeline.timeline.map(row => ({ submission_id: saved.id, provider_id: provider.id, provider_name: provider.name, target_month: '2026-12-01', shift_date: row.date, start_min: row.startMin, end_min: row.endMin, hours: (row.endMin - row.startMin) / 60, shift_type: 'virtual_recurring', assigned_state: null, recommendation: 'publish', recommendation_reason: note, publish_status: 'pending' }));
    const { error: rowsError } = await db.from('schedule_build_rows').insert(rows.map(row => ({ ...row, build_id: buildId, source_publish_status: 'pending' })));
    if (rowsError) return respond({ error: rowsError.message, submission_saved: true }, 500);
    const { error: recError } = await db.from('shift_recommendations').insert(rows);
    if (recError) return respond({ error: recError.message, build_rows_added: true }, 500);
    const { error: auditError } = await db.from('schedule_amendment_requests').insert({ target_month: '2026-12-01', build_id: buildId, submission_id: saved.id, provider_id: provider.id, provider_name: provider.name, request_type: 'resubmission', status: 'applied', summary: 'Added verified December availability: 84h', notes: note, requested_by_label: 'Maddi Swanagan', resolved_by_label: 'Maddi Swanagan', resolved_at: new Date().toISOString() });
    if (auditError) return respond({ error: auditError.message, hours_added: hours }, 500);
    return respond({ ok: true, hours_added: hours, rows_added: rows.length, other_providers_changed: false });
  }
  return new Response(await response.text(), { headers, status: response.status });
});