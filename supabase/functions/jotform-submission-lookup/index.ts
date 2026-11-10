import { createClient } from 'npm:@supabase/supabase-js@2';

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
  const { email } = await req.json();
  if (!['sara.hammond@vitablehealth.com', 'andrea.leffet@vitablehealth.com'].includes(email)) return respond({ error: 'Unsupported source lookup' }, 400);
  const key = Deno.env.get('CLINOPS_SERVICE_ROLE_KEY');
  const url = Deno.env.get('CLINOPS_SUPABASE_URL');
  if (!key || !url) return respond({ error: 'Scheduling source unavailable' }, 503);
  const response = await fetch(`${url}/functions/v1/sync-jotform-submissions?preview_email=${encodeURIComponent(email)}&since=2026-09-01`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'x-source-lookup-key': key, 'Content-Type': 'application/json' }, body: '{}' });
  return new Response(await response.text(), { headers, status: response.status });
});