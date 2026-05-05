/**
 * sync-homebase-rates
 *
 * Pulls Homebase employees, matches them to active rows in `providers`
 * (by email, then by canonical name with manual overrides), and writes
 * the telehealth hourly rate from `job.roles[]` into `provider_pay_rates`.
 *
 * Scope: only providers whose profession is NP / Physician / MD / DO.
 *
 * Role selection (per matched, in-scope provider):
 *   1. Drop roles named "collaborating" or "supervising" (kills MD review fees).
 *   2. Keep roles whose name matches the profession AND contains "tele".
 *   3. Among those, prefer roles whose name contains "telemedicine" or
 *      "telehealth". Falls back to the first remaining match.
 *   4. If no telehealth role found, fall back to the JOB-level wage_rate
 *      (`emp.job.wage_rate`). In-home and training role rates are never
 *      used as a fallback. Job-level fallback handling:
 *        - rate <= 0                                             -> no_rate
 *        - default_role contains "collaborating"/"supervising"    -> collaborating_default
 *        - 0 < rate <= MAX_REASONABLE_HOURLY                      -> hourly (role='job_default')
 *        - MAX_REASONABLE_HOURLY < rate < MAX_REASONABLE_SALARY   -> annual salary,
 *          divided by SALARY_HOURS_PER_YEAR (2080) to get hourly  (role='job_default')
 *        - rate >= MAX_REASONABLE_SALARY                          -> rate_too_high
 *   5. Providers matched but with no usable rate land in `unrated_matches`
 *      with a `rejected_reason` for manual review.
 *
 * DB source values written to provider_pay_rates.source:
 *   - 'homebase'              : matched a telehealth role
 *   - 'homebase_job_hourly'   : matched job-level hourly wage_rate
 *   - 'homebase_salary_2080'  : converted annual salary (wage_rate / 2080)
 *
 * Rate write logic (per provider+role):
 *   - existing open row, same rate -> no-op
 *   - existing open row, new rate  -> close old (effective_to = yesterday), insert new
 *   - no existing open row         -> insert new
 *
 * Also backfills `providers.homebase_employee_id` when blank.
 *
 * Required secret: HOMEBASE_API_KEY
 *
 * Invoke:  POST /functions/v1/sync-homebase-rates
 *          POST /functions/v1/sync-homebase-rates?dry_run=1   (no writes; preview only)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { HomebaseClient, HBEmployee } from '../_shared/homebaseClient.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const IN_SCOPE_PROFESSIONS = new Set(['NP', 'PHYSICIAN', 'MD', 'DO']);

// Homebase employee name -> provider name in `providers` table.
// Both sides are matched after canonicalization.
const HB_NAME_OVERRIDES: Record<string, string> = {
  'Abiah Grant': 'Abby Grant',
  'Samuel Elias-Ausi': 'Dr. Samuel Elias-Ausi',
  'Nana-Aishatu Adamu': 'Dr. Nana-Aishatu Adamu',
  'Dorcas Omari': 'Dr. Dorcas Omari',
  'Johnathan Hinds': 'Jonathan Hinds',
  'Steve Rutagamara': 'Steve Rutagarama',
  'Ramon Trinidad': 'Ramon Trinidad III',
  'Rickeena Free': 'Rickeenna Free',
  'Van Tu, CRNP': 'Van Tu',
  'Rachel McLeod': 'Rachel McLeod',
  'Kimberly Truong': 'Kimberly Truong',
};

const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const MAX_REASONABLE_HOURLY = 500;
const MAX_REASONABLE_SALARY = 500_000;
const SALARY_HOURS_PER_YEAR = 2080;

type RateSource = 'role' | 'job_hourly' | 'job_salary_converted';
type RejectReason = 'no_rate' | 'rate_too_high' | 'collaborating_default';

type PickOk = {
  ok: true;
  role: string;
  rate: number;
  source: RateSource;
  source_amount?: number; // raw annual salary when source='job_salary_converted'
};
type PickResult = PickOk | { ok: false; reason: RejectReason };

const DB_SOURCE: Record<RateSource, string> = {
  role: 'homebase',
  job_hourly: 'homebase_job_hourly',
  job_salary_converted: 'homebase_salary_2080',
};

function pickRate(emp: HBEmployee, profession: string | null): PickResult {
  const roles = emp.job?.roles ?? [];
  const prof = (profession ?? '').toUpperCase();
  const isNP = prof === 'NP';
  const isMD = prof === 'MD' || prof === 'DO' || prof === 'PHYSICIAN';
  if (!isNP && !isMD) return { ok: false, reason: 'no_rate' };

  const isExcluded = (n: string) => /collaborating|supervising/i.test(n);
  const isProfMatch = (n: string) => {
    if (isNP) return /\bnp\b/i.test(n) || /nurse practitioner/i.test(n);
    return /\b(md|do|physician)\b/i.test(n);
  };

  const candidates = roles.filter((r) =>
    Number(r.wage_rate) > 0 &&
    !isExcluded(r.name) &&
    isProfMatch(r.name) &&
    /tele/i.test(r.name)
  );
  if (candidates.length > 0) {
    const preferred = candidates.find((r) => /telemedicine|telehealth/i.test(r.name));
    const chosen = preferred ?? candidates[0];
    return { ok: true, role: chosen.name, rate: Number(chosen.wage_rate), source: 'role' };
  }

  const jobWage = Number(emp.job?.wage_rate ?? 0);
  const defaultRole = emp.job?.default_role ?? '';
  if (jobWage <= 0) return { ok: false, reason: 'no_rate' };
  if (isExcluded(defaultRole)) return { ok: false, reason: 'collaborating_default' };
  if (jobWage <= MAX_REASONABLE_HOURLY) {
    return { ok: true, role: 'job_default', rate: jobWage, source: 'job_hourly' };
  }
  if (jobWage < MAX_REASONABLE_SALARY) {
    const hourly = Math.round((jobWage / SALARY_HOURS_PER_YEAR) * 100) / 100;
    return {
      ok: true,
      role: 'job_default',
      rate: hourly,
      source: 'job_salary_converted',
      source_amount: jobWage,
    };
  }
  return { ok: false, reason: 'rate_too_high' };
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

  const overrideMap = new Map<string, string>();
  for (const [hb, prov] of Object.entries(HB_NAME_OVERRIDES)) {
    overrideMap.set(canon(hb), canon(prov));
  }

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const counters = {
    locations: 0,
    employees_seen: 0,
    matched: 0,
    out_of_scope: 0,
    rates_inserted: 0,
    rates_unchanged: 0,
    rates_closed: 0,
    homebase_id_backfilled: 0,
    no_rate_found: 0,
  };
  const unmatched: { homebase_id: number; name: string; email: string }[] = [];
  const unratedMatches: {
    provider: string;
    profession: string | null;
    rejected_reason: RejectReason;
    job_wage_rate: number;
    job_wage_type: string | null;
    job_default_role: string | null;
    available_roles: { name: string; wage_rate: number }[];
  }[] = [];
  const ratesPreview: {
    provider: string;
    profession: string | null;
    role: string;
    rate: number;
    source: RateSource;
    source_amount: number | null;
    job_default_role: string | null;
  }[] = [];

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

        const hbCanon = canon(`${emp.first_name} ${emp.last_name}`);
        const lookupCanon = overrideMap.get(hbCanon) ?? hbCanon;

        const provider =
          (emp.email && byEmail.get(emp.email.toLowerCase())) ||
          byName.get(lookupCanon);

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

        if (!IN_SCOPE_PROFESSIONS.has((provider.profession ?? '').toUpperCase())) {
          counters.out_of_scope++;
          continue;
        }

        counters.matched++;

        const pick = pickRate(emp, provider.profession);
        if (!pick.ok) {
          counters.no_rate_found++;
          unratedMatches.push({
            provider: provider.name,
            profession: provider.profession,
            rejected_reason: pick.reason,
            job_wage_rate: Number(emp.job?.wage_rate ?? 0),
            job_wage_type: emp.job?.wage_type ?? null,
            job_default_role: emp.job?.default_role ?? null,
            available_roles: (emp.job?.roles ?? []).map((r) => ({
              name: r.name,
              wage_rate: Number(r.wage_rate),
            })),
          });
          continue;
        }

        ratesPreview.push({
          provider: provider.name,
          profession: provider.profession,
          role: pick.role,
          rate: pick.rate,
          source: pick.source,
          source_amount: pick.source_amount ?? null,
          job_default_role: emp.job?.default_role ?? null,
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
          source: DB_SOURCE[pick.source],
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
        unrated_matches: unratedMatches,
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
