/**
 * sync-homebase-rates
 *
 * Pulls Homebase employees, matches them to active rows in `providers`
 * (by email, then by canonical name), and writes the telehealth hourly
 * rate from `job.roles[]` into `provider_pay_rates`.
 *
 * Role selection per provider profession:
 *   NP                    -> role name containing "tele" + "np"
 *   MD / DO / Physician   -> role name containing "tele" + ("md"|"do"|"physician")
 *
 * Rate write logic (per provider+role):
 *   - existing open row, same rate    -> no-op
 *   - existing open row, new rate     -> close old (effective_to = yesterday), insert new
 *   - no existing open row            -> insert new
 *
 * Also backfills `providers.homebase_employee_id` when blank.
 *
 * Required secret: HOMEBASE_API_KEY
 *
 * Invoke:  POST /functions/v1/sync-homebase-rates
 *          POST /functions/v1/sync-homebase-rates?dry_run=1   (no writes; returns preview)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { HomebaseClient, HBEmployee } from '../_shared/homebaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function pickRate(
  emp: HBEmployee,
  profession: string | null,
): { role: string; rate: number } | null {
  const roles = emp.job?.roles ?? [];
  const prof = (profession ?? '').toUpperCase();
  const isNP = prof === 'NP';
  const isMD = prof === 'MD' || prof === 'DO' || prof === 'PHYSICIAN';

  const matches = (name: string): boolean => {
    const n = name.toLowerCase();
    if (!n.includes('tele')) return false;
    if (isNP) return /\bnp\b/.test(n) || n.includes('nurse practitioner');
    if (isMD) return /\b(md|do|physician)\b/.test(n);
    return false;
  };

  const hit = roles.find((r) => matches(r.name) && Number(r.wage_rate) > 0);
  if (hit) return { role: hit.name, rate: Number(hit.wage_rate) };

  if (emp.job?.wage_type?.toLowerCase() === 'hourly' && Number(emp.job.wage_rate) > 0) {
    return { role: emp.job.default_role || 'default', rate: Number(emp.job.wage_rate) };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = Deno.env.get('HOMEBASE_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'HOMEBASE_API_KEY not set' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1';

  const { data: providers, error: provErr } = await supabase
    .from('providers')
    .select('id, name, email, profession, homebase_employee_id')
    .eq('active', true);
  if (provErr) {
    return new Response(JSON.stringify({ error: provErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  type Provider = NonNullable<typeof providers>[number];
  const byEmail = new Map<string, Provider>();
  const byName = new Map<string, Provider>();
  for (const p of providers ?? []) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p);
    byName.set(canon(p.name), p);
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const counters = {
    locations: 0,
    employees_seen: 0,
    matched: 0,
    rates_inserted: 0,
    rates_unchanged: 0,
    rates_closed: 0,
    homebase_id_backfilled: 0,
    no_rate_found: 0,
  };
  const unmatched: { homebase_id: number; name: string; email: string }[] = [];
  const ratesPreview: { provider: string; profession: string | null; role: string; rate: number }[] = [];

  const seenEmployees = new Set<number>();
  const seenProviders = new Set<string>();

  try {
    const hb = new HomebaseClient(apiKey);
    const locations = await hb.listLocations();

    for (const loc of locations) {
      counters.locations++;
      for await (const emp of hb.iterateEmployees(loc.uuid)) {
        if (seenEmployees.has(emp.id)) continue;
        seenEmployees.add(emp.id);
        counters.employees_seen++;

        const provider =
          (emp.email && byEmail.get(emp.email.toLowerCase())) ||
          byName.get(canon(`${emp.first_name} ${emp.last_name}`));

        if (!provider) {
          if (unmatched.length < 50) {
            unmatched.push({
              homebase_id: emp.id,
              name: `${emp.first_name} ${emp.last_name}`,
              email: emp.email || '',
            });
          }
          continue;
        }

        if (seenProviders.has(provider.id)) continue;
        seenProviders.add(provider.id);
        counters.matched++;

        const pick = pickRate(emp, provider.profession);
        if (!pick) {
          counters.no_rate_found++;
          continue;
        }

        ratesPreview.push({
          provider: provider.name,
          profession: provider.profession,
          role: pick.role,
          rate: pick.rate,
        });

        if (dryRun) continue;

        if (!provider.homebase_employee_id) {
          await supabase
            .from('providers')
            .update({ homebase_employee_id: String(emp.id) })
            .eq('id', provider.id);
          counters.homebase_id_backfilled++;
        }

        const { data: openRows } = await supabase
          .from('provider_pay_rates')
          .select('id, hourly_rate')
          .eq('provider_id', provider.id)
          .eq('role', pick.role)
          .is('effective_to', null);

        const open = openRows?.[0];
        if (open && Number(open.hourly_rate) === pick.rate) {
          counters.rates_unchanged++;
          continue;
        }

        if (open) {
          await supabase
            .from('provider_pay_rates')
            .update({ effective_to: yesterday })
            .eq('id', open.id);
          counters.rates_closed++;
        }

        const { error: insErr } = await supabase.from('provider_pay_rates').insert({
          provider_id: provider.id,
          hourly_rate: pick.rate,
          role: pick.role,
          effective_from: today,
          source: 'homebase',
        });
        if (insErr) throw insErr;
        counters.rates_inserted++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        counters,
        unmatched,
        rates_preview: ratesPreview,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message, counters }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
