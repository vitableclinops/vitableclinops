import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { HomebaseClient } from '../_shared/homebaseClient.ts';
import { canonical, isAgency, isProtectedRate, pickRate, uniqueMatch } from './ratePolicy.ts';

const STATUS_KEY = 'latest';
const aliases: Record<string, string> = {
  'Abiah Grant': 'Abby Grant', 'Samuel Elias-Ausi': 'Dr. Samuel Elias-Ausi',
  'Nana-Aishatu Adamu': 'Dr. Nana-Aishatu Adamu', 'Dorcas Omari': 'Dr. Dorcas Omari',
  'Johnathan Hinds': 'Jonathan Hinds', 'Steve Rutagamara': 'Steve Rutagarama',
  'Ramon Trinidad': 'Ramon Trinidad III', 'Rickeena Free': 'Rickeenna Free',
  'Van Tu, CRNP': 'Van Tu',
};
const overrides = new Map(Object.entries(aliases).map(([from, to]) => [canonical(from), canonical(to)]));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
type Provider = { id: string; name: string; email: string | null; profession: string | null; homebase_employee_id: string | null; source: string | null; employment_type: string | null; employment_status: string | null };
type Rate = { id: string; provider_id: string; hourly_rate: number; role: string | null; source: string; effective_from: string; effective_to: string | null };
type Review = { provider_id: string; provider: string; role: string | null; previous_rate: number | null; homebase_rate: number | null; status: string; reason: string };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST'].includes(req.method)) return reply({ error: 'Use GET or POST' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const syncSecret = Deno.env.get('SYNC_SECRET');
  let trustedJob = Boolean(syncSecret && req.headers.get('x-sync-secret') === syncSecret);
  const jobToken = req.headers.get('x-rate-sync-token');
  if (!trustedJob && jobToken && /^[0-9a-f-]{36}$/i.test(jobToken)) {
    const { data } = await admin.from('homebase_rate_sync_state').select('key').eq('key', STATUS_KEY).eq('cron_token', jobToken).maybeSingle();
    trustedJob = Boolean(data);
  }
  if (!trustedJob) {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
    if (!token) return reply({ error: 'Sign in required' }, 401);
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return reply({ error: 'Sign in required' }, 401);
    const { data: roles, error: roleError } = await admin.from('user_roles').select('role').eq('user_id', data.user.id);
    if (roleError || !roles?.some(row => row.role === 'admin')) return reply({ error: 'Rate management access required' }, 403);
  }
  if (req.method === 'GET') {
    const { data, error } = await admin.from('homebase_rate_sync_state').select('value').eq('key', STATUS_KEY).maybeSingle();
    return error ? reply({ error: error.message }, 500) : reply({ rows: [], synced_at: null, ...data?.value });
  }
  const url = new URL(req.url);
  if ([...url.searchParams.keys()].some(key => key !== 'dry_run') || (url.searchParams.has('dry_run') && !['0', '1'].includes(url.searchParams.get('dry_run') ?? ''))) return reply({ error: 'dry_run must be 0 or 1' }, 400);
  let body: unknown;
  try { body = await req.json(); } catch { return reply({ error: 'A JSON object is required' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return reply({ error: 'Send an empty JSON object' }, 400);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const apiKey = Deno.env.get('HOMEBASE_API_KEY');
  const schedulingUrl = Deno.env.get('CLINOPS_SUPABASE_URL');
  const schedulingKey = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
  if (!apiKey || !schedulingUrl || !schedulingKey) return reply({ error: 'Homebase or scheduling connection unavailable' }, 503);
  const db = createClient(schedulingUrl, schedulingKey);
  const rows: Review[] = [];
  const counters = { matched: 0, updated: 0, inserted: 0, unchanged: 0, preserved: 0, unmatched: 0, failed: 0 };
  try {
    const [providerResult, rateResult, mappingResult] = await Promise.all([
      db.from('providers').select('id,name,email,profession,homebase_employee_id,source,employment_type,employment_status').eq('active', true),
      db.from('provider_pay_rates').select('id,provider_id,hourly_rate,role,source,effective_from,effective_to').is('effective_to', null),
      db.from('provider_name_mappings').select('homebase_name,profile_id'),
    ]);
    if (providerResult.error) throw providerResult.error;
    if (rateResult.error) throw rateResult.error;
    if (mappingResult.error) throw mappingResult.error;
    const providers = (providerResult.data as Provider[]).filter(p => !/^(termed|terminated|offboarded)$/i.test(p.employment_status ?? ''));
    const rates = rateResult.data as Rate[];
    const mappings = mappingResult.data ?? [];
    const hb = new HomebaseClient(apiKey);
    const employees = [];
    for (const location of await hb.listLocations()) {
      for await (const employee of hb.iterateEmployees(location.uuid)) employees.push(employee);
    }
    const seen = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);
    for (const employee of employees) {
      if (employee.job?.archived_at) continue;
      const name = canonical(`${employee.first_name} ${employee.last_name}`);
      const idMatches = providers.filter(p => p.homebase_employee_id === String(employee.id));
      const emailMatches = employee.email ? providers.filter(p => p.email?.toLowerCase() === employee.email.toLowerCase()) : [];
      const mapMatches = mappings.filter(m => canonical(m.homebase_name) === name);
      if (idMatches.length > 1 || emailMatches.length > 1 || mapMatches.length > 1 || (idMatches[0] && emailMatches[0] && idMatches[0].id !== emailMatches[0].id)) {
        counters.unmatched++; continue;
      }
      const mapped = uniqueMatch(mappings, m => canonical(m.homebase_name) === name);
      const provider = uniqueMatch(providers, p => p.homebase_employee_id === String(employee.id))
        ?? (employee.email ? uniqueMatch(providers, p => p.email?.toLowerCase() === employee.email.toLowerCase()) : undefined)
        ?? (mapped ? providers.find(p => p.id === mapped.profile_id) : undefined)
        ?? uniqueMatch(providers, p => canonical(p.name) === (overrides.get(name) ?? name));
      if (!provider) { counters.unmatched++; continue; }
      if (provider.homebase_employee_id && provider.homebase_employee_id !== String(employee.id)) { counters.unmatched++; continue; }
      // Conflicting locations are not resolved by encounter order.
      const variants = employees.filter(e => e.id === employee.id && !e.job?.archived_at).map(e => pickRate(e, provider.profession));
      const validRates = new Set(variants.filter(p => p.ok).map(p => p.ok ? p.rate : null));
      if (seen.has(provider.id)) continue;
      seen.add(provider.id);
      counters.matched++;
      const open = rates.filter(r => r.provider_id === provider.id);
      const old = open[0];
      const pick = pickRate(employee, provider.profession);
      const row: Review = { provider_id: provider.id, provider: provider.name, role: pick.ok ? pick.role : null, previous_rate: old ? Number(old.hourly_rate) : null, homebase_rate: pick.ok ? pick.rate : null, status: 'preserved', reason: '' };
      rows.push(row);
      if (isAgency(provider) || open.some(r => isProtectedRate(r.source))) {
        row.reason = isAgency(provider) ? 'Agency rate retained' : 'Manual rate or salary equivalent retained';
        counters.preserved++; continue;
      }
      if (validRates.size > 1 || open.length > 1) {
        row.reason = 'Multiple rates require review'; counters.preserved++; continue;
      }
      if (!pick.ok) { row.reason = pick.reason; counters.preserved++; continue; }
      if (old && old.effective_from > today) { row.reason = 'Future-dated rate retained'; counters.preserved++; continue; }
      if (old && Number(old.hourly_rate) === pick.rate) {
        row.status = 'unchanged'; row.reason = 'Matches Homebase'; counters.unchanged++; continue;
      }
      row.status = old ? 'updated' : 'inserted';
      row.reason = dryRun ? 'Pending sync' : 'Synced from Homebase';
      if (!dryRun) {
        // Preserve historical rows. Same-day corrections update that day's row.
        if (old && old.effective_from === today) {
          const { error } = await db.from('provider_pay_rates').update({ hourly_rate: pick.rate, source: pick.source }).eq('id', old.id).is('effective_to', null);
          if (error) throw error;
        } else {
          if (old) {
            const { data: closed, error } = await db.from('provider_pay_rates').update({ effective_to: today }).eq('id', old.id).is('effective_to', null).select('id');
            if (error) throw error;
            if (!closed?.length) throw new Error('Rate changed during sync; refresh and try again');
          }
          const { error } = await db.from('provider_pay_rates').insert({ provider_id: provider.id, hourly_rate: pick.rate, role: old?.role ?? pick.role, effective_from: today, source: pick.source });
          if (error) {
            if (old) {
              const restored = await db.from('provider_pay_rates').update({ effective_to: null }).eq('id', old.id).eq('effective_to', today);
              if (restored.error) throw new Error(`${error.message}; restoring prior rate failed: ${restored.error.message}`);
            }
            throw error;
          }
        }
      }
      if (old) counters.updated++; else counters.inserted++;
    }
    const result = { ok: true, dry_run: dryRun, synced_at: new Date().toISOString(), counters, rows };
    if (!dryRun) {
      const { error } = await admin.from('homebase_rate_sync_state').update({ value: result, updated_at: result.synced_at }).eq('key', STATUS_KEY);
      if (error) throw error;
    }
    return reply(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: string }).message ?? error);
    console.error('Homebase rate sync failed:', message);
    return reply({ error: message, counters, rows }, 500);
  }
});
