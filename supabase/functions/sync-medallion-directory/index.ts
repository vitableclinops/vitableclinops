/**
 * sync-medallion-directory
 *
 * Refreshes the Provider Directory's Medallion data (providers, licenses,
 * collaborative agreements). Medallion is read through the read-only
 * `medallion-directory-fetch` function on the scheduling backend, which holds
 * the Medallion API key.
 *
 * Writes ONLY to medallion_* staging tables + medallion_sync_runs. It never
 * edits or deletes profiles, provider_licenses, collaborative_agreements or
 * documents. Local termination, employment type and agreement workflow stage
 * stay authoritative; differences are recorded as conflicts for review.
 *
 * Body / query:
 *   mode:  'dry_run' | 'apply'            (default 'dry_run')
 *   scope: 'full' | 'provider'            (default 'full')
 *   medallion_id | profile_id             (scope=provider)
 *
 * Auth: admin user JWT, or x-sync-secret header (scheduled runs).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

type J = Record<string, any>;
type Entity = 'providers' | 'licenses' | 'agreements';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '');
const LOCAL_TERMINATED = new Set(['termed', 'terminated']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── Auth ────────────────────────────────────────────────────────────────
  let triggeredBy: string | null = null;
  let triggerSource = 'manual';
  const syncSecret = Deno.env.get('SYNC_SECRET');
  if (syncSecret && req.headers.get('x-sync-secret') === syncSecret) {
    triggerSource = 'scheduled';
  } else {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Sign in required' }, 401);
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ error: 'Sign in required' }, 401);
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', u.user.id);
    if (!(roles ?? []).some((r) => r.role === 'admin')) return json({ error: 'Admins only' }, 403);
    triggeredBy = u.user.id;
  }

  // ── Input ───────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  let body: J = {};
  try { body = await req.json(); } catch { /* empty */ }
  const pick = (k: string) => (body[k] ?? url.searchParams.get(k) ?? undefined) as string | undefined;
  const mode = pick('mode') === 'apply' ? 'apply' : 'dry_run';
  const scope = pick('scope') === 'provider' ? 'provider' : 'full';
  const uuidRe = /^[0-9a-f-]{36}$/i;
  let medallionId = pick('medallion_id');
  const profileIdIn = pick('profile_id');
  if (medallionId && !uuidRe.test(medallionId)) return json({ error: 'Invalid medallion_id' }, 400);
  if (profileIdIn && !uuidRe.test(profileIdIn)) return json({ error: 'Invalid profile_id' }, 400);

  // ── Local profiles ──────────────────────────────────────────────────────
  const { data: profiles, error: pErr } = await admin
    .from('profiles')
    .select('id, full_name, email, npi_number, medallion_id, employment_status, employment_type, primary_specialty, languages')
    .range(0, 9999);
  if (pErr) return json({ error: `Could not read profiles: ${pErr.message}` }, 500);
  const profs = (profiles ?? []) as J[];

  if (scope === 'provider' && !medallionId && profileIdIn) {
    medallionId = profs.find((p) => p.id === profileIdIn)?.medallion_id ?? undefined;
    if (!medallionId) return json({ error: 'This provider is not linked to Medallion yet (no Medallion ID).' }, 400);
  }
  if (scope === 'provider' && !medallionId) return json({ error: 'medallion_id or profile_id required' }, 400);

  // ── Open run rows (one per entity) ──────────────────────────────────────
  const entities: Entity[] = ['providers', 'licenses', 'agreements'];
  const runIds: Record<Entity, string | null> = { providers: null, licenses: null, agreements: null };
  for (const e of entities) {
    const { data } = await admin.from('medallion_sync_runs').insert({
      entity: e, scope, mode, trigger_source: triggerSource, triggered_by: triggeredBy,
      medallion_provider_id: scope === 'provider' ? medallionId : null,
    }).select('id').single();
    runIds[e] = data?.id ?? null;
  }
  const finish = async (e: Entity, status: string, f: J) => {
    if (!runIds[e]) return;
    await admin.from('medallion_sync_runs').update({
      status, finished_at: new Date().toISOString(),
      rows_returned: f.rows_returned ?? 0, rows_written: f.rows_written ?? 0, rows_failed: f.rows_failed ?? 0,
      error_message: f.error_message ?? null, details: f.details ?? {},
    }).eq('id', runIds[e]!);
  };

  // ── Fetch from Medallion (read-only) ────────────────────────────────────
  let payload: J;
  try {
    const qs = scope === 'provider' ? `mode=provider&id=${medallionId}` : 'mode=full';
    const res = await fetch(`${Deno.env.get('CLINOPS_SUPABASE_URL')}/functions/v1/medallion-directory-fetch?${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('CLINOPS_SERVICE_ROLE_KEY')}` },
    });
    payload = await res.json();
    if (!res.ok) throw new Error(payload?.error ?? `Medallion reader returned HTTP ${res.status}`);
  } catch (e) {
    const msg = `Could not reach Medallion: ${e instanceof Error ? e.message : String(e)}`;
    for (const en of entities) await finish(en, 'error', { error_message: msg });
    return json({ ok: false, error: msg }, 502);
  }

  const now = new Date().toISOString();
  const byMedId = new Map<string, J>();
  const byEmail = new Map<string, J[]>();
  const byNpi = new Map<string, J[]>();
  for (const p of profs) {
    if (p.medallion_id) byMedId.set(String(p.medallion_id).trim(), p);
    const em = norm(p.email);
    if (em) byEmail.set(em, [...(byEmail.get(em) ?? []), p]);
    const n = digits(p.npi_number);
    if (n) byNpi.set(n, [...(byNpi.get(n) ?? []), p]);
  }

  // ── Providers ───────────────────────────────────────────────────────────
  const provRows: J[] = [];
  const provMatch = new Map<string, string | null>(); // medallion id -> profile id
  const match = { medallion_id: 0, candidate: 0, ambiguous: 0, unmatched: 0 };
  const conflictCount: Record<string, number> = {};
  const providerBlock = payload.providers ?? {};
  for (const m of (providerBlock.rows ?? []) as J[]) {
    if (!m.medallion_id) continue;
    const detail = m.detail ?? {};
    const src = detail.state === 'ok' && detail.provider ? { ...m, ...detail.provider } : m;
    let profileId: string | null = null;
    let method = 'unmatched';
    let notes: string | null = null;
    const linked = byMedId.get(m.medallion_id);
    if (linked) {
      profileId = linked.id; method = 'medallion_id'; match.medallion_id++;
    } else {
      const cands = new Map<string, J>();
      for (const p of byEmail.get(norm(src.email)) ?? []) cands.set(p.id, p);
      for (const p of byNpi.get(digits(src.npi)) ?? []) cands.set(p.id, p);
      const linkedElsewhere = [...cands.values()].filter((p) => p.medallion_id);
      if (cands.size === 1 && linkedElsewhere.length === 0) {
        method = 'candidate'; match.candidate++;
        const c = [...cands.values()][0];
        notes = `Possible match by email/NPI: ${c.full_name ?? c.id} (${c.id}). Needs review before linking.`;
      } else if (cands.size > 0) {
        method = 'ambiguous'; match.ambiguous++;
        notes = `Multiple or already-linked local records: ${[...cands.values()].map((c) => c.full_name ?? c.id).join(', ')}`;
      } else {
        match.unmatched++;
      }
    }
    provMatch.set(m.medallion_id, profileId);

    // Conflicts (Medallion vs local) — recorded, never auto-applied.
    const conflicts: J[] = [];
    const local = profileId ? profs.find((p) => p.id === profileId) : null;
    if (local) {
      const ms = norm(src.employment_status);
      const ls = norm(local.employment_status);
      if (LOCAL_TERMINATED.has(ls) && ms === 'active') conflicts.push({ field: 'employment_status', local: local.employment_status, medallion: src.employment_status, note: 'Locally terminated; Medallion still active. Local decision kept.' });
      else if (ls === 'active' && ms === 'inactive') conflicts.push({ field: 'employment_status', local: local.employment_status, medallion: src.employment_status, note: 'Medallion marks inactive.' });
      if (src.npi && local.npi_number && digits(src.npi) !== digits(local.npi_number)) conflicts.push({ field: 'npi', local: local.npi_number, medallion: src.npi });
      if (src.email && local.email && norm(src.email) !== norm(local.email)) conflicts.push({ field: 'email', local: local.email, medallion: src.email });
      if (src.full_name && local.full_name && norm(src.full_name) !== norm(local.full_name)) conflicts.push({ field: 'name', local: local.full_name, medallion: src.full_name });
      if (src.primary_specialty && local.primary_specialty && norm(src.primary_specialty) !== norm(local.primary_specialty)) conflicts.push({ field: 'specialty', local: local.primary_specialty, medallion: src.primary_specialty });
      if (src.employment_type && local.employment_type && norm(src.employment_type) !== norm(local.employment_type)) conflicts.push({ field: 'employment_type', local: local.employment_type, medallion: src.employment_type, note: 'Local classification kept.' });
    }
    for (const c of conflicts) conflictCount[c.field] = (conflictCount[c.field] ?? 0) + 1;

    const row: J = {
      medallion_id: m.medallion_id, profile_id: profileId, match_method: method, match_notes: notes,
      full_name: src.full_name, first_name: src.first_name, last_name: src.last_name, preferred_name: src.preferred_name,
      email: src.email, npi: src.npi, profession: src.profession,
      medallion_employment_status: src.employment_status, medallion_employment_type: src.employment_type,
      start_date: src.start_date, termination_date: src.termination_date,
      primary_specialty: src.primary_specialty, secondary_specialty: src.secondary_specialty,
      primary_taxonomy: src.primary_taxonomy, secondary_taxonomy: src.secondary_taxonomy,
      medallion_last_updated: src.last_updated, last_returned_at: now, conflicts, updated_at: now,
    };
    if (detail.state === 'ok') {
      row.detail_state = 'ok';
      row.languages = detail.languages ?? [];
      row.is_prescribing = detail.is_prescribing;
      row.is_nlc_active = detail.is_nlc_active;
      row.has_collab_flag = detail.has_collab_flag;
    } else if (detail.state === 'not_found') {
      row.detail_state = 'not_available'; // Medallion hides details for inactive providers
    } else {
      row.detail_state = 'failed'; // keep previously stored languages etc.
    }
    provRows.push(row);
  }
  const detailFailed = provRows.filter((r) => r.detail_state === 'failed').length;
  let provWritten = 0;
  if (mode === 'apply' && provRows.length) {
    const groups = new Map<string, J[]>();
    for (const r of provRows) {
      const k = Object.keys(r).sort().join(',');
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const g of groups.values()) {
      const { error } = await admin.from('medallion_providers').upsert(g, { onConflict: 'medallion_id' });
      if (error) { providerBlock.ok = false; providerBlock.error = `Save failed: ${error.message}`; break; }
      provWritten += g.length;
    }
  }
  const linkedNotReturned = scope === 'full' && providerBlock.ok
    ? profs.filter((p) => p.medallion_id && !provMatch.has(String(p.medallion_id).trim())).map((p) => p.full_name ?? p.id)
    : [];
  await finish('providers', !providerBlock.ok ? (provRows.length ? 'partial' : 'error') : detailFailed ? 'partial' : 'success', {
    rows_returned: provRows.length, rows_written: provWritten, rows_failed: detailFailed,
    error_message: providerBlock.error ?? (detailFailed ? `${detailFailed} provider detail lookups failed` : null),
    details: {
      list_counts: providerBlock.list_counts, match, conflicts: conflictCount,
      not_returned_linked_profiles: linkedNotReturned,
      by_status: provRows.reduce((a: J, r) => { const k = r.medallion_employment_status ?? 'unknown'; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      detail_not_available: provRows.filter((r) => r.detail_state === 'not_available').length,
    },
  });

  // ── Licenses ────────────────────────────────────────────────────────────
  const licBlock = payload.licenses ?? {};
  const licRows = ((licBlock.rows ?? []) as J[]).filter((l) => l.medallion_license_id && l.state).map((l) => ({
    medallion_license_id: l.medallion_license_id, medallion_provider_id: l.medallion_provider_id,
    profile_id: (l.medallion_provider_id && (provMatch.get(l.medallion_provider_id) ?? byMedId.get(l.medallion_provider_id)?.id)) || null,
    state: l.state, status: l.status, license_number: l.license_number, certificate_type: l.certificate_type,
    issue_date: l.issue_date, expiration_date: l.expiration_date, verified: l.verified,
    rx_authority: l.rx_authority, using_compact: l.using_compact, medallion_modified: l.modified,
    last_returned_at: now, updated_at: now,
  }));
  let licWritten = 0;
  if (mode === 'apply' && licBlock.ok && licRows.length) {
    for (let i = 0; i < licRows.length; i += 500) {
      const { error } = await admin.from('medallion_licenses').upsert(licRows.slice(i, i + 500), { onConflict: 'medallion_license_id' });
      if (error) { licBlock.ok = false; licBlock.error = `Save failed: ${error.message}`; break; }
      licWritten += Math.min(500, licRows.length - i);
    }
  }
  await finish('licenses', licBlock.ok ? 'success' : licRows.length ? 'partial' : 'error', {
    rows_returned: licRows.length, rows_written: licWritten, error_message: licBlock.error ?? null,
    details: {
      unlinked: licRows.filter((l) => !l.profile_id).length,
      by_status: licRows.reduce((a: J, r) => { const k = r.status ?? 'unknown'; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
    },
  });

  // ── Agreements (refreshed per provider, independent of last_updated) ───
  const { data: localAgs } = await admin
    .from('collaborative_agreements')
    .select('id, state_abbreviation, physician_id, provider_id, workflow_status, agreement_providers(provider_id, is_active)');
  const agRows: J[] = [];
  const agStates: Record<string, number> = {};
  let agFailed = 0;
  for (const [mid, blk] of Object.entries((payload.agreements?.by_provider ?? {}) as Record<string, J>)) {
    agStates[blk.state] = (agStates[blk.state] ?? 0) + 1;
    if (blk.state === 'failed') { agFailed++; continue; }
    const profileId = provMatch.get(mid) ?? byMedId.get(mid)?.id ?? null;
    for (const a of (blk.rows ?? []) as J[]) {
      if (!a.medallion_agreement_id) continue;
      let supervisorProfile: string | null = null;
      if (a.supervisor_medallion_id && byMedId.get(a.supervisor_medallion_id)) supervisorProfile = byMedId.get(a.supervisor_medallion_id)!.id;
      else if (a.supervisor_npi && (byNpi.get(digits(a.supervisor_npi)) ?? []).length === 1) supervisorProfile = byNpi.get(digits(a.supervisor_npi))![0].id;
      // Candidate local agreement: same provider + state + supervisor. Never merged.
      let localId: string | null = null;
      let localNotes: string | null = null;
      if (profileId && a.state) {
        const hits = ((localAgs ?? []) as J[]).filter((l) =>
          l.state_abbreviation === a.state &&
          (l.provider_id === profileId || (l.agreement_providers ?? []).some((ap: J) => ap.provider_id === profileId)) &&
          (!supervisorProfile || l.physician_id === supervisorProfile));
        if (hits.length === 1) localId = hits[0].id;
        else if (hits.length > 1) localNotes = `${hits.length} local agreements match provider+state+supervisor; review.`;
      }
      agRows.push({
        medallion_agreement_id: a.medallion_agreement_id, medallion_provider_id: mid, profile_id: profileId,
        supervisor_name: a.supervisor_name, supervisor_medallion_id: a.supervisor_medallion_id,
        supervisor_npi: a.supervisor_npi, supervisor_profession: a.supervisor_profession,
        supervisor_license_number: a.supervisor_license_number, supervisor_profile_id: supervisorProfile,
        state: a.state, source_status: a.source_status, agreement_type: a.agreement_type,
        start_date: a.start_date, end_date: a.end_date, document_id: a.document_id, document_title: a.document_title,
        local_agreement_id: localId, local_match_notes: localNotes, last_returned_at: now, updated_at: now,
      });
    }
  }
  let agWritten = 0;
  let agSaveError: string | null = null;
  if (mode === 'apply' && agRows.length) {
    const { error } = await admin.from('medallion_collab_agreements').upsert(agRows, { onConflict: 'medallion_agreement_id' });
    if (error) agSaveError = `Save failed: ${error.message}`; else agWritten = agRows.length;
  }
  await finish('agreements', agSaveError ? 'error' : agFailed ? 'partial' : 'success', {
    rows_returned: agRows.length, rows_written: agWritten, rows_failed: agFailed,
    error_message: agSaveError ?? (agFailed ? `${agFailed} providers' agreements could not be retrieved` : null),
    details: {
      providers_checked: agStates,
      matched_local: agRows.filter((r) => r.local_agreement_id).length,
      ambiguous_local: agRows.filter((r) => r.local_match_notes).length,
      no_local_match: agRows.filter((r) => r.profile_id && !r.local_agreement_id && !r.local_match_notes).length,
      supervisor_linked: agRows.filter((r) => r.supervisor_profile_id).length,
      by_type: agRows.reduce((acc: J, r) => { const k = r.agreement_type ?? 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
      by_source_status: agRows.reduce((acc: J, r) => { const k = r.source_status ?? 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
    },
  });

  return json({
    ok: providerBlock.ok && licBlock.ok && !detailFailed && !agFailed && !agSaveError,
    mode, scope, medallion_calls: payload.calls,
    providers: { returned: provRows.length, written: provWritten, detail_failed: detailFailed, match, conflicts: conflictCount, not_returned_linked_profiles: linkedNotReturned, error: providerBlock.error ?? null },
    licenses: { returned: licRows.length, written: licWritten, error: licBlock.error ?? null },
    agreements: { returned: agRows.length, written: agWritten, failed_providers: agFailed, error: agSaveError },
  });
});
