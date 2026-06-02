/**
 * compute-daily-coverage-routing edge function
 *
 * Deterministic same-day / next-day coverage router. Defaults to today +
 * tomorrow in America/Chicago. Hours are the canonical unit.
 *
 * Sources
 *   - Homebase scheduled shifts            → homebase_shifts + homebase_employees (Supabase)
 *   - Provider licensure / scope           → v_provider_state_eligibility (ClinOps providers.id space)
 *   - Active / EHR-live provider-state     → v_provider_state_eligibility.allocation_eligible = true
 *   - Active states                        → state_activation
 *   - Daily state demand (hours)           → Metabase card METABASE_DAILY_DEMAND_CARD_ID (default 3478)
 *                                            fallback → demand_forecast (daily) → state_demand_targets
 *   - Daily booked appointments            → Metabase card METABASE_DAILY_BOOKED_CARD_ID (default 3479)
 *   - Add candidates (outreach)            → schedule_submissions (Jotform availability),
 *                                            provider_utilization_daily (low utilization)
 *
 * The allocator (`_shared/dailyCoverageRouting.ts`) locks booked appointments
 * first, allocates remaining confirmed capacity greedily, then computes
 * tentative licensed-only upside separately. Status is confirmed-only:
 *   OK >= 100%, LOW 50-99%, CRITICAL < 50%, ZERO = 0, NO DATA = missing demand.
 *
 * This routed path is intentionally separate from the legacy
 * state_leftover_slots forecast path.
 *
 * Modes:
 *   POST { dry_run?: bool, date?: "YYYY-MM-DD", dates?: string[], run_label?: string }
 *   ?dry_run=1 / ?date=YYYY-MM-DD also supported as query params.
 *
 * Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional secrets: METABASE_USERNAME, METABASE_PASSWORD (for daily cards),
 *   METABASE_DAILY_DEMAND_CARD_ID, METABASE_DAILY_BOOKED_CARD_ID.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { toAbbreviation } from '../_shared/stateNormalization.ts';
import {
  routeDailyCoverage,
  type RoutingInput,
  type RoutingResult,
  type RoutingProviderInput,
  type RoutingAddCandidateInput,
} from '../_shared/dailyCoverageRouting.ts';

const METABASE_URL = 'https://metabase.vitablehealth.com';
const DAILY_DEMAND_CARD = Number(Deno.env.get('METABASE_DAILY_DEMAND_CARD_ID') ?? '3478');
const DAILY_BOOKED_CARD = Number(Deno.env.get('METABASE_DAILY_BOOKED_CARD_ID') ?? '3479');
const LOW_UTILIZATION_THRESHOLD = Number(Deno.env.get('SD_ND_LOW_UTIL_THRESHOLD') ?? '50');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};

type SupabaseClient = ReturnType<typeof createClient>;
type Row = Record<string, string>;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }

  const dryRun = body?.dry_run === true || url.searchParams.get('dry_run') === '1';
  const runLabel = typeof body?.run_label === 'string' ? (body.run_label as string) : 'manual';

  // ── Resolve target dates (default today + tomorrow, America/Chicago) ──────
  const targetDates = resolveTargetDates(body, url);
  if (targetDates.length === 0) {
    return json({ error: 'No valid target dates' }, 400);
  }
  const months = Array.from(new Set(targetDates.map(monthStartOf)));

  try {
    // ── Metabase daily cards (best-effort; fall back if unavailable) ────────
    let demandByDateState = new Map<string, Map<string, number>>(); // date → state → hours
    const bookedRowsByDate = new Map<string, ParsedBookedRow[]>();
    let demandCardOk = false;
    let bookedCardOk = false;
    const metabaseUser = Deno.env.get('METABASE_USERNAME');
    const metabasePass = Deno.env.get('METABASE_PASSWORD');
    if (metabaseUser && metabasePass) {
      try {
        const token = await getMetabaseToken(metabaseUser, metabasePass);
        const [demandCsv, bookedCsv] = await Promise.all([
          downloadCardCsvSafe(token, DAILY_DEMAND_CARD),
          downloadCardCsvSafe(token, DAILY_BOOKED_CARD),
        ]);
        const parsedDemand = parseDailyDemandCard(demandCsv, targetDates);
        if (parsedDemand.size > 0) { demandByDateState = parsedDemand; demandCardOk = true; }
        const parsedBooked = parseDailyBookedCard(bookedCsv, targetDates);
        if (parsedBooked.ok) {
          bookedCardOk = true;
          for (const r of parsedBooked.rows) {
            if (!bookedRowsByDate.has(r.date)) bookedRowsByDate.set(r.date, []);
            bookedRowsByDate.get(r.date)!.push(r);
          }
        }
      } catch (e) {
        console.warn('Metabase pull failed; using fallbacks:', e instanceof Error ? e.message : String(e));
      }
    } else {
      console.warn('METABASE_USERNAME/PASSWORD not set; using demand fallbacks and no booked locks.');
    }

    // ── Supabase sources ─────────────────────────────────────────────────────
    const [activationsRes, providersRes, eligibilityRes, forecastRes, targetsRes, utilRes, submissionsRes] =
      await Promise.all([
        supabase.from('state_activation').select('state_abbreviation, is_active'),
        supabase.from('providers').select('id, name, profession, active, employment_status').range(0, 49999),
        supabase.from('v_provider_state_eligibility').select('provider_id, state, allocation_eligible').range(0, 49999),
        // demand_forecast is daily (date/state/is_baseline/projected_visits) per
        // the canonical compute-demand-forecast producer; types.ts is stale here.
        supabase.from('demand_forecast').select('date, state, projected_visits, is_baseline').in('date', targetDates).eq('is_baseline', true).range(0, 49999),
        supabase.from('state_demand_targets').select('state, month, daily_target_hours, monthly_hours_target').in('month', months),
        // Historical deployments have used both util_date/provider_name and
        // date/provider_id shapes; selecting * lets the parser below tolerate
        // either without blocking the launch path.
        supabase.from('provider_utilization_daily').select('*').range(0, 49999),
        supabase.from('schedule_submissions').select('provider_id, provider_name, target_month, accepted_hours, decision_status').in('target_month', months).in('decision_status', ['accepted', 'partial']).range(0, 49999),
      ]);

    const activeStates = new Set<string>(
      (activationsRes.data ?? []).filter((a) => a.is_active).map((a) => String(a.state_abbreviation).toUpperCase()),
    );
    if (activationsRes.error) {
      console.warn('state_activation load failed; will derive active states from demand sources:', activationsRes.error.message);
    }

    // Provider index. The allocator's field is still named profile_id for
    // backward compatibility, but these values are ClinOps providers.id.
    const providerById = new Map<string, { name: string | null; profession: string | null; active: boolean }>();
    const providerIdByNormName = new Map<string, string>();
    for (const p of providersRes.data ?? []) {
      const employmentStatus = String(p.employment_status ?? 'active').toLowerCase();
      const active = p.active !== false && employmentStatus !== 'inactive' && employmentStatus !== 'terminated';
      providerById.set(p.id, { name: p.name, profession: p.profession, active });
      if (p.name) providerIdByNormName.set(normName(p.name), p.id);
    }
    if (providersRes.error) {
      console.warn('providers load failed:', providersRes.error.message);
    }

    const licensedByProvider = new Map<string, Set<string>>();
    const ehrActiveByProvider = new Map<string, Set<string>>();
    for (const e of eligibilityRes.data ?? []) {
      if (!e.provider_id || !e.state) continue;
      const providerId = String(e.provider_id);
      const st = String(e.state).toUpperCase();
      if (!licensedByProvider.has(providerId)) licensedByProvider.set(providerId, new Set());
      licensedByProvider.get(providerId)!.add(st);
      if (e.allocation_eligible === true) {
        if (!ehrActiveByProvider.has(providerId)) ehrActiveByProvider.set(providerId, new Set());
        ehrActiveByProvider.get(providerId)!.add(st);
      }
    }
    if (eligibilityRes.error) {
      console.warn('v_provider_state_eligibility load failed:', eligibilityRes.error.message);
    }

    // Demand fallbacks
    const forecastDaily = new Map<string, number>(); // `${date}|${state}` → hours
    for (const r of forecastRes.data ?? []) {
      const date = String((r as Record<string, unknown>).date);
      const st = String((r as Record<string, unknown>).state ?? '').toUpperCase();
      const hrs = Number((r as Record<string, unknown>).projected_visits ?? 0);
      if (date && st && Number.isFinite(hrs)) forecastDaily.set(`${date}|${st}`, hrs);
    }
    if (forecastRes.error) {
      console.warn('demand_forecast fallback load failed:', forecastRes.error.message);
    }
    const targetsDaily = new Map<string, number>(); // `${month}|${state}` → daily hours
    for (const r of targetsRes.data ?? []) {
      const month = String((r as Record<string, unknown>).month);
      const st = String((r as Record<string, unknown>).state ?? '').toUpperCase();
      const daily = Number((r as Record<string, unknown>).daily_target_hours ?? NaN);
      if (st && Number.isFinite(daily)) targetsDaily.set(`${month}|${st}`, daily);
    }
    if (targetsRes.error) {
      console.warn('state_demand_targets fallback load failed:', targetsRes.error.message);
    }
    if (activeStates.size === 0) {
      for (const states of demandByDateState.values()) {
        for (const st of states.keys()) activeStates.add(st);
      }
      for (const key of forecastDaily.keys()) activeStates.add(key.split('|')[1]);
      for (const key of targetsDaily.keys()) activeStates.add(key.split('|')[1]);
    }

    // Homebase shifts → per (date, provider) scheduled hours, plus unmatched.
    const { shiftsByDateProfile, unmatchedByDate } = await loadHomebaseShifts(supabase, targetDates);

    // Latest utilization per provider name (supports both legacy and ClinOps
    // provider_utilization_daily schemas).
    const latestUtilByName = new Map<string, { util_date: string; pct: number }>();
    for (const u of utilRes.data ?? []) {
      const row = u as Record<string, unknown>;
      const providerId = typeof row.provider_id === 'string' ? row.provider_id : null;
      const rawName = typeof row.provider_name === 'string'
        ? row.provider_name
        : providerId
        ? providerById.get(providerId)?.name ?? ''
        : '';
      const name = rawName ? normName(rawName) : '';
      if (!name) continue;
      const date = String(row.util_date ?? row.date ?? '');
      if (!date || date < addDays(targetDates[0], -14)) continue;
      const pct = Number(row.utilization_pct ?? NaN);
      if (!Number.isFinite(pct)) continue;
      const prev = latestUtilByName.get(name);
      if (!prev || date > prev.util_date) latestUtilByName.set(name, { util_date: date, pct });
    }
    if (utilRes.error) {
      console.warn('provider_utilization_daily load failed; low-utilization adds may be omitted:', utilRes.error.message);
    }

    // Jotform availability hours per provider (by month)
    const availabilityByProviderMonth = new Map<string, number>(); // `${month}|${providerId}` → hours
    const availabilityByNameMonth = new Map<string, number>(); // `${month}|${normName}` → hours
    for (const s of submissionsRes.data ?? []) {
      if (!s.target_month) continue;
      const hrs = Number(s.accepted_hours ?? 0);
      if (!Number.isFinite(hrs) || hrs <= 0) continue;
      if (s.provider_id) {
        const key = `${String(s.target_month)}|${String(s.provider_id)}`;
        availabilityByProviderMonth.set(key, Math.max(availabilityByProviderMonth.get(key) ?? 0, hrs));
      } else if (s.provider_name) {
        const key = `${String(s.target_month)}|${normName(String(s.provider_name))}`;
        availabilityByNameMonth.set(key, Math.max(availabilityByNameMonth.get(key) ?? 0, hrs));
      }
    }
    if (submissionsRes.error) {
      console.warn('schedule_submissions load failed; Jotform adds may be omitted:', submissionsRes.error.message);
    }

    // ── Route each date ──────────────────────────────────────────────────────
    const resolvedDemandSource: string[] = [];
    const perDate: Array<{ date: string; result: RoutingResult; resolvedDemand: ResolvedDemand[] }> = [];

    for (const date of targetDates) {
      const month = monthStartOf(date);
      const cardDemand = demandByDateState.get(date) ?? new Map<string, number>();

      // Resolve demand per active state (card → forecast → targets → null).
      const resolvedDemand: ResolvedDemand[] = [];
      for (const st of [...activeStates].sort()) {
        let hours: number | null = null;
        let source = 'none';
        if (cardDemand.has(st)) { hours = cardDemand.get(st)!; source = 'daily_card'; }
        else if (forecastDaily.has(`${date}|${st}`)) { hours = forecastDaily.get(`${date}|${st}`)!; source = 'demand_forecast_fallback'; }
        else if (targetsDaily.has(`${month}|${st}`)) { hours = targetsDaily.get(`${month}|${st}`)!; source = 'state_demand_targets_fallback'; }
        resolvedDemand.push({ state: st, demand_hours: hours, source });
      }

      // Scheduled providers on this date.
      const shiftMap = shiftsByDateProfile.get(date) ?? new Map<string, number>();
      const providersInput: RoutingProviderInput[] = [];
      const scheduledProfileIds = new Set<string>();
      for (const [profileId, hours] of shiftMap) {
        const prof = providerById.get(profileId);
        if (!prof) continue;
        scheduledProfileIds.add(profileId);
        providersInput.push({
          profile_id: profileId,
          name: prof.name ?? 'Unknown',
          profession: prof.profession,
          scheduled_hours: hours,
          licensed_states: Array.from(licensedByProvider.get(profileId) ?? []),
          ehr_active_states: Array.from(ehrActiveByProvider.get(profileId) ?? []),
        });
      }

      // Booked rows for this date, matched to providers by name.
      const bookedInput = (bookedRowsByDate.get(date) ?? []).map((b) => {
        const profileId = providerIdByNormName.get(normName(b.provider_name)) ?? null;
        return {
          profile_id: profileId,
          provider_name: b.provider_name,
          state: b.state,
          appointment_count: b.appointment_count,
          booked_hours: b.booked_hours,
        };
      });

      // Add candidates: Jotform-available + low-utilization providers NOT
      // scheduled today, eligible in a state with a residual gap.
      const addCandidates = buildAddCandidates({
        month,
        scheduledProfileIds,
        providerById,
        providerIdByNormName,
        licensedByProvider,
        ehrActiveByProvider,
        availabilityByProviderMonth,
        availabilityByNameMonth,
        latestUtilByName,
      });

      const input: RoutingInput = {
        date,
        demand: resolvedDemand.map((d) => ({ state: d.state, demand_hours: d.demand_hours, source: d.source })),
        providers: providersInput,
        booked: bookedInput,
        unmatchedShifts: unmatchedByDate.get(date) ?? [],
        addCandidates,
      };

      const result = routeDailyCoverage(input);
      perDate.push({ date, result, resolvedDemand });
      const usedCard = resolvedDemand.some((d) => d.source === 'daily_card');
      resolvedDemandSource.push(usedCard ? 'daily_card' : 'fallback');
    }

    const demandSourceLabel = demandCardOk && resolvedDemandSource.includes('daily_card')
      ? 'daily_card'
      : resolvedDemandSource.every((s) => s === 'fallback')
      ? 'fallback'
      : 'mixed';
    const bookedSourceLabel = bookedCardOk ? 'daily_card' : 'unavailable';

    const runTotals = {
      dates: targetDates,
      per_date: perDate.map(({ date, result }) => ({ date, ...result.totals })),
      demand_card_ok: demandCardOk,
      booked_card_ok: bookedCardOk,
    };

    // ── Persist (unless dry run) ─────────────────────────────────────────────
    let runId: string | null = null;
    if (!dryRun) {
      runId = await persistRun(supabase, {
        runLabel,
        targetDates,
        demandSourceLabel,
        bookedSourceLabel,
        runTotals,
        params: { daily_demand_card: DAILY_DEMAND_CARD, daily_booked_card: DAILY_BOOKED_CARD },
        perDate,
      });
    }

    return json({
      ok: true,
      run_id: runId,
      dry_run: dryRun,
      dates: targetDates,
      demand_source: demandSourceLabel,
      booked_source: bookedSourceLabel,
      results: perDate.map(({ date, result }) => ({
        date,
        totals: result.totals,
        state_coverage: result.stateCoverage,
        provider_assignments: result.providerAssignments,
        booked_locks: result.bookedLocks,
        moves: result.moves,
        adds: result.adds,
        warnings: result.warnings,
      })),
    });
  } catch (err) {
    console.error('compute-daily-coverage-routing error:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ── Date helpers ────────────────────────────────────────────────────────────
function getChicagoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function chicagoDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthStartOf(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}
function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function resolveTargetDates(body: Record<string, unknown>, url: URL): string[] {
  const out: string[] = [];
  if (Array.isArray(body?.dates)) {
    for (const d of body.dates) if (isIsoDate(d)) out.push(d);
  }
  const single = (typeof body?.date === 'string' ? body.date : null) ?? url.searchParams.get('date');
  if (isIsoDate(single)) out.push(single);
  if (out.length === 0) {
    const today = getChicagoDate();
    out.push(today, addDays(today, 1));
  }
  return Array.from(new Set(out)).sort();
}

// ── Homebase ────────────────────────────────────────────────────────────────
type UnmatchedShift = { name: string; scheduled_hours: number };
async function loadHomebaseShifts(supabase: SupabaseClient, targetDates: string[]) {
  const shiftsByDateProfile = new Map<string, Map<string, number>>();
  const unmatchedByDate = new Map<string, UnmatchedShift[]>();
  for (const d of targetDates) { shiftsByDateProfile.set(d, new Map()); unmatchedByDate.set(d, []); }

  // Generous UTC window covering all CT target dates.
  const lowerUtc = new Date(targetDates[0] + 'T00:00:00-06:00').toISOString();
  const upperUtc = new Date(addDays(targetDates[targetDates.length - 1], 1) + 'T06:00:00Z').toISOString();

  const { data: shifts } = await supabase
    .from('homebase_shifts')
    .select('homebase_employee_id, start_at, end_at, scheduled, scheduled_hours')
    .gte('start_at', lowerUtc)
    .lte('start_at', upperUtc)
    .range(0, 49999);

  const empIds = Array.from(new Set((shifts ?? []).map((s) => s.homebase_employee_id).filter(Boolean) as string[]));
  const profileByEmp = new Map<string, string | null>();
  const nameByEmp = new Map<string, string>();
  if (empIds.length > 0) {
    const { data: emps } = await supabase
      .from('homebase_employees')
      .select('id, profile_id, first_name, last_name')
      .in('id', empIds);
    for (const e of emps ?? []) {
      profileByEmp.set(e.id, e.profile_id);
      nameByEmp.set(e.id, `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Unknown');
    }
  }

  for (const sh of shifts ?? []) {
    if (sh.scheduled === false || !sh.start_at) continue;
    const date = chicagoDateOf(sh.start_at);
    if (!shiftsByDateProfile.has(date)) continue; // outside target dates
    const hours = shiftHours(sh.start_at, sh.end_at, sh.scheduled_hours);
    if (hours <= 0) continue;
    const profileId = sh.homebase_employee_id ? profileByEmp.get(sh.homebase_employee_id) ?? null : null;
    if (profileId) {
      const m = shiftsByDateProfile.get(date)!;
      m.set(profileId, round2((m.get(profileId) ?? 0) + hours));
    } else {
      const name = sh.homebase_employee_id ? nameByEmp.get(sh.homebase_employee_id) ?? 'Unknown' : 'Unknown';
      unmatchedByDate.get(date)!.push({ name, scheduled_hours: round2(hours) });
    }
  }
  return { shiftsByDateProfile, unmatchedByDate };
}

function shiftHours(startIso: string, endIso: string | null, scheduledHours: number | null): number {
  if (scheduledHours != null && Number.isFinite(scheduledHours) && scheduledHours > 0) return scheduledHours;
  if (!endIso) return 0;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return round2(ms / 3_600_000);
}

// ── Add candidates (outreach) ────────────────────────────────────────────────
type AddCandidateCtx = {
  month: string;
  scheduledProfileIds: Set<string>;
  providerById: Map<string, { name: string | null; profession: string | null; active: boolean }>;
  providerIdByNormName: Map<string, string>;
  licensedByProvider: Map<string, Set<string>>;
  ehrActiveByProvider: Map<string, Set<string>>;
  availabilityByProviderMonth: Map<string, number>;
  availabilityByNameMonth: Map<string, number>;
  latestUtilByName: Map<string, { util_date: string; pct: number }>;
};
function buildAddCandidates(ctx: AddCandidateCtx): RoutingAddCandidateInput[] {
  const out = new Map<string, RoutingAddCandidateInput>();

  // Jotform availability: providers who submitted availability for the month.
  for (const [key, hours] of ctx.availabilityByProviderMonth) {
    const [month, providerId] = key.split('|');
    if (month !== ctx.month || !providerId || ctx.scheduledProfileIds.has(providerId)) continue;
    const prof = ctx.providerById.get(providerId);
    if (!prof || !prof.active) continue;
    const licensed = Array.from(ctx.licensedByProvider.get(providerId) ?? []);
    if (licensed.length === 0) continue;
    out.set(providerId, {
      profile_id: providerId,
      name: prof.name ?? 'Unknown',
      profession: prof.profession,
      available_hours: round2(hours),
      licensed_states: licensed,
      ehr_active_states: Array.from(ctx.ehrActiveByProvider.get(providerId) ?? []),
      source: 'jotform_availability',
    });
  }

  // Legacy fallback for older rows that only have provider_name.
  for (const [key, hours] of ctx.availabilityByNameMonth) {
    const [month, normedName] = key.split('|');
    if (month !== ctx.month) continue;
    const profileId = ctx.providerIdByNormName.get(normedName);
    if (!profileId || ctx.scheduledProfileIds.has(profileId) || out.has(profileId)) continue;
    const prof = ctx.providerById.get(profileId);
    if (!prof || !prof.active) continue;
    const licensed = Array.from(ctx.licensedByProvider.get(profileId) ?? []);
    if (licensed.length === 0) continue;
    out.set(profileId, {
      profile_id: profileId,
      name: prof.name ?? 'Unknown',
      profession: prof.profession,
      available_hours: round2(hours),
      licensed_states: licensed,
      ehr_active_states: Array.from(ctx.ehrActiveByProvider.get(profileId) ?? []),
      source: 'jotform_availability',
    });
  }

  // Low-utilization providers (not already added via Jotform).
  for (const [normedName, util] of ctx.latestUtilByName) {
    if (util.pct > LOW_UTILIZATION_THRESHOLD) continue;
    const profileId = ctx.providerIdByNormName.get(normedName);
    if (!profileId || ctx.scheduledProfileIds.has(profileId) || out.has(profileId)) continue;
    const prof = ctx.providerById.get(profileId);
    if (!prof || !prof.active) continue;
    const licensed = Array.from(ctx.licensedByProvider.get(profileId) ?? []);
    if (licensed.length === 0) continue;
    out.set(profileId, {
      profile_id: profileId,
      name: prof.name ?? 'Unknown',
      profession: prof.profession,
      available_hours: null,
      licensed_states: licensed,
      ehr_active_states: Array.from(ctx.ehrActiveByProvider.get(profileId) ?? []),
      source: 'low_utilization',
      utilization_pct: util.pct,
    });
  }

  return Array.from(out.values());
}

// ── Persistence ──────────────────────────────────────────────────────────────
type ResolvedDemand = { state: string; demand_hours: number | null; source: string };
async function persistRun(
  supabase: SupabaseClient,
  args: {
    runLabel: string;
    targetDates: string[];
    demandSourceLabel: string;
    bookedSourceLabel: string;
    runTotals: unknown;
    params: Record<string, unknown>;
    perDate: Array<{ date: string; result: RoutingResult; resolvedDemand: ResolvedDemand[] }>;
  },
): Promise<string> {
  const nowIso = new Date().toISOString();
  const { data: runRow, error: runErr } = await supabase
    .from('daily_coverage_routing_runs')
    .insert({
      generated_at: nowIso,
      run_label: args.runLabel,
      coverage_dates: args.targetDates,
      demand_source: args.demandSourceLabel,
      booked_source: args.bookedSourceLabel,
      dry_run: false,
      status: 'success',
      totals: args.runTotals,
      params: args.params,
    })
    .select('id')
    .single();
  if (runErr || !runRow) throw new Error(`routing run insert failed: ${runErr?.message}`);
  const runId = runRow.id as string;

  const stateRows: Record<string, unknown>[] = [];
  const assignmentRows: Record<string, unknown>[] = [];
  const lockRows: Record<string, unknown>[] = [];
  const recRows: Record<string, unknown>[] = [];
  const dqRows: Record<string, unknown>[] = [];
  const demandIngest: Record<string, unknown>[] = [];
  const bookedIngest: Record<string, unknown>[] = [];

  for (const { date, result, resolvedDemand } of args.perDate) {
    for (const r of result.stateCoverage) {
      stateRows.push({ run_id: runId, coverage_date: date, ...r });
    }
    for (const a of result.providerAssignments) {
      assignmentRows.push({
        run_id: runId, coverage_date: date, profile_id: a.profile_id, provider_name: a.name,
        profession: a.profession, scheduled_hours: a.scheduled_hours, booked_locked_hours: a.booked_locked_hours,
        assignments: a.assignments, unassigned_free_hours: a.unassigned_free_hours,
      });
    }
    for (const l of result.bookedLocks) {
      lockRows.push({ run_id: runId, coverage_date: date, profile_id: l.profile_id, provider_name: l.provider_name, state: l.state, hours: l.hours, source: l.source, matched: l.matched });
    }
    for (const m of result.moves) {
      recRows.push({ run_id: runId, coverage_date: date, kind: 'move', state: m.state, profile_id: m.profile_id, provider_name: m.name, hours: m.hours, tentative: false });
    }
    for (const a of result.adds) {
      recRows.push({ run_id: runId, coverage_date: date, kind: 'add', state: a.state, profile_id: a.profile_id, provider_name: a.name, hours: a.available_hours, gap_hours: a.gap_hours, source: a.source, tentative: a.tentative, utilization_pct: a.utilization_pct });
    }
    for (const w of result.warnings) {
      dqRows.push({ run_id: runId, coverage_date: date, warning_type: w.type, state: w.state, detail: w.detail, hours: w.hours });
    }
    for (const d of resolvedDemand) {
      if (d.demand_hours == null) continue;
      demandIngest.push({ coverage_date: date, state: d.state, demand_hours: d.demand_hours, source: d.source, synced_at: nowIso });
    }
    for (const l of result.bookedLocks) {
      bookedIngest.push({
        coverage_date: date, provider_name_raw: l.provider_name, profile_id: l.profile_id, state: l.state,
        appointment_count: 0, booked_hours: l.hours, matched: l.matched, source_card_id: DAILY_BOOKED_CARD, synced_at: nowIso,
      });
    }
  }

  await insertChunked(supabase, 'daily_coverage_state_rows', stateRows);
  await insertChunked(supabase, 'daily_coverage_provider_assignments', assignmentRows);
  await insertChunked(supabase, 'daily_coverage_booked_locks', lockRows);
  await insertChunked(supabase, 'daily_coverage_recommendations', recRows);
  await insertChunked(supabase, 'daily_coverage_data_quality', dqRows);
  await upsertChunked(supabase, 'daily_state_demand', demandIngest, 'coverage_date,state,source');
  await upsertChunked(supabase, 'daily_provider_booked_appointments', dedupeBooked(bookedIngest), 'coverage_date,provider_name_raw,state');

  return runId;
}

function dedupeBooked(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = `${r.coverage_date}|${r.provider_name_raw}|${r.state}`;
    byKey.set(key, r);
  }
  return Array.from(byKey.values());
}

async function insertChunked(supabase: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}
async function upsertChunked(supabase: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

// ── Metabase + CSV ────────────────────────────────────────────────────────────
async function getMetabaseToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${METABASE_URL}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Metabase auth ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}
async function downloadCardCsvSafe(token: string, cardId: number): Promise<string> {
  try {
    const res = await fetch(`${METABASE_URL}/api/card/${cardId}/query/csv`, {
      method: 'POST', headers: { 'X-Metabase-Session': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) { console.warn(`Card ${cardId} CSV ${res.status}`); return ''; }
    return await res.text();
  } catch (e) {
    console.warn(`Card ${cardId} pull failed:`, e instanceof Error ? e.message : String(e));
    return '';
  }
}

function parseDailyDemandCard(csv: string, targetDates: string[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const wanted = new Set(targetDates);
  for (const r of parseCSV(csv)) {
    const date = parseDate(col(r, 'date', 'Date', 'day', 'Day', 'date_actual', 'date_actual: Day', 'coverage_date'));
    if (!date || !wanted.has(date)) continue;
    const st = toAbbreviation(col(r, 'state', 'State', 'Appointment State', 'appointment_state', 'service_state'));
    if (!st) continue;
    const raw = col(r, 'demand_hours', 'Demand Hours', 'target_hours', 'Target Hrs', 'Target Hours', 'hours', 'Hours', 'demand', 'Demand');
    const hrs = Number(raw.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(hrs)) continue;
    if (!out.has(date)) out.set(date, new Map());
    out.get(date)!.set(st, Math.max(0, hrs));
  }
  return out;
}

type ParsedBookedRow = { date: string; provider_name: string; state: string; appointment_count: number; booked_hours: number | null };
function parseDailyBookedCard(csv: string, targetDates: string[]): { ok: boolean; rows: ParsedBookedRow[] } {
  const rows = parseCSV(csv);
  if (rows.length === 0) return { ok: false, rows: [] };
  const wanted = new Set(targetDates);
  const out: ParsedBookedRow[] = [];
  for (const r of rows) {
    const date = parseDate(col(r, 'date', 'Date', 'day', 'Day', 'appointment_date', 'coverage_date'));
    if (!date || !wanted.has(date)) continue;
    const provider = col(r, 'provider', 'Provider', 'Provider Full Name', 'provider_name', 'Provider Name', 'clinician', 'Clinician');
    const st = toAbbreviation(col(r, 'state', 'State', 'Appointment State', 'appointment_state', 'service_state'));
    if (!provider || !st) continue;
    const countRaw = col(r, 'appointment_count', 'Appointment Count', 'appointments', 'Appointments', 'count', 'Count', 'booked', 'Booked');
    const count = Number(countRaw.replace(/[^0-9.-]/g, ''));
    const bookedHrsRaw = col(r, 'booked_hours', 'Booked Hours', 'booked_hrs', 'Booked Hrs', 'hours', 'Hours');
    const bookedHrs = bookedHrsRaw ? Number(bookedHrsRaw.replace(/[^0-9.-]/g, '')) : NaN;
    out.push({
      date, provider_name: provider, state: st,
      appointment_count: Number.isFinite(count) ? Math.round(count) : 0,
      booked_hours: Number.isFinite(bookedHrs) ? bookedHrs : null,
    });
  }
  return { ok: true, rows: out };
}

function parseCSV(text: string): Row[] {
  if (!text) return [];
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = splitCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
function col(row: Row, ...candidates: string[]): string {
  const norm = (s: string) =>
    s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const c of candidates) {
    const target = norm(c);
    const key = Object.keys(row).find((k) => norm(k) === target);
    if (key && row[key] !== undefined) return row[key].trim();
  }
  return '';
}
function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function normName(n: string): string {
  return n.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
