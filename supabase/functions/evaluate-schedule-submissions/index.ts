/**
 * evaluate-schedule-submissions edge function
 *
 * Reads schedule_submissions and writes back a decision (accepted /
 * partial / declined) plus accepted_hours / declined_hours / decision_notes.
 *
 * Resubmission handling:
 *   When a provider submits multiple times for the same target_month, we
 *   group those submissions together and walk them chronologically. New
 *   submissions overwrite any overlapping date/time slots from earlier
 *   submissions; non-overlapping slots from earlier submissions remain.
 *   The latest submission in the group gets the decision based on the
 *   merged effective hours; earlier submissions get decision_status =
 *   'superseded' so the audit trail stays intact.
 *
 * Decision math (per group of submissions for the same provider + month):
 *   1. Run every submission's parsed_shifts through the validation /
 *      normalization pipeline (`_shared/availabilityValidation.ts`):
 *        - Apply provider-specific overrides (e.g. AM/PM corrections)
 *        - Apply default deterministic AM/PM corrections
 *        - Flag implausibly long shifts, full-day recurring availability,
 *          12 AM start/end paired with daytime end/start, etc.
 *        - Expand recurring entries to weekday occurrences in the month;
 *          one-off + in-home become single-date slots.
 *        - Reconcile across submissions: later submissions overwrite
 *          overlapping slots from earlier ones; duplicates collapse.
 *        - Subtract unavailable_dates the provider listed.
 *      The raw submission stays untouched on the row (raw_answers and the
 *      raw widget values inside parsed_shifts are preserved); only the
 *      *normalized* timeline drives the forecast decision.
 *   2. effective_hours = summary.final_approvable_hours from the pipeline
 *      (normalized + deduped + minus unavailable).
 *   3. eligible_states = provider's allocation-eligible states from
 *      v_provider_state_eligibility, which rolls up ClinOps manual licenses,
 *      Medallion API licenses, DirectShifts static licenses, and the live
 *      Metabase active-state overlay. Those states are then filtered by the
 *      scheduling policy: MD/DO/Physician providers are reserved for
 *      MD-only states (AL/IN/GA/MS/MO/SC/TN/LA), and non-physicians cannot
 *      be allocated to those MD-only states.
 *   4. For each eligible state, demand_hours = sum of demand_forecast
 *      values over the target month, minus committed hours from decisions
 *      made in prior runs for OTHER providers in same state+month.
 *      Note: demand_forecast.projected_visits stores hours of provider
 *      availability (not visits); column name is legacy. See
 *      compute-demand-forecast for the canonical methodology.
 *   5. total_gap = sum of demand_hours across eligible states (clipped 0).
 *   6. Scarce coverage windows (Friday PM, Saturday, Sunday) are protected
 *      before monthly oversupply trimming. This keeps same-day / next-day
 *      access coverage from being rejected just because total monthly hours
 *      look full.
 *   7. Decision:
 *        accepted_hours = scarce_window_hours + remaining non-scarce hours
 *                         that fit inside the monthly state gap
 *        accepted_hours = effective_hours     → accepted
 *        accepted_hours > 0                   → partial
 *        accepted_hours <= 0                  → declined
 *
 * Modes:
 *   POST /functions/v1/evaluate-schedule-submissions
 *     → evaluate every (provider, target_month) group with at least one
 *       pending submission
 *   POST /functions/v1/evaluate-schedule-submissions?target_month=YYYY-MM-01
 *     → evaluate every group for that month (re-runs supersedes too)
 *   POST /functions/v1/evaluate-schedule-submissions?provider_id=<uuid>
 *     → evaluate just that provider's pending groups
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildSubmissionTimeline,
  buildShiftRecommendationRows,
  emailFromParsedShifts,
  isScarceCoverageSlot,
  scarceCoverageWindowForSlot,
  type BuildTimelineResult,
  type ShiftRecommendationRow,
} from '../_shared/submissionTimeline.ts';
import { DEFAULT_VALIDATION_CONFIG } from '../_shared/availabilityValidation.ts';

// States that can only be served by physicians per Vitable scope-of-practice
// rules. For now, physician hours are also reserved for these states so broad
// state demand does not consume scarce MD/DO capacity.
const MD_ONLY_STATES = new Set(['AL', 'IN', 'GA', 'MS', 'MO', 'SC', 'TN', 'LA']);
const PHYSICIAN_PROFESSIONS = new Set([
  'MD',
  'M_D',
  'DO',
  'D_O',
  'PHYSICIAN',
  'MEDICAL_DOCTOR',
  'DOCTOR_OF_OSTEOPATHY',
]);

const normProfession = (profession: string | null | undefined) =>
  (profession ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const isPhysicianProfession = (profession: string | null | undefined) => {
  const norm = normProfession(profession);
  const tokens = norm.split('_');
  return (
    PHYSICIAN_PROFESSIONS.has(norm) ||
    tokens.includes('MD') ||
    tokens.includes('DO') ||
    tokens.includes('PHYSICIAN')
  );
};

const isSchedulableForState = (
  profession: string | null | undefined,
  state: string,
) => {
  const st = state.trim().toUpperCase();
  const isMdOnlyState = MD_ONLY_STATES.has(st);
  if (isPhysicianProfession(profession)) return isMdOnlyState;
  return !isMdOnlyState;
};

type MentalHealthServiceLine = 'mh_coaching' | 'therapy';

// Mental health professions use service-line forecasts, not the telehealth
// state-demand allocator. Coaching and therapy/LPC are separate demand pools.
const MH_COACHING_PROFESSIONS = new Set([
  'MENTAL_HEALTH_COACH',
  'MH_COACH',
  'HEALTH_COACH',
]);
const THERAPY_PROFESSIONS = new Set([
  'LPC',
  'THERAPIST',
  'LICENSED_PROFESSIONAL_COUNSELOR',
]);
const isMentalHealthProfession = (p: string | null | undefined) => {
  return mentalHealthServiceLineForProfession(p) !== null;
};
const mentalHealthServiceLineForProfession = (
  p: string | null | undefined,
): MentalHealthServiceLine | null => {
  if (!p) return null;
  const norm = normProfession(p);
  if (MH_COACHING_PROFESSIONS.has(norm)) return 'mh_coaching';
  if (THERAPY_PROFESSIONS.has(norm)) return 'therapy';
  return null;
};
const mentalHealthServiceLineLabel = (serviceLine: MentalHealthServiceLine) =>
  serviceLine === 'mh_coaching' ? 'MH Coaching' : 'Therapy / LPC';

const MH_VISIT_MINUTES = 40;
const MH_BREAK_MINUTES = 10;
const MH_VISIT_CADENCE_MINUTES = MH_VISIT_MINUTES + MH_BREAK_MINUTES;
const MH_MIN_SHIFT_HOURS = 2.5;
const MENTAL_HEALTH_VALIDATION_CONFIG = {
  ...DEFAULT_VALIDATION_CONFIG,
  min_single_shift_hours: MH_MIN_SHIFT_HOURS,
};
const MH_POLICY_CUT_REASON =
  'Cut — mental health shifts must be at least 2.5h (3 visits at 40m with 10m breaks)';
const MH_PUBLISH_REASON =
  'Publish (mental health service-line forecast; state allocator bypassed)';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ParsedShifts = {
  requested_states?: string[];
  recurring_virtual?: unknown;
  one_off_virtual?: unknown;
  in_home_clinic?: unknown;
  unavailable_dates?: unknown;
  email?: string;
  [k: string]: unknown;
};

type Submission = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  parsed_shifts: ParsedShifts | null;
  decision_status: string;
  submitted_at: string;
  human_review_state: string | null;
};

type CommittedSubmission = {
  id: string;
  provider_id: string | null;
  target_month: string | null;
  parsed_shifts: ParsedShifts | null;
  accepted_hours: number | null;
  decision_status: string | null;
};

type ProviderStateEligibilityRow = {
  provider_id: string | null;
  state: string | null;
  allocation_eligible: boolean | null;
  eligibility_status: string | null;
  license_sources: string[] | null;
  metabase_active: boolean | null;
};

type ProviderProfile = {
  id: string;
  name: string | null;
  profession: string | null;
  employment_type: string | null;
  source: string | null;
  shift_types: string[] | null;
};

type ServiceLineDemandTarget = {
  service_line: string | null;
  month: string | null;
  monthly_hours_target: number | null;
};

type ProviderPriorityKey = 'clinical_supervisor' | 'vitable_internal' | 'access_provider';

type ProviderPriority = {
  key: ProviderPriorityKey;
  rank: 0 | 1 | 2;
  label: string;
};

const DEFAULT_PROVIDER_PRIORITY: ProviderPriority = {
  key: 'vitable_internal',
  rank: 1,
  label: 'Vitable internal',
};

function providerPriorityFor(profile: ProviderProfile | null | undefined): ProviderPriority {
  if (!profile) return DEFAULT_PROVIDER_PRIORITY;
  const employmentType = (profile.employment_type ?? '').trim().toLowerCase();
  const source = (profile.source ?? '').trim().toLowerCase();
  const shiftTypes = Array.isArray(profile.shift_types) ? profile.shift_types : [];
  const haystack = [
    profile.name,
    profile.profession,
    employmentType,
    source,
    ...shiftTypes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');

  if (
    haystack.includes('clinical supervisor') ||
    haystack.includes('clinical lead') ||
    haystack.includes('supervisor')
  ) {
    return { key: 'clinical_supervisor', rank: 0, label: 'Clinical supervisor' };
  }

  if (
    employmentType === 'agency' ||
    source.includes('directshifts') ||
    source.includes('direct shifts') ||
    source.includes('access') ||
    haystack.includes('directshifts') ||
    haystack.includes('direct shifts') ||
    haystack.includes('access provider') ||
    haystack.includes('agency supplied')
  ) {
    return { key: 'access_provider', rank: 2, label: 'Access provider' };
  }

  return DEFAULT_PROVIDER_PRIORITY;
}

// Stable signature of a parsed_shifts blob for "did anything material change
// vs the prior submission?" gating. We canonicalize the four widget arrays
// into ordered tuple lists and serialize. JSON-string blobs are tolerated.
function shiftsSignature(parsed: ParsedShifts | null): string {
  if (!parsed) return '';
  const arr = (raw: unknown): Record<string, unknown>[] => {
    if (raw == null) return [];
    let v: unknown = raw;
    if (typeof raw === 'string') {
      try { v = JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(v)
      ? v.filter((e): e is Record<string, unknown> => e != null && typeof e === 'object')
      : [];
  };
  const fmt = (label: string, rows: Record<string, unknown>[], keys: string[]) => {
    const tuples = rows
      .map(r => keys.map(k => String(r[k] ?? '').trim()).join('|'))
      .sort();
    return `${label}:[${tuples.join(';')}]`;
  };
  return [
    fmt('rec', arr(parsed.recurring_virtual), ['Day of Week', 'Start Time (ET)', 'End Time (ET)']),
    fmt('one', arr(parsed.one_off_virtual), ['Date', 'Start Time (ET)', 'End Time (ET)']),
    fmt('home', arr(parsed.in_home_clinic), ['Date', 'Start Time (ET)', 'End Time (ET)']),
    fmt('off', arr(parsed.unavailable_dates), ['Start Date', 'End Date', 'Date']),
  ].join('||');
}

type ForecastSlot = BuildTimelineResult['forecastTimeline'][number];

function slotHours(slot: ForecastSlot): number {
  return (slot.endMin - slot.startMin) / 60;
}

function sumSlotHours(slots: ForecastSlot[]): number {
  return round2(slots.reduce((sum, slot) => sum + slotHours(slot), 0));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const monthFilter = url.searchParams.get('target_month');
  const providerFilter = url.searchParams.get('provider_id');

  const decisionRunId = crypto.randomUUID();
  const counters = {
    groups: 0,
    accepted: 0,
    partial: 0,
    declined: 0,
    needs_review: 0,
    superseded: 0,
    skipped_unmatched_provider: 0,
    skipped_no_hours: 0,
    skipped_no_licensed_states: 0,
    skipped_awaiting_review: 0,
    errors: 0,
  };
  const decisions: Array<Record<string, unknown>> = [];

  try {
    // ── Find groups (provider, target_month) that need work ─────────────
    let pendingQuery = supabase
      .from('schedule_submissions')
      .select('provider_id, target_month, decision_status');

    if (monthFilter) pendingQuery = pendingQuery.eq('target_month', monthFilter);
    if (providerFilter) pendingQuery = pendingQuery.eq('provider_id', providerFilter);
    if (!monthFilter && !providerFilter) {
      // Pick up new pending rows AND previously-flagged needs_review rows so
      // a re-run after fixing the override config or raw entry decides them.
      pendingQuery = pendingQuery.in('decision_status', ['pending', 'needs_review']);
    }
    pendingQuery = pendingQuery.range(0, 49999);

    const { data: pendingRows, error: pErr } = await pendingQuery;
    if (pErr) throw new Error(`Pending lookup failed: ${pErr.message}`);

    // Skip historical submissions in the default eval — past months can't be
    // re-decided operationally, and demand_forecast doesn't have rows for
    // them. An explicit ?target_month= bypass remains for backfill.
    const currentMonth = (() => {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    })();

    const groupKeys = new Set<string>();
    for (const r of pendingRows ?? []) {
      if (!r.provider_id || !r.target_month) continue;
      if (!monthFilter && !providerFilter && r.target_month < currentMonth) continue;
      groupKeys.add(`${r.provider_id}|${r.target_month}`);
    }

    if (groupKeys.size === 0) {
      return json({
        ok: true, decision_run_id: decisionRunId, ...counters,
        message: 'No groups with pending submissions',
      });
    }

    // ── Load every submission in those groups ──────────────────────────
    const providerIds = Array.from(new Set(
      Array.from(groupKeys).map(k => k.split('|')[0])
    ));
    const months = Array.from(new Set(
      Array.from(groupKeys).map(k => k.split('|')[1])
    ));

    const { data: subsRaw, error: sErr } = await supabase
      .from('schedule_submissions')
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, submitted_at, human_review_state')
      .in('provider_id', providerIds)
      .in('target_month', months);
    if (sErr) throw new Error(`Submissions load failed: ${sErr.message}`);

    const submissions = (subsRaw ?? []) as Submission[];
    const submissionsByGroup = new Map<string, Submission[]>();
    for (const s of submissions) {
      if (!s.provider_id) continue;
      const k = `${s.provider_id}|${s.target_month}`;
      if (!groupKeys.has(k)) continue;
      if (!submissionsByGroup.has(k)) submissionsByGroup.set(k, []);
      submissionsByGroup.get(k)!.push(s);
    }

    // ── Preload committed rows before eligibility ─────────────────────
    // Committed rows from providers outside this re-run still consume state
    // demand. Include those providers in the eligibility preload so their
    // accepted hours are split against the same canonical source set.
    let committedRows: CommittedSubmission[] = [];
    if (months.length > 0) {
      const { data: committed, error: cErr } = await supabase
        .from('schedule_submissions')
        .select('id, provider_id, target_month, parsed_shifts, accepted_hours, decision_status')
        .in('target_month', months)
        .in('decision_status', ['accepted', 'partial'])
        .range(0, 49999);
      if (cErr) throw new Error(`Committed submissions load failed: ${cErr.message}`);
      committedRows = (committed ?? []) as CommittedSubmission[];
    }

    const allEligibilityProviderIds = Array.from(new Set([
      ...providerIds,
      ...committedRows
        .map(row => row.provider_id)
        .filter((id): id is string => Boolean(id)),
    ]));

    // ── Preload provider roster metadata ───────────────────────────────
    // The evaluator uses the full license-state view for eligibility, then
    // orders providers by ClinOps priority: supervisors, Vitable internal,
    // access providers. Within each tier, constrained providers still go first.
    const providerProfileByProvider = new Map<string, ProviderProfile>();
    const professionByProvider = new Map<string, string | null>();
    if (allEligibilityProviderIds.length > 0) {
      const { data: provs } = await supabase
        .from('providers')
        .select('id, name, profession, employment_type, source, shift_types')
        .in('id', allEligibilityProviderIds);
      for (const p of (provs ?? []) as ProviderProfile[]) {
        providerProfileByProvider.set(p.id, p);
        professionByProvider.set(p.id, p.profession ?? null);
      }
    }

    // ── Preload provider-state eligibility from canonical view ─────────
    // The view rolls up ClinOps manual licenses, Medallion API licenses,
    // DirectShifts static licenses, and the Metabase active-state overlay.
    // State scheduling policy still lives here in the evaluator because it is
    // an allocation constraint rather than a license-source fact.
    const licensedStatesByProvider = new Map<string, Set<string>>();
    const licenseSourcesByProviderState = new Map<string, string[]>();
    if (allEligibilityProviderIds.length > 0) {
      const { data: eligibilityRows, error: eligErr } = await supabase
        .from('v_provider_state_eligibility')
        .select('provider_id, state, allocation_eligible, eligibility_status, license_sources, metabase_active')
        .in('provider_id', allEligibilityProviderIds)
        .eq('allocation_eligible', true)
        .range(0, 49999);
      if (eligErr) throw new Error(`Provider-state eligibility load failed: ${eligErr.message}`);

      for (const row of (eligibilityRows ?? []) as ProviderStateEligibilityRow[]) {
        if (!row.provider_id || !row.state || row.allocation_eligible !== true) continue;
        const st = String(row.state).trim().toUpperCase();
        const profession = professionByProvider.get(row.provider_id);
        if (!isSchedulableForState(profession, st)) continue;
        if (!licensedStatesByProvider.has(row.provider_id)) {
          licensedStatesByProvider.set(row.provider_id, new Set());
        }
        licensedStatesByProvider.get(row.provider_id)!.add(st);
        licenseSourcesByProviderState.set(
          `${row.provider_id}|${st}`,
          Array.isArray(row.license_sources) ? row.license_sources : [],
        );
      }
    }

    // ── Preload baseline demand per (state, month) ──────────────────────
    // Reads from v_monthly_demand which pre-aggregates demand_forecast to one
    // row per (state, month). Querying the raw demand_forecast directly hits
    // PostgREST's silent row truncation at ~1,000 rows (a full month is 1,410
    // rows), which previously dropped PA from the result set entirely.
    const demandByKey = new Map<string, number>(); // `${state}_${month}` → total visits
    if (months.length > 0) {
      const { data: rows, error: dErr } = await supabase
        .from('v_monthly_demand')
        .select('state, month, total_visits')
        .in('month', months);
      if (dErr) throw new Error(`Demand load failed: ${dErr.message}`);
      for (const r of rows ?? []) {
        const st = String(r.state).trim().toUpperCase();
        const month = String(r.month);
        const k = `${st}_${month}`;
        demandByKey.set(k, Number(r.total_visits ?? 0));
      }
    }

    // ── Preload MH service-line demand targets ─────────────────────────
    // These are separate from telehealth state demand: MH Coaching and
    // Therapy/LPC each get their own nationwide service-line forecast.
    const serviceLineDemandByKey = new Map<string, number>(); // `${service_line}_${month}` → monthly hours
    if (months.length > 0) {
      const { data: rows, error: slErr } = await supabase
        .from('service_line_demand_targets')
        .select('service_line, month, monthly_hours_target')
        .in('month', months)
        .in('service_line', ['mh_coaching', 'therapy']);
      if (slErr) throw new Error(`Service-line demand load failed: ${slErr.message}`);
      for (const r of (rows ?? []) as ServiceLineDemandTarget[]) {
        if (!r.service_line || !r.month) continue;
        serviceLineDemandByKey.set(
          `${r.service_line}_${r.month}`,
          Number(r.monthly_hours_target ?? 0),
        );
      }
    }

    // ── Preload committed hours from OTHER groups (not in scope) ────────
    const groupKeysInScope = groupKeys;
    const committedByKey = new Map<string, number>(); // `${state}_${month}` → committed hours
    const serviceLineCommittedByKey = new Map<string, number>(); // `${service_line}_${month}` → committed hours
    // Sum accepted_hours per (state, month) for groups NOT being re-evaluated.
    // Best-effort even-split across the provider's canonical eligible states
    // for that month.
    for (const c of committedRows) {
      if (!c.provider_id || !c.target_month) continue;
      const k = `${c.provider_id}|${c.target_month}`;
      if (groupKeysInScope.has(k)) continue;
      const hours = typeof c.accepted_hours === 'number' ? c.accepted_hours : 0;
      if (hours <= 0) continue;
      const serviceLine = mentalHealthServiceLineForProfession(
        professionByProvider.get(c.provider_id),
      );
      if (serviceLine) {
        const serviceLineKey = `${serviceLine}_${c.target_month}`;
        serviceLineCommittedByKey.set(
          serviceLineKey,
          (serviceLineCommittedByKey.get(serviceLineKey) ?? 0) + hours,
        );
        continue;
      }
      const states = licensedStatesByProvider.get(c.provider_id);
      if (!states || states.size === 0) continue;
      const perState = hours / states.size;
      for (const st of states) {
        const key = `${st}_${c.target_month}`;
        committedByKey.set(key, (committedByKey.get(key) ?? 0) + perState);
      }
    }

    // ── Sort groups by provider priority, then constrained coverage ─────
    // Clinical supervisors get first pass at demand, then Vitable internal
    // providers, then access providers. Within each tier, process providers
    // with the fewest licensed-states-with-demand first so single-state
    // providers are not displaced by flexible providers with alternatives.
    const groupKeysSorted = Array.from(submissionsByGroup.keys()).sort((a, b) => {
      const [provA, monthA] = a.split('|');
      const [provB, monthB] = b.split('|');
      const priorityA = providerPriorityFor(providerProfileByProvider.get(provA));
      const priorityB = providerPriorityFor(providerProfileByProvider.get(provB));
      if (priorityA.rank !== priorityB.rank) return priorityA.rank - priorityB.rank;
      const licA = licensedStatesByProvider.get(provA) ?? new Set();
      const licB = licensedStatesByProvider.get(provB) ?? new Set();
      const countWithDemand = (states: Set<string>, month: string) =>
        Array.from(states).filter(s => (demandByKey.get(`${s}_${month}`) ?? 0) > 0).length;
      const cA = countWithDemand(licA, monthA);
      const cB = countWithDemand(licB, monthB);
      if (cA !== cB) return cA - cB;        // fewer licensed-with-demand first
      const nameA = providerProfileByProvider.get(provA)?.name ?? provA;
      const nameB = providerProfileByProvider.get(provB)?.name ?? provB;
      return monthA.localeCompare(monthB) || nameA.localeCompare(nameB);
    });

    // ── Evaluate each group ─────────────────────────────────────────────
    for (const key of groupKeysSorted) {
      const allGroupSubs = submissionsByGroup.get(key)!;
      try {
        counters.groups++;
        const [providerId, targetMonth] = key.split('|');

        // Parked submissions are user-rejected and should NOT participate in
        // the "latest wins" computation — they stay superseded and the prior
        // submission remains authoritative.
        const groupSubs = allGroupSubs.filter(s => s.human_review_state !== 'parked');
        if (groupSubs.length === 0) {
          decisions.push({ group: key, status: 'skipped', reason: 'all_parked' });
          continue;
        }

        // Sort chronologically; latest is the one that carries the decision
        groupSubs.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
        const latest = groupSubs[groupSubs.length - 1];
        const olderIds = groupSubs.slice(0, -1).map(s => s.id);

        if (!providerId) {
          counters.skipped_unmatched_provider++;
          decisions.push({ group: key, status: 'skipped', reason: 'unmatched_provider' });
          continue;
        }

        const profession = professionByProvider.get(providerId);
        const providerPriority = providerPriorityFor(providerProfileByProvider.get(providerId));
        const isPhysician = isPhysicianProfession(profession);
        const isMentalHealth = isMentalHealthProfession(profession);

        // ── Resubmission inbox gating ─────────────────────────────────────
        // If the latest submission is awaiting human review, leave the group's
        // existing decision + shift_recommendations alone. ClinOps will
        // Approve or Park it via the Workbench Inbox tab, after which the
        // next evaluator run picks it up normally.
        if (latest.human_review_state === 'pending') {
          counters.skipped_awaiting_review++;
          decisions.push({
            group: key,
            provider: latest.provider_name,
            target_month: targetMonth,
            status: 'skipped',
            reason: 'awaiting_human_review',
          });
          continue;
        }

        // If the latest hasn't been reviewed yet AND it changes content vs the
        // prior decided submission, flag it for review and skip. The prior
        // submission's decision (and any Homebase-published shifts) are
        // preserved untouched.
        if (
          latest.human_review_state == null &&
          olderIds.length > 0
        ) {
          const prior = groupSubs[groupSubs.length - 2];
          const priorWasDecided =
            prior &&
            prior.decision_status &&
            prior.decision_status !== 'pending' &&
            prior.decision_status !== 'superseded';
          if (priorWasDecided) {
            const sigPrior = shiftsSignature(prior.parsed_shifts ?? null);
            const sigLatest = shiftsSignature(latest.parsed_shifts ?? null);
            if (sigPrior !== sigLatest) {
              const { error: flagErr } = await supabase
                .from('schedule_submissions')
                .update({ human_review_state: 'pending' })
                .eq('id', latest.id);
              if (flagErr) {
                console.warn(`Failed to flag ${latest.id} as pending: ${flagErr.message}`);
              }
              counters.skipped_awaiting_review++;
              decisions.push({
                group: key,
                provider: latest.provider_name,
                target_month: targetMonth,
                status: 'skipped',
                reason: 'flagged_for_review',
              });
              continue;
            }
          }
        }

        // Build merged slot timeline via the shared validation/normalization
        // pipeline. emit-shift-recommendations runs the SAME function with
        // the SAME inputs, so timelines match.
        // Raw submission data on the row is preserved verbatim — we only
        // read it here.
        const validation: BuildTimelineResult = buildSubmissionTimeline(
          groupSubs.map(s => ({
            id: s.id,
            submitted_at: s.submitted_at,
            parsed_shifts: s.parsed_shifts ?? null,
          })),
          {
            providerId,
            email: emailFromParsedShifts(latest.parsed_shifts),
            name: latest.provider_name,
          },
          targetMonth,
          isMentalHealth ? { config: MENTAL_HEALTH_VALIDATION_CONFIG } : {},
        );
        const fullTimeline = validation.timeline;
        const forecastTimeline = validation.forecastTimeline;
        const forecastOutOfHoursTimeline = validation.forecastOutOfHoursTimeline;
        const effectiveHours = validation.summary.final_approvable_hours;
        // Hours dropped because the slot fell outside the operating-hours
        // window (9a-9p ET weekdays, 9a-12p ET weekends). They count toward
        // declined_hours so the provider sees the full reason their submitted
        // time was not approved.
        const oohDeclined = round2(validation.summary.hours_removed_for_operating_hours ?? 0);
        const policyDeclined = round2(validation.summary.hours_removed_for_minimum_shift ?? 0);

        if (validation.report.length > 0) {
          console.log(`[validation] ${latest.provider_name} ${targetMonth}`,
            JSON.stringify({
              summary: validation.summary,
              report: validation.report,
            }));
        }

        // ── needs_review short-circuit ────────────────────────────────────
        // If validation surfaced intervals that need a human eyeball, do NOT
        // auto-decide the group. The latest submission gets decision_status
        // 'needs_review' with accepted=0 and declined=0; older submissions
        // are still superseded so the audit trail is intact. ClinOps can
        // re-run after the override config or raw entry is fixed.
        const needsReview = validation.summary.intervals_needing_review > 0
          || validation.summary.intervals_rejected > 0;
        if (needsReview) {
          if (olderIds.length) {
            await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by latest submission ${latest.id}`);
            counters.superseded += olderIds.length;
          }
          const reviewReasons = validation.report
            .filter(r => r.needs_manual_review)
            .map(r => `${r.day_of_week ?? r.date ?? ''} ${r.raw_time_range}: ${r.warnings.join('; ')}`)
            .slice(0, 8);
          const notes = [
            `decision=needs_review`,
            `intervals_needing_review=${validation.summary.intervals_needing_review}`,
            `intervals_rejected=${validation.summary.intervals_rejected}`,
            `raw_hours=${validation.summary.raw_total_hours}h`,
            `forecastable_hours=${effectiveHours}h`,
            `reasons=${reviewReasons.join(' | ') || '(see validation_report)'}`,
          ].join('; ');
          await writeDecision(supabase, latest.id, {
            status: 'needs_review',
            accepted_hours: 0,
            declined_hours: 0,
            notes,
            decision_run_id: decisionRunId,
            validation,
          });
          counters.needs_review++;
          decisions.push({
            group: key,
            provider: latest.provider_name,
            target_month: targetMonth,
            status: 'needs_review',
            superseded: olderIds.length,
            validation_summary: validation.summary,
            validation_report: validation.report,
          });
          continue;
        }

        if (effectiveHours <= 0) {
          counters.skipped_no_hours++;
          // Mark older as superseded; latest becomes 'declined' with note
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by ${latest.id}; group has 0 effective hours`);
          const noHoursNoteParts = ['No effective hours in any submission for this provider+month'];
          if (isMentalHealth) {
            noHoursNoteParts.push(
              `mh_min_shift_hours=${MH_MIN_SHIFT_HOURS}`,
              `mh_visit_cadence=${MH_VISIT_MINUTES}m_visit+${MH_BREAK_MINUTES}m_break`,
            );
          }
          if (oohDeclined > 0) {
            noHoursNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          if (policyDeclined > 0) {
            noHoursNoteParts.push(`hours_removed_below_minimum_shift=${policyDeclined}h`);
          }
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: round2(oohDeclined + policyDeclined),
            notes: noHoursNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          if (
            oohDeclined > 0 ||
            policyDeclined > 0 ||
            forecastOutOfHoursTimeline.length > 0 ||
            validation.forecastPolicyCutTimeline.length > 0
          ) {
            const oohRecRows = buildShiftRecommendationRows({
              providerId,
              providerName: latest.provider_name,
              targetMonth,
              timeline: [],
              forecastTimeline: [],
              outOfHoursTimeline: forecastOutOfHoursTimeline,
              policyCutTimeline: validation.forecastPolicyCutTimeline,
              policyCutReason: isMentalHealth ? MH_POLICY_CUT_REASON : undefined,
              unallocatedForecastPublishReason: isMentalHealth ? MH_PUBLISH_REASON : undefined,
              declinedHours: 0,
              declineAll: false,
              allocations: [],
              decisionRunId,
            });
            await writeShiftRecommendations(supabase, groupSubs.map(s => s.id), oohRecRows);
          }
          counters.declined++;
          counters.superseded += olderIds.length;
          decisions.push({ group: key, provider: latest.provider_name, target_month: targetMonth, status: 'declined', reason: 'no_hours', superseded: olderIds.length });
          continue;
        }

        // ── Mental health service-line allocation ──────────────────────────
        // MH coaching and therapy/LPC use separate service-line forecasts,
        // not the telehealth state-demand pipeline.
        if (isMentalHealth) {
          if (olderIds.length) {
            await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by latest submission ${latest.id}`);
            counters.superseded += olderIds.length;
          }
          const serviceLine = mentalHealthServiceLineForProfession(profession);
          if (!serviceLine) {
            throw new Error(`Mental health provider ${latest.provider_name} has no service-line mapping for profession=${profession}`);
          }
          const serviceLineKey = `${serviceLine}_${targetMonth}`;
          const targetHours = serviceLineDemandByKey.get(serviceLineKey);
          const committedHours = round2(serviceLineCommittedByKey.get(serviceLineKey) ?? 0);
          const remainingGap = targetHours == null
            ? effectiveHours
            : round2(Math.max(0, targetHours - committedHours));
          const accepted = targetHours == null
            ? effectiveHours
            : round2(Math.min(effectiveHours, remainingGap));
          const forecastDeclined = round2(Math.max(0, effectiveHours - accepted));
          const mhDeclined = round2(forecastDeclined + oohDeclined + policyDeclined);
          let mhStatus: 'accepted' | 'partial' | 'declined';
          if (accepted <= 0) {
            mhStatus = 'declined';
          } else if (mhDeclined > 0) {
            mhStatus = 'partial';
          } else {
            mhStatus = 'accepted';
          }
          const mhVisitCapacity = Math.floor((accepted * 60) / MH_VISIT_CADENCE_MINUTES);
          const mhNoteParts = [
            `decision=${mhStatus} (mental_health_bypass)`,
            `service_line=${serviceLine}`,
            `service_line_label=${mentalHealthServiceLineLabel(serviceLine)}`,
            `provider_priority=${providerPriority.key}`,
            `profession=${profession}`,
            `effective_hours=${effectiveHours}h`,
            `accepted_hours=${accepted}h`,
            `raw_hours=${validation.summary.raw_total_hours}h`,
            `mh_visit_length_minutes=${MH_VISIT_MINUTES}`,
            `mh_break_minutes=${MH_BREAK_MINUTES}`,
            `mh_visit_capacity=${mhVisitCapacity}`,
            `mh_min_shift_hours=${MH_MIN_SHIFT_HOURS}`,
            'note=MH uses service-line forecast; bypasses telehealth state allocator',
          ];
          if (targetHours == null) {
            mhNoteParts.push('service_line_forecast=missing');
          } else {
            mhNoteParts.push(`service_line_target=${round2(targetHours)}h`);
            mhNoteParts.push(`service_line_committed=${committedHours}h`);
            mhNoteParts.push(`service_line_gap=${remainingGap}h`);
            mhNoteParts.push(`forecast_declined_hours=${forecastDeclined}h`);
          }
          if (oohDeclined > 0) {
            mhNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          if (policyDeclined > 0) {
            mhNoteParts.push(`hours_removed_below_minimum_shift=${policyDeclined}h`);
          }
          await writeDecision(supabase, latest.id, {
            status: mhStatus,
            accepted_hours: accepted,
            declined_hours: mhDeclined,
            notes: mhNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          const mhRecRows = buildShiftRecommendationRows({
            providerId,
            providerName: latest.provider_name,
            targetMonth,
            timeline: fullTimeline,
            forecastTimeline,
            outOfHoursTimeline: forecastOutOfHoursTimeline,
            policyCutTimeline: validation.forecastPolicyCutTimeline,
            policyCutReason: MH_POLICY_CUT_REASON,
            unallocatedForecastPublishReason: MH_PUBLISH_REASON,
            declinedHours: forecastDeclined,
            declineAll: mhStatus === 'declined',
            allocations: [],
            decisionRunId,
          });
          await writeShiftRecommendations(supabase, groupSubs.map(s => s.id), mhRecRows);
          if (mhStatus === 'accepted') counters.accepted++;
          else if (mhStatus === 'partial') counters.partial++;
          else counters.declined++;
          decisions.push({
            group: key,
            provider: latest.provider_name,
            target_month: targetMonth,
            status: mhStatus,
            accepted_hours: accepted,
            declined_hours: mhDeclined,
            mh_bypass: true,
            service_line: serviceLine,
            service_line_target_hours: targetHours ?? null,
            service_line_gap_hours: remainingGap,
            forecast_declined_hours: forecastDeclined,
            mh_visit_capacity: mhVisitCapacity,
            superseded: olderIds.length,
          });
          if (accepted > 0) {
            serviceLineCommittedByKey.set(serviceLineKey, committedHours + accepted);
          }
          continue;
        }

        // Eligible states = provider's licensed states (form has no state field)
        const licensed = licensedStatesByProvider.get(providerId) ?? new Set<string>();
        if (licensed.size === 0) {
          counters.skipped_no_licensed_states++;
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by ${latest.id}; provider has no active licenses`);
          const noLicNoteParts = [
            `provider_priority=${providerPriority.key}`,
            'Provider has no allocation-eligible states on file',
          ];
          if (isPhysician) {
            noLicNoteParts.push('state_policy=physician_reserved_for_md_only');
          }
          if (oohDeclined > 0) {
            noLicNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          if (policyDeclined > 0) {
            noLicNoteParts.push(`hours_removed_below_minimum_shift=${policyDeclined}h`);
          }
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: round2(effectiveHours + oohDeclined + policyDeclined),
            notes: noLicNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          counters.declined++;
          counters.superseded += olderIds.length;
          decisions.push({ group: key, provider: latest.provider_name, target_month: targetMonth, status: 'declined', reason: 'no_licenses', superseded: olderIds.length });
          continue;
        }

        const eligibleSourceSummary = Array.from(licensed)
          .sort()
          .map(st => {
            const sources = licenseSourcesByProviderState.get(`${providerId}|${st}`) ?? [];
            return `${st}:${sources.length ? sources.join('+') : 'unknown'}`;
          });

        // Compute remaining demand-hour gap per state
        const gapByState: Array<{
          state: string;
          gapHours: number;
          demandHours: number;
          missingDemand: boolean;
        }> = [];
        for (const st of licensed) {
          const dKey = `${st}_${targetMonth}`;
          const visits = demandByKey.get(dKey);
          if (visits === undefined) {
            gapByState.push({ state: st, gapHours: 0, demandHours: 0, missingDemand: true });
            continue;
          }
          // demand_forecast.projected_visits stores hours of provider
          // availability (column name is legacy/misleading), so the value
          // already IS the demand hour figure — no conversion.
          const demandHours = visits;
          const committed = committedByKey.get(dKey) ?? 0;
          gapByState.push({
            state: st,
            gapHours: Math.max(0, demandHours - committed),
            demandHours,
            missingDemand: false,
          });
        }
        gapByState.sort((a, b) => b.gapHours - a.gapHours);
        const totalGap = round2(gapByState.reduce((s, g) => s + g.gapHours, 0));
        const missingDemandStates = gapByState.filter(g => g.missingDemand).map(g => g.state);
        const scarceCoverageTimeline = forecastTimeline.filter(isScarceCoverageSlot);
        const scarceCoverageHours = sumSlotHours(scarceCoverageTimeline);
        const scarceCoverageWindows = Array.from(new Set(
          scarceCoverageTimeline
            .map(scarceCoverageWindowForSlot)
            .filter((window): window is string => Boolean(window)),
        )).sort();

        // Decide. `declined` rolls up forecast cuts AND hours dropped for
        // being outside the operating-hours window so the provider sees
        // every hour we couldn't approve, not just the demand-driven cuts.
        let status: 'accepted' | 'partial' | 'declined';
        let accepted: number;
        let forecastDeclined: number;
        const nonScarceHours = round2(Math.max(0, effectiveHours - scarceCoverageHours));
        const monthlyGapAfterScarce = round2(Math.max(0, totalGap - scarceCoverageHours));
        const demandAcceptedHours = round2(Math.min(nonScarceHours, monthlyGapAfterScarce));
        accepted = round2(Math.min(effectiveHours, scarceCoverageHours + demandAcceptedHours));
        forecastDeclined = round2(Math.max(0, effectiveHours - accepted));
        const scarceOverflowHours = round2(Math.max(0, accepted - totalGap));
        if (accepted <= 0) {
          status = 'declined';
        } else if (forecastDeclined <= 0) {
          status = 'accepted';
        } else {
          status = 'partial';
        }
        const declined = round2(forecastDeclined + oohDeclined + policyDeclined);

        // Allocate accepted hours greedily across states
        const allocations: Array<{ state: string; hours: number }> = [];
        const addAllocation = (state: string, hours: number) => {
          const rounded = round2(hours);
          if (rounded <= 0) return;
          const existing = allocations.find(a => a.state === state);
          if (existing) {
            existing.hours = round2(existing.hours + rounded);
          } else {
            allocations.push({ state, hours: rounded });
          }
        };
        let remaining = accepted;
        for (const g of gapByState) {
          if (remaining <= 0 || g.gapHours <= 0) break;
          const take = Math.min(g.gapHours, remaining);
          if (take > 0) {
            addAllocation(g.state, take);
            remaining = round2(remaining - take);
          }
        }
        if (remaining > 0) {
          const fallbackStates = [...gapByState].sort((a, b) =>
            b.demandHours - a.demandHours ||
            b.gapHours - a.gapHours ||
            a.state.localeCompare(b.state),
          );
          for (const g of fallbackStates) {
            if (remaining <= 0) break;
            addAllocation(g.state, remaining);
            remaining = 0;
          }
        }

        const noteParts: string[] = [];
        noteParts.push(`group_size=${groupSubs.length}`);
        noteParts.push(`provider_priority=${providerPriority.key}`);
        if (isPhysician) {
          noteParts.push('state_policy=physician_reserved_for_md_only');
        }
        noteParts.push(`effective_hours=${effectiveHours}h`);
        noteParts.push(`raw_hours=${validation.summary.raw_total_hours}h`);
        if (validation.summary.intervals_auto_corrected > 0) {
          noteParts.push(`auto_corrected=${validation.summary.intervals_auto_corrected}`);
        }
        if (validation.summary.intervals_needing_review > 0) {
          noteParts.push(`needs_review=${validation.summary.intervals_needing_review}`);
        }
        if (validation.summary.intervals_rejected > 0) {
          noteParts.push(`rejected=${validation.summary.intervals_rejected}`);
        }
        if (validation.summary.hours_removed_for_unavailability > 0) {
          noteParts.push(`hours_removed_unavailable=${validation.summary.hours_removed_for_unavailability}h`);
        }
        if (validation.summary.hours_removed_for_duplicates > 0) {
          noteParts.push(`hours_removed_dup=${validation.summary.hours_removed_for_duplicates}h`);
        }
        if (oohDeclined > 0) {
          noteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
        }
        if (policyDeclined > 0) {
          noteParts.push(`hours_removed_below_minimum_shift=${policyDeclined}h`);
        }
        if (scarceCoverageHours > 0) {
          noteParts.push('scarce_window_policy=protected_before_monthly_trim');
          noteParts.push(`scarce_window_hours=${scarceCoverageHours}h`);
          noteParts.push(`scarce_windows=${scarceCoverageWindows.join(',')}`);
          if (scarceOverflowHours > 0) {
            noteParts.push(`scarce_window_over_monthly_gap=${scarceOverflowHours}h`);
          }
        }
        if (eligibleSourceSummary.length) {
          noteParts.push(`eligible_sources=${eligibleSourceSummary.join(',')}`);
        }
        noteParts.push(`total_gap=${totalGap}h`);
        noteParts.push(`demand_accepted_hours=${demandAcceptedHours}h`);
        noteParts.push(
          'state_gaps=' + gapByState.map(g => `${g.state}:${g.missingDemand ? 'no_data' : round2(g.gapHours) + 'h'}`).join(','),
        );
        if (allocations.length) {
          noteParts.push('alloc=' + allocations.map(a => `${a.state}:${a.hours}h`).join(','));
        }
        if (missingDemandStates.length) {
          noteParts.push(`missing_demand=${missingDemandStates.join(',')}`);
        }
        if (olderIds.length) noteParts.push(`supersedes=${olderIds.length}`);

        // Mark older as superseded
        if (olderIds.length) {
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by latest submission ${latest.id}`);
          counters.superseded += olderIds.length;
        }

        await writeDecision(supabase, latest.id, {
          status,
          accepted_hours: accepted,
          declined_hours: declined,
          notes: noteParts.join('; '),
          decision_run_id: decisionRunId,
          validation,
        });

        // Emit per-shift recommendations using the SAME shared row builder
        // that emit-shift-recommendations uses. This guarantees the rows
        // produced here match what a subsequent emit run would produce for
        // the same (provider, target_month).
        const recRows = buildShiftRecommendationRows({
          providerId,
          providerName: latest.provider_name,
          targetMonth,
          timeline: fullTimeline,
          forecastTimeline,
          outOfHoursTimeline: forecastOutOfHoursTimeline,
          policyCutTimeline: validation.forecastPolicyCutTimeline,
          // Forecast cut budget is the demand-driven decline only — out-of-
          // hours fragments are handled separately inside the row builder.
          protectedForecastTimeline: scarceCoverageTimeline,
          declinedHours: forecastDeclined,
          declineAll: status === 'declined',
          allocations,
          decisionRunId,
        });
        await writeShiftRecommendations(supabase, groupSubs.map(s => s.id), recRows);

        if (status === 'accepted') counters.accepted++;
        else if (status === 'partial') counters.partial++;
        else counters.declined++;

        decisions.push({
          group: key,
          provider: latest.provider_name,
          target_month: targetMonth,
          group_size: groupSubs.length,
          superseded: olderIds.length,
          effective_hours: effectiveHours,
          total_gap_hours: totalGap,
          status,
          accepted_hours: accepted,
          declined_hours: declined,
          allocations,
          provider_priority: providerPriority.key,
          state_policy: isPhysician ? 'physician_reserved_for_md_only' : 'standard',
          scarce_window_hours: scarceCoverageHours,
          scarce_windows: scarceCoverageWindows,
          scarce_window_over_monthly_gap: scarceOverflowHours,
          validation_summary: validation.summary,
          validation_report: validation.report,
        });

        // Update committed map so subsequent groups in this run see this allocation
        if (accepted > 0 && allocations.length) {
          for (const a of allocations) {
            const dKey = `${a.state}_${targetMonth}`;
            committedByKey.set(dKey, (committedByKey.get(dKey) ?? 0) + a.hours);
          }
        }
      } catch (e) {
        counters.errors++;
        const message = e instanceof Error ? e.message : String(e);
        decisions.push({ group: key, status: 'error', error: message });
        console.error('Evaluate error', key, message);
      }
    }

    return json({ ok: true, decision_run_id: decisionRunId, ...counters, decisions });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), decision_run_id: decisionRunId, ...counters }, 500);
  }
});

// ── DB writes ─────────────────────────────────────────────────────────────
async function writeDecision(
  supabase: ReturnType<typeof createClient>,
  submissionId: string,
  decision: {
    status: 'accepted' | 'partial' | 'declined' | 'needs_review';
    accepted_hours: number;
    declined_hours: number;
    notes: string;
    decision_run_id: string;
    validation: BuildTimelineResult;
  },
) {
  const { summary } = decision.validation;
  const normalizedSlots = decision.validation.timeline.map(s => ({
    date: s.date,
    start_min: s.startMin,
    end_min: s.endMin,
    hours: round2((s.endMin - s.startMin) / 60),
    kind: s.source.kind,
    source_submission_id: s.source.submissionId ?? null,
    correction_reason: s.source.correction_reason,
    validation_status: s.source.validation_status,
  }));
  const validationWarnings = Array.from(new Set(
    decision.validation.report.flatMap(r => r.warnings),
  ));

  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      decision_status: decision.status,
      accepted_hours: decision.accepted_hours,
      declined_hours: decision.declined_hours,
      decision_notes: decision.notes,
      decided_at: new Date().toISOString(),
      decision_run_id: decision.decision_run_id,
      validation_status: validationStatusForGroup(decision.status, summary),
      raw_requested_hours: summary.raw_total_hours,
      normalized_requested_hours: summary.normalized_total_hours,
      effective_hours_used_for_forecast: summary.final_approvable_hours,
      validation_warnings: validationWarnings,
      normalized_slots: normalizedSlots,
      intervals_auto_corrected: summary.intervals_auto_corrected,
      intervals_needing_review: summary.intervals_needing_review,
      hours_removed_for_unavailability: summary.hours_removed_for_unavailability,
      hours_removed_for_duplicates: summary.hours_removed_for_duplicates,
      hours_changed_by_validation: summary.hours_changed_by_validation,
      validation_summary: summary,
    })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);
}

function validationStatusForGroup(
  decisionStatus: 'accepted' | 'partial' | 'declined' | 'needs_review',
  summary: BuildTimelineResult['summary'],
): string {
  if (decisionStatus === 'needs_review') return 'needs_review';
  if (summary.intervals_rejected > 0) return 'partially_rejected';
  if (summary.intervals_auto_corrected > 0) return 'auto_corrected';
  return 'valid';
}

type PreservedPublishState = {
  publish_status: string;
  published_at: string | null;
  published_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
  homebase_shift_id: string | null;
};

const shiftKey = (r: {
  submission_id: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  shift_type: string;
}) =>
  `${r.submission_id}|${r.shift_date}|${r.start_min}|${r.end_min}|${r.shift_type}`;

async function writeShiftRecommendations(
  supabase: ReturnType<typeof createClient>,
  submissionIds: string[],
  rows: ShiftRecommendationRow[],
) {
  // Snapshot the existing publish state for this group BEFORE we wipe, so a
  // re-run of the evaluator doesn't reset Sarabjeet's "Posted to Homebase /
  // EHR" progress. We carry the state forward onto any freshly emitted shift
  // whose natural identity (submission + date + start/end + type) matches.
  // Shifts that no longer exist in the new emission lose their state — that's
  // intentional: the schedule changed, and Sarabjeet would need to re-publish.
  const { data: priorRows, error: priorErr } = await supabase
    .from('shift_recommendations')
    .select(
      'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, shift_type, publish_status, published_at, published_by, ehr_posted_at, ehr_posted_by, homebase_shift_id',
    )
    .in('submission_id', submissionIds);
  if (priorErr) {
    throw new Error(`failed to read prior shift_recommendations: ${priorErr.message}`);
  }

  const priorByKey = new Map<string, typeof priorRows[number]>();
  for (const r of priorRows ?? []) priorByKey.set(shiftKey(r), r);

  await supabase
    .from('shift_recommendations')
    .delete()
    .in('submission_id', submissionIds);

  if (rows.length === 0) return;

  // Preserve onto matching new rows.
  const preservedAuditEntries: Record<string, unknown>[] = [];
  const merged = rows.map(row => {
    const prior = priorByKey.get(shiftKey(row));
    if (!prior) return row;
    const carry: PreservedPublishState = {
      publish_status: prior.publish_status,
      published_at: prior.published_at,
      published_by: prior.published_by,
      ehr_posted_at: prior.ehr_posted_at,
      ehr_posted_by: prior.ehr_posted_by,
      homebase_shift_id: prior.homebase_shift_id,
    };
    if (carry.publish_status === 'published_to_homebase' || carry.publish_status === 'confirmed') {
      preservedAuditEntries.push({
        submission_id: row.submission_id,
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        target_month: row.target_month,
        shift_date: row.shift_date,
        start_min: row.start_min,
        end_min: row.end_min,
        shift_type: row.shift_type,
        step: 'homebase',
        action: 'preserved',
        actor_label: 'evaluator re-run',
        notes: `Carried forward from prior shift ${prior.id}`,
      });
    }
    if (carry.publish_status === 'confirmed' || carry.ehr_posted_at) {
      preservedAuditEntries.push({
        submission_id: row.submission_id,
        provider_id: row.provider_id,
        provider_name: row.provider_name,
        target_month: row.target_month,
        shift_date: row.shift_date,
        start_min: row.start_min,
        end_min: row.end_min,
        shift_type: row.shift_type,
        step: 'ehr',
        action: 'preserved',
        actor_label: 'evaluator re-run',
        notes: `Carried forward from prior shift ${prior.id}`,
      });
    }
    return { ...row, ...carry };
  });

  const CHUNK = 500;
  for (let i = 0; i < merged.length; i += CHUNK) {
    const chunk = merged.slice(i, i + CHUNK);
    const { error } = await supabase.from('shift_recommendations').insert(chunk);
    if (error) throw new Error(`shift_recommendations insert failed: ${error.message}`);
  }

  // Best-effort audit. We log preservation events so it's traceable when
  // someone wonders why a published-to-Homebase shift is still checked after
  // a re-evaluation (or, if it isn't, why not).
  if (preservedAuditEntries.length > 0) {
    for (let i = 0; i < preservedAuditEntries.length; i += CHUNK) {
      const chunk = preservedAuditEntries.slice(i, i + CHUNK);
      const { error: auditErr } = await supabase.from('publish_audit_log').insert(chunk);
      if (auditErr) {
        // Don't fail the whole evaluator on a logging failure.
        console.warn('publish_audit_log preservation insert failed:', auditErr.message);
      }
    }
  }
}

async function markSuperseded(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
  decisionRunId: string,
  note: string,
) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      decision_status: 'superseded',
      accepted_hours: 0,
      declined_hours: 0,
      decision_notes: note,
      decided_at: new Date().toISOString(),
      decision_run_id: decisionRunId,
    })
    .in('id', ids);
  if (error) throw new Error(error.message);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
