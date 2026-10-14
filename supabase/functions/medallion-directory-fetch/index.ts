/**
 * medallion-directory-fetch (deployed to the scheduling/ClinOps backend, where
 * MEDALLION_API_KEY lives). READ-ONLY: issues GET requests to Medallion only and
 * writes nothing. Returns normalized, non-PII directory fields to the caller
 * (the main app's sync-medallion-directory function).
 *
 * Auth: caller must send the ClinOps service-role key as Bearer token.
 *
 * Query params:
 *   mode=verify&ids=a,b   counts per employment_status + lookup of known IDs
 *   mode=full             all providers (every employment_status), details,
 *                         licenses, collaborative agreements
 *   mode=provider&id=X    one provider: detail, licenses, agreements
 *
 * Every entity reports ok/failed separately so the caller can distinguish
 * "not returned", "empty" and "failed to retrieve".
 */

const BASE = (Deno.env.get('MEDALLION_API_BASE_URL') ?? 'https://api.medallion.co').replace(/\/+$/, '');
const EMPLOYMENT_STATUSES = ['active', 'inactive', 'onboarding'];
type J = Record<string, any>;

let calls = 0;
let lastCall = 0;

async function get(path: string): Promise<{ status: number; body: any; error?: string }> {
  const key = Deno.env.get('MEDALLION_API_KEY');
  if (!key) return { status: 0, body: null, error: 'MEDALLION_API_KEY is not set' };
  const org = Deno.env.get('MEDALLION_ORGANIZATION_ID');
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Stay well under 240 req/min (≈ 3.3/s).
    const wait = 300 - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    calls++;
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          'x-api-key': key,
          ...(org ? { 'X-Medallion-Organization-Id': org } : {}),
        },
      });
      if (res.status === 429) {
        const s = Number(res.headers.get('retry-after') ?? '5');
        await new Promise((r) => setTimeout(r, Math.min(Math.max(s, 1), 60) * 1000));
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      let body: any = null;
      try { body = await res.json(); } catch { /* non-JSON */ }
      return { status: res.status, body, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      if (attempt >= 2) return { status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { status: 429, body: null, error: 'Rate limited by Medallion after retries' };
}

function rows(b: any): J[] {
  if (Array.isArray(b)) return b;
  return b?.results ?? b?.data ?? b?.items ?? [];
}

async function getAll(path: string): Promise<{ ok: boolean; rows: J[]; pages: number; count: number | null; error?: string }> {
  const out: J[] = [];
  let next: string | null = path;
  let pages = 0;
  let count: number | null = null;
  while (next) {
    if (pages >= 200) return { ok: false, rows: out, pages, count, error: 'pagination exceeded 200 pages' };
    const r = await get(next);
    pages++;
    if (r.error) return { ok: false, rows: out, pages, count, error: r.error };
    if (pages === 1 && typeof r.body?.count === 'number') count = r.body.count;
    out.push(...rows(r.body));
    next = r.body?.next ? new URL(r.body.next, BASE).toString() : null;
  }
  return { ok: true, rows: out, pages, count };
}

const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && String(v).trim() ? String(v).trim() : null;
const d = (v: unknown) => { const x = s(v); return x ? x.slice(0, 10) : null; };

function langList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((x) => typeof x === 'string' ? x : s(x?.name) ?? s(x?.language) ?? s(x?.label) ?? s(x?.value))
    .filter((x): x is string => !!x);
}

function normProvider(p: J) {
  return {
    medallion_id: s(p.id),
    full_name: s(p.full_name), first_name: s(p.first_name), last_name: s(p.last_name),
    preferred_name: s(p.preferred_name),
    email: s(p.email)?.toLowerCase() ?? null,
    npi: s(p.npi), profession: s(p.profession),
    employment_status: s(p.employment_status), employment_type: s(p.employment_type),
    start_date: d(p.start_date), termination_date: d(p.termination_date),
    primary_specialty: s(p.primary_specialty), secondary_specialty: s(p.secondary_specialty),
    primary_taxonomy: s(p.primary_taxonomy), secondary_taxonomy: s(p.secondary_taxonomy),
    last_updated: s(p.last_updated),
  };
}

async function fetchDetail(id: string) {
  const r = await get(`/api/v1/org/providers/${id}/`);
  if (r.error) return { state: r.status === 404 ? 'not_found' : 'failed', error: r.error };
  const b = r.body ?? {};
  return {
    state: 'ok',
    provider: normProvider(b),
    languages: langList(b.fluent_languages),
    is_prescribing: typeof b.is_prescribing === 'boolean' ? b.is_prescribing : null,
    is_nlc_active: typeof b.is_nlc_active === 'boolean' ? b.is_nlc_active : null,
    has_collab_flag: typeof b.has_collaborative_agreements === 'boolean' ? b.has_collaborative_agreements : null,
  };
}

function normLicense(l: J) {
  return {
    medallion_license_id: s(l.id),
    medallion_provider_id: s(l.provider) ?? s(l.provider_id) ?? s(l.provider?.id),
    state: s(l.state), status: s(l.status)?.toLowerCase() ?? null,
    license_number: s(l.license_number), certificate_type: s(l.certificate_type),
    issue_date: d(l.issue_date), expiration_date: d(l.expiration_date),
    verified: typeof l.verification?.verified === 'boolean' ? l.verification.verified : null,
    rx_authority: s(l.rx_authority),
    using_compact: typeof l.using_compact === 'boolean' ? l.using_compact : null,
    modified: s(l.modified),
  };
}

async function fetchAgreements(id: string) {
  const r = await getAll(`/api/v1/org/providers/${id}/collaborative-agreements/?limit=100`);
  // Medallion returns 404 on child endpoints for inactive providers: that is
  // "not available", not a retrieval failure.
  if (!r.ok) return { state: r.error === 'HTTP 404' ? 'not_available' : 'failed', error: r.error, rows: [] };
  return {
    state: 'ok',
    rows: r.rows.map((a) => ({
      medallion_agreement_id: s(a.id),
      supervisor_name: s(a.name), supervisor_medallion_id: s(a.supervisor_id),
      supervisor_npi: s(a.supervisor_npi), supervisor_profession: s(a.supervisor_profession),
      supervisor_license_number: s(a.license_number),
      state: s(a.supervision_state),
      source_status: s(a.collaborative_agreement_status), agreement_type: s(a.collaborative_agreement_type),
      start_date: d(a.supervision_start_date), end_date: d(a.supervision_end_date),
      document_id: s(a.document?.id), document_title: s(a.document?.title),
    })),
  };
}

// Accept only callers holding this backend's service-role key. The key is
// verified by using it against this backend's own REST API (signature check).
async function isServiceCaller(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (svc && token === svc) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload?.role !== 'service_role') return false;
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/sync_runs?select=id&limit=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (!(await isServiceCaller(req))) return json({ error: 'unauthorized' }, 401);

  calls = 0;
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'full';
  if (!Deno.env.get('MEDALLION_API_KEY')) return json({ ok: false, error: 'MEDALLION_API_KEY is not set on the backend' }, 500);

  if (mode === 'verify') {
    const counts: J = {};
    const unfiltered = await getAll('/api/v1/org/providers/?limit=100');
    counts.unfiltered = { ok: unfiltered.ok, returned: unfiltered.rows.length, error: unfiltered.error };
    const statusOf = new Map<string, string>();
    for (const st of EMPLOYMENT_STATUSES) {
      const r = await getAll(`/api/v1/org/providers/?limit=100&employment_status=${st}`);
      counts[st] = { ok: r.ok, returned: r.rows.length, error: r.error };
      r.rows.forEach((p) => statusOf.set(String(p.id), String(p.employment_status ?? st)));
    }
    const ids = (url.searchParams.get('ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 60);
    const lookups: J[] = [];
    for (const id of ids) {
      const r = await get(`/api/v1/org/providers/${id}/`);
      lookups.push({
        id, http: r.status, in_filtered_lists: statusOf.has(id),
        employment_status: r.body?.employment_status ?? null,
        has_termination_date: !!r.body?.termination_date,
      });
    }
    return json({ ok: true, mode, counts, lookups, calls });
  }

  if (mode === 'provider') {
    const id = s(url.searchParams.get('id'));
    if (!id || !/^[A-Za-z0-9-]{6,64}$/.test(id)) return json({ error: 'valid id required' }, 400);
    const detail = await fetchDetail(id);
    const lic = await getAll(`/api/v1/org/licenses/?limit=100&provider=${id}`);
    const licRows = lic.ok ? lic.rows.map(normLicense).filter((l) => l.medallion_provider_id === id) : [];
    const ag = await fetchAgreements(id);
    return json({
      ok: detail.state === 'ok' && lic.ok && ag.state === 'ok', mode, calls,
      providers: { ok: detail.state === 'ok', error: (detail as J).error, rows: detail.state === 'ok' ? [{ ...(detail as J).provider, detail }] : [], not_found: detail.state === 'not_found' },
      licenses: { ok: lic.ok, error: lic.error, rows: licRows, provider_ids: [id] },
      agreements: { by_provider: { [id]: ag } },
    });
  }

  // full
  const seen = new Map<string, J>();
  const listErrors: string[] = [];
  const listCounts: J = {};
  for (const st of EMPLOYMENT_STATUSES) {
    const r = await getAll(`/api/v1/org/providers/?limit=100&employment_status=${st}`);
    listCounts[st] = r.rows.length;
    if (!r.ok) listErrors.push(`${st}: ${r.error}`);
    for (const p of r.rows) if (p?.id) seen.set(String(p.id), p);
  }
  const providerRows: J[] = [];
  const agreements: J = {};
  let detailFailed = 0;
  let agreementsFailed = 0;
  for (const [id, p] of seen) {
    const detail = await fetchDetail(id);
    if (detail.state === 'failed') detailFailed++;
    providerRows.push({ ...normProvider(p), detail });
    agreements[id] = await fetchAgreements(id);
    if (agreements[id].state === 'failed') agreementsFailed++;
  }
  const lic = await getAll('/api/v1/org/licenses/?limit=100');
  return json({
    ok: listErrors.length === 0 && lic.ok && detailFailed === 0, mode, calls,
    providers: { ok: listErrors.length === 0, error: listErrors.join('; ') || undefined, rows: providerRows, list_counts: listCounts, detail_failed: detailFailed },
    licenses: { ok: lic.ok, error: lic.error, rows: lic.rows.map(normLicense), pages: lic.pages },
    agreements: { by_provider: agreements, failed: agreementsFailed },
  });
});
