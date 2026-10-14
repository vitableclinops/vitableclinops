/**
 * sync-pcp-coverage — dedicated, read-only refresh of PCP telemedicine
 * coverage for the Provider Directory.
 *
 * Why separate from sync-metabase: the nightly sync-metabase run is killed
 * after its large telemedicine-availability step, so later reports (including
 * question 2940) have not refreshed since June 10. This function only reads.
 *
 * Modes (POST body or query string):
 *   mode=inspect  → returns question 2940's definition + source table fields
 *   mode=refresh  → (default) runs the ID-bearing coverage query and stores a
 *                   snapshot in metabase_raw_exports (report_key
 *                   'pcp_coverage_by_provider_id'). Failure never deletes the
 *                   previous snapshot.
 *
 * Auth: x-sync-secret == SYNC_SECRET, or the service-role bearer (pg_cron).
 * Uses the saved METABASE_USERNAME / METABASE_PASSWORD, server-side only.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};
const METABASE_URL = Deno.env.get('METABASE_URL') ?? 'https://metabase.vitablehealth.com';
const SOURCE_CARD = 2940;
const REPORT_KEY = 'pcp_coverage_by_provider_id';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function mb(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${METABASE_URL}${path}`, {
    ...init,
    headers: { 'X-Metabase-Session': token, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Metabase ${res.status} ${path}: ${text.slice(0, 500)}`);
  const body = JSON.parse(text);
  if (body?.status === 'failed' || body?.error) throw new Error(`Metabase query failed: ${body.error}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const syncSecret = Deno.env.get('SYNC_SECRET');
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('authorization') ?? '';
  let ok = (!!syncSecret && req.headers.get('x-sync-secret') === syncSecret) || auth === `Bearer ${srk}`;
  if (!ok && auth.startsWith('Bearer ')) {
    // Signed-in admins may trigger a refresh from the directory.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, srk);
    const { data: u } = await admin.auth.getUser(auth.slice(7));
    if (u?.user) {
      const { data: isAdmin } = await admin.rpc('has_role', { _user_id: u.user.id, _role: 'admin' });
      ok = isAdmin === true;
    }
  }
  if (!ok) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') body = (await req.json().catch(() => ({}))) ?? {};
  const mode = String(url.searchParams.get('mode') ?? body.mode ?? 'refresh');

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, srk);
  const startedAt = Date.now();
  const { data: run } = await supabase.from('sync_runs')
    .insert({ function_name: 'sync-pcp-coverage', status: 'running', details: { mode } })
    .select('id').single();
  const finish = (status: string, extras: Record<string, unknown>) =>
    run?.id ? supabase.from('sync_runs').update({
      status, finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt, ...extras,
    }).eq('id', run.id) : Promise.resolve();

  try {
    const u = Deno.env.get('METABASE_USERNAME'), p = Deno.env.get('METABASE_PASSWORD');
    if (!u || !p) throw new Error('METABASE_USERNAME / METABASE_PASSWORD not set');
    const session = await mb('', '/api/session', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    const token = session.id as string;

    const card = await mb(token, `/api/card/${SOURCE_CARD}`);
    const dq = card.dataset_query ?? {};

    if (mode === 'tables') {
      // Read-only discovery: list warehouse tables whose name matches a term.
      const term = String(body.term ?? 'provider').toLowerCase();
      const meta = await mb(token, `/api/database/${card.database_id}/metadata?skip_fields=true`);
      const db = await mb(token, `/api/database/${card.database_id}`);
      const tables = (meta.tables ?? []).filter((t: any) => String(t.name).toLowerCase().includes(term))
        .map((t: any) => ({ id: t.id, name: `${t.schema}.${t.name}` }));
      await finish('success', { details: { mode } });
      return json({ engine: db.engine, tables });
    }
    if (mode === 'table') {
      const meta = await mb(token, `/api/table/${Number(body.table_id)}/query_metadata`);
      await finish('success', { details: { mode } });
      return json({ table: `${meta.schema}.${meta.name}`, fields: (meta.fields ?? []).map((f: any) => `${f.id}:${f.name}:${f.base_type}`) });
    }
    if (mode === 'inspect') {
      const tableId = dq?.stages?.[0]?.['source-table'] ?? dq?.query?.['source-table'] ?? card.table_id;
      let fields: unknown = null;
      if (typeof tableId === 'number') {
        const meta = await mb(token, `/api/table/${tableId}/query_metadata`);
        fields = { table: `${meta.schema}.${meta.name}`, description: meta.description,
          fields: (meta.fields ?? []).map((f: any) => ({ id: f.id, name: f.name, type: f.base_type, description: f.description })) };
      }
      const out = { card: { id: card.id, name: card.name, description: card.description, database_id: card.database_id,
        updated_at: card.updated_at, dataset_query: dq, result_metadata: card.result_metadata?.map((c: any) => c.name) }, fields };
      await finish('success', { details: { mode } });
      return json(out);
    }

    // refresh: re-run 2940's own filters but break out by provider ID instead
    // of counting it. Built from the card's MBQL so 2940 itself is unchanged.
    const breakout = body.breakout ?? url.searchParams.get('breakout');
    if (!dq.query || !breakout) throw new Error('ID query not configured: provide breakout field refs');
    const q = structuredClone(dq);
    q.query.breakout = JSON.parse(String(typeof breakout === 'string' ? breakout : JSON.stringify(breakout)));
    delete q.query.aggregation;
    const res = await mb(token, '/api/dataset', { method: 'POST', body: JSON.stringify(q) });
    const cols: string[] = res.data.cols.map((c: any) => c.display_name ?? c.name);
    const rows = (res.data.rows as unknown[][]).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] == null ? null : String(r[i])])));
    if (rows.length === 0) throw new Error('Query returned 0 rows — keeping previous snapshot');
    if (res.data.rows_truncated) throw new Error('Result truncated at 2,000 rows — keeping previous snapshot');
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('metabase_raw_exports').upsert(
      { report_key: REPORT_KEY, pulled_date: today, rows, row_count: rows.length, pulled_at: new Date().toISOString() },
      { onConflict: 'report_key,pulled_date' });
    if (error) throw new Error(error.message);
    await finish('success', { rows_processed: rows.length, details: { mode, cols } });
    return json({ ok: true, rows: rows.length, cols });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish('error', { error_message: msg });
    return json({ ok: false, error: msg }, 502);
  }
});
