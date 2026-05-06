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
 *   3. eligible_states = provider's licensed states, filtered by the
 *      MD-only state rule: AL/IN/GA/MS/MO/SC/TN/LA can only be allocated
 *      to providers whose profession is MD or DO.
 *   4. For each eligible state, demand_hours = sum of demand_forecast
 *      values over the target month, minus committed hours from decisions
 *      made in prior runs for OTHER providers in same state+month.
 *      Note: demand_forecast.projected_visits stores hours of provider
 *      availability (not visits); column name is legacy. See
 *      compute-demand-forecast for the canonical methodology.
 *   5. total_gap = sum of demand_hours across eligible states (clipped 0).
 *   6. Decision:
 *        total_gap >= effective_hours       → accepted (all of it)
 *        0 < total_gap < effective_hours    → partial  (accept = total_gap,
 *                                                      decline = remainder)
 *        total_gap <= 0                     → declined
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
  type BuildTimelineResult,
  type ShiftRecommendationRow,
} from '../_shared/submissionTimeline.ts';

// States that can only be served by MDs/DOs per Vitable scope-of-practice rules.
// NPs licensed in these states cannot be allocated demand hours here.
const MD_ONLY_STATES = new Set(['AL', 'IN', 'GA', 'MS', 'MO', 'SC', 'TN', 'LA']);
const MD_PROFESSIONS = new Set(['MD', 'DO']);

// Mental health professions use a weekly SLA across all 50 states (no per-state
// demand allocation). They bypass the demand-gap math entirely: every parsed
// hour becomes accepted unless validation flags it. The "demand" for MH is
// staffed separately (Metabase 2973), so running them through the telehealth
// state allocator just produces false declines.
const MH_PROFESSIONS = new Set([
  'MENTAL_HEALTH_COACH',
  'MH_COACH',
  'LPC',
  'THERAPIST',
  'HEALTH_COACH',
]);
const isMentalHealthProfession = (p: string | null | undefined) => {
  if (!p) return false;
  const norm = p.toUpperCase().replace(/\s+/g, '_');
  return MH_PROFESSIONS.has(norm);
};

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
};

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
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, submitted_at')
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

    // ── Preload provider profession (for MD-only state enforcement) ────
    const professionByProvider = new Map<string, string | null>();
    if (providerIds.length > 0) {
      const { data: provs } = await supabase
        .from('providers')
        .select('id, profession')
        .in('id', providerIds);
      for (const p of provs ?? []) {
        professionByProvider.set(p.id, p.profession ?? null);
      }
    }

    // ── Preload provider licenses (filtered by MD-only constraint) ─────
    // For the eight MD-only states, only providers whose profession is MD/DO
    // are eligible — even if an NP holds a valid license. Drop non-eligible
    // (provider, state) pairs at preload time so the allocator never sees them.
    const licensedStatesByProvider = new Map<string, Set<string>>();
    if (providerIds.length > 0) {
      const { data: licenses } = await supabase
        .from('provider_licenses')
        .select('provider_id, state, status')
        .in('provider_id', providerIds);
      for (const l of licenses ?? []) {
        if (!l.provider_id || !l.state) continue;
        if (l.status && !['active', 'verified', 'pending_renewal'].includes(l.status)) continue;
        const st = String(l.state).trim().toUpperCase();
        const profession = (professionByProvider.get(l.provider_id) ?? '').toUpperCase();
        if (MD_ONLY_STATES.has(st) && !MD_PROFESSIONS.has(profession)) continue;
        if (!licensedStatesByProvider.has(l.provider_id)) {
          licensedStatesByProvider.set(l.provider_id, new Set());
        }
        licensedStatesByProvider.get(l.provider_id)!.add(st);
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

    // ── Preload committed hours from OTHER groups (not in scope) ────────
    const groupKeysInScope = groupKeys;
    const committedByKey = new Map<string, number>(); // `${state}_${month}` → committed hours
    if (months.length > 0) {
      const { data: committed } = await supabase
        .from('schedule_submissions')
        .select('id, provider_id, target_month, parsed_shifts, accepted_hours, decision_status')
        .in('target_month', months)
        .in('decision_status', ['accepted', 'partial'])
        .range(0, 49999);

      // Sum accepted_hours per (state, month) for groups NOT being re-evaluated.
      // Best-effort even-split across the provider's licensed states for that month.
      for (const c of committed ?? []) {
        if (!c.provider_id || !c.target_month) continue;
        const k = `${c.provider_id}|${c.target_month}`;
        if (groupKeysInScope.has(k)) continue;
        const hours = typeof c.accepted_hours === 'number' ? c.accepted_hours : 0;
        if (hours <= 0) continue;
        const states = licensedStatesByProvider.get(c.provider_id);
        if (!states || states.size === 0) continue;
        const perState = hours / states.size;
        for (const st of states) {
          const key = `${st}_${c.target_month}`;
          committedByKey.set(key, (committedByKey.get(key) ?? 0) + perState);
        }
      }
    }

    // ── Sort groups: most-constrained providers first ──────────────────
    // Process providers with the fewest licensed-states-with-demand first so
    // they don't get bumped by multi-state providers who have alternatives.
    // This is the practical heuristic for "maximize utilization across
    // providers" — single-state providers grab their state's gap before
    // flexible providers consume it.
    const groupKeysSorted = Array.from(submissionsByGroup.keys()).sort((a, b) => {
      const [provA, monthA] = a.split('|');
      const [provB, monthB] = b.split('|');
      const licA = licensedStatesByProvider.get(provA) ?? new Set();
      const licB = licensedStatesByProvider.get(provB) ?? new Set();
      const countWithDemand = (states: Set<string>, month: string) =>
        Array.from(states).filter(s => (demandByKey.get(`${s}_${month}`) ?? 0) > 0).length;
      const cA = countWithDemand(licA, monthA);
      const cB = countWithDemand(licB, monthB);
      if (cA !== cB) return cA - cB;        // fewer licensed-with-demand first
      return monthA.localeCompare(monthB);  // stable tiebreaker
    });

    // ── Evaluate each group ─────────────────────────────────────────────
    for (const key of groupKeysSorted) {
      const groupSubs = submissionsByGroup.get(key)!;
      try {
        counters.groups++;
        const [providerId, targetMonth] = key.split('|');

        // Sort chronologically; latest is the one that carries the decision
        groupSubs.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
        const latest = groupSubs[groupSubs.length - 1];
        const olderIds = groupSubs.slice(0, -1).map(s => s.id);

        if (!providerId) {
          counters.skipped_unmatched_provider++;
          decisions.push({ group: key, status: 'skipped', reason: 'unmatched_provider' });
          continue;
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
          const noHoursNotes = oohDeclined > 0
            ? `No effective hours in any submission for this provider+month; hours_removed_outside_business_hours=${oohDeclined}h`
            : 'No effective hours in any submission for this provider+month';
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: oohDeclined,
            notes: noHoursNotes,
            decision_run_id: decisionRunId,
            validation,
          });
          if (oohDeclined > 0 || forecastOutOfHoursTimeline.length > 0) {
            const oohRecRows = buildShiftRecommendationRows({
              providerId,
              providerName: latest.provider_name,
              targetMonth,
              timeline: [],
              forecastTimeline: [],
              outOfHoursTimeline: forecastOutOfHoursTimeline,
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

        // ── Mental health bypass ────────────────────────────────────────────
        // MH coaches/LPCs serve all 50 states with a weekly SLA, separate from
        // the telehealth state-demand pipeline. Accept every validated hour
        // and skip the licensed-states + state-gap math.
        const profession = professionByProvider.get(providerId);
        if (isMentalHealthProfession(profession)) {
          if (olderIds.length) {
            await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by latest submission ${latest.id}`);
            counters.superseded += olderIds.length;
          }
          const mhNoteParts = [
            `decision=accepted (mental_health_bypass)`,
            `profession=${profession}`,
            `effective_hours=${effectiveHours}h`,
            `raw_hours=${validation.summary.raw_total_hours}h`,
            'note=MH uses weekly SLA across 50 states; bypasses state demand allocator',
          ];
          if (oohDeclined > 0) {
            mhNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          await writeDecision(supabase, latest.id, {
            status: 'accepted',
            accepted_hours: effectiveHours,
            declined_hours: oohDeclined,
            notes: mhNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          counters.accepted++;
          decisions.push({
            group: key,
            provider: latest.provider_name,
            target_month: targetMonth,
            status: 'accepted',
            accepted_hours: effectiveHours,
            declined_hours: oohDeclined,
            mh_bypass: true,
            superseded: olderIds.length,
          });
          continue;
        }

        // Eligible states = provider's licensed states (form has no state field)
        const licensed = licensedStatesByProvider.get(providerId) ?? new Set<string>();
        if (licensed.size === 0) {
          counters.skipped_no_licensed_states++;
          await markSuperseded(supabase, olderIds, decisionRunId, `Superseded by ${latest.id}; provider has no active licenses`);
          const noLicNoteParts = ['Provider has no active licenses on file'];
          if (oohDeclined > 0) {
            noLicNoteParts.push(`hours_removed_outside_business_hours=${oohDeclined}h`);
          }
          await writeDecision(supabase, latest.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: round2(effectiveHours + oohDeclined),
            notes: noLicNoteParts.join('; '),
            decision_run_id: decisionRunId,
            validation,
          });
          counters.declined++;
          counters.superseded += olderIds.length;
          decisions.push({ group: key, provider: latest.provider_name, target_month: targetMonth, status: 'declined', reason: 'no_licenses', superseded: olderIds.length });
          continue;
        }

        // Compute remaining demand-hour gap per state
        const gapByState: Array<{ state: string; gapHours: number; missingDemand: boolean }> = [];
        for (const st of licensed) {
          const dKey = `${st}_${targetMonth}`;
          const visits = demandByKey.get(dKey);
          if (visits === undefined) {
            gapByState.push({ state: st, gapHours: 0, missingDemand: true });
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
            missingDemand: false,
          });
        }
        gapByState.sort((a, b) => b.gapHours - a.gapHours);
        const totalGap = round2(gapByState.reduce((s, g) => s + g.gapHours, 0));
        const missingDemandStates = gapByState.filter(g => g.missingDemand).map(g => g.state);

        // Decide. `declined` rolls up forecast cuts AND hours dropped for
        // being outside the operating-hours window so the provider sees
        // every hour we couldn't approve, not just the demand-driven cuts.
        let status: 'accepted' | 'partial' | 'declined';
        let accepted: number;
        let forecastDeclined: number;
        if (totalGap <= 0) {
          status = 'declined';
          accepted = 0;
          forecastDeclined = effectiveHours;
        } else if (totalGap >= effectiveHours) {
          status = 'accepted';
          accepted = effectiveHours;
          forecastDeclined = 0;
        } else {
          status = 'partial';
          accepted = totalGap;
          forecastDeclined = round2(effectiveHours - accepted);
        }
        const declined = round2(forecastDeclined + oohDeclined);

        // Allocate accepted hours greedily across states
        const allocations: Array<{ state: string; hours: number }> = [];
        let remaining = accepted;
        for (const g of gapByState) {
          if (remaining <= 0 || g.gapHours <= 0) break;
          const take = Math.min(g.gapHours, remaining);
          if (take > 0) {
            allocations.push({ state: g.state, hours: round2(take) });
            remaining -= take;
          }
        }

        const noteParts: string[] = [];
        noteParts.push(`group_size=${groupSubs.length}`);
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
        noteParts.push(`total_gap=${totalGap}h`);
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
          // Forecast cut budget is the demand-driven decline only — out-of-
          // hours fragments are handled separately inside the row builder.
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
