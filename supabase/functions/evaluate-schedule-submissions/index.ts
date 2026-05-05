/**
 * evaluate-schedule-submissions edge function
 *
 * Reads pending schedule_submissions, joins them against demand_forecast and
 * already-recommended hours, and writes back a recommendation
 * (approve / partial / decline) plus recommended_hours and notes.
 *
 * Decision logic per submission:
 *   1. Provider must be matched (provider_profile_id set). Otherwise leave pending.
 *   2. Eligible states = intersect(requested_states, provider's active licenses).
 *      If requested_states is empty, fall back to all licensed states.
 *   3. For each eligible state, compute remaining demand-hours gap for the
 *      target week:
 *          gap_hours = projected_visits / VISITS_PER_HOUR
 *                      - already_recommended_hours_for(state, week)
 *      where already_recommended_hours_for sums hours from previously-evaluated
 *      submissions (approve / partial / overridden) for the same state+week.
 *   4. total_gap = sum of gap_hours across eligible states (clipped at 0).
 *   5. requested = requested_hours_total (or sum from shifts if missing).
 *   6. Decision:
 *        - total_gap >= requested      → approve, recommended_hours = requested
 *        - 0 < total_gap < requested   → partial, recommended_hours = total_gap
 *        - total_gap <= 0              → decline, recommended_hours = 0
 *
 * Modes:
 *   POST /functions/v1/evaluate-schedule-submissions
 *     → evaluate all submissions where recommendation_status='pending'
 *   POST /functions/v1/evaluate-schedule-submissions?week_start=YYYY-MM-DD
 *     → re-evaluate every submission for that week (overwrites previous
 *       non-overridden recommendations)
 *   POST /functions/v1/evaluate-schedule-submissions?submission_id=<uuid>
 *     → evaluate a single submission
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VISITS_PER_HOUR = Number(Deno.env.get('VISITS_PER_HOUR') ?? '1.5');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Submission = {
  id: string;
  provider_profile_id: string | null;
  provider_name_raw: string | null;
  week_start: string | null;
  requested_hours_total: number | null;
  requested_states: string[] | null;
  requested_shifts: unknown;
  recommendation_status: string;
  override_status: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const weekFilter = url.searchParams.get('week_start');
  const submissionIdFilter = url.searchParams.get('submission_id');

  const startedAt = Date.now();
  const { data: runRow } = await supabase
    .from('sync_runs')
    .insert({ function_name: 'evaluate-schedule-submissions', status: 'running' })
    .select('id')
    .single();
  const runId: string | null = runRow?.id ?? null;

  const finalize = async (
    status: 'success' | 'partial' | 'error',
    extras: { rows_processed?: number; rows_failed?: number; error_message?: string; details?: unknown } = {},
  ) => {
    if (!runId) return;
    await supabase.from('sync_runs').update({
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      rows_processed: extras.rows_processed ?? 0,
      rows_failed: extras.rows_failed ?? 0,
      error_message: extras.error_message ?? null,
      details: extras.details ?? {},
    }).eq('id', runId);
  };

  const counters = { evaluated: 0, approved: 0, partial: 0, declined: 0, skipped: 0, errors: 0 };
  const decisions: Array<Record<string, unknown>> = [];

  try {
    // ── Load submissions to evaluate ────────────────────────────────────
    let q = supabase
      .from('schedule_submissions')
      .select('id, provider_profile_id, provider_name_raw, week_start, requested_hours_total, requested_states, requested_shifts, recommendation_status, override_status');

    if (submissionIdFilter) {
      q = q.eq('id', submissionIdFilter);
    } else if (weekFilter) {
      q = q.eq('week_start', weekFilter);
    } else {
      q = q.eq('recommendation_status', 'pending');
    }

    const { data: subs, error: subsErr } = await q;
    if (subsErr) throw new Error(`Failed to load submissions: ${subsErr.message}`);

    const submissions = (subs ?? []) as Submission[];

    if (submissions.length === 0) {
      await finalize('success', { details: counters });
      return json({ ok: true, ...counters, message: 'No submissions to evaluate' });
    }

    // ── Preload provider licenses for the providers in scope ─────────────
    const providerIds = Array.from(
      new Set(submissions.map(s => s.provider_profile_id).filter((x): x is string => !!x)),
    );

    const licensedStatesByProvider = new Map<string, Set<string>>();
    if (providerIds.length > 0) {
      const { data: licenses } = await supabase
        .from('provider_licenses')
        .select('profile_id, state_abbreviation, status')
        .in('profile_id', providerIds);
      for (const l of licenses ?? []) {
        if (!l.profile_id || !l.state_abbreviation) continue;
        if (l.status && !['active', 'verified', 'pending_renewal'].includes(l.status)) continue;
        const s = l.state_abbreviation.toUpperCase();
        if (!licensedStatesByProvider.has(l.profile_id)) {
          licensedStatesByProvider.set(l.profile_id, new Set());
        }
        licensedStatesByProvider.get(l.profile_id)!.add(s);
      }
    }

    // ── Preload demand_forecast for the weeks in scope ───────────────────
    const weekStarts = Array.from(
      new Set(submissions.map(s => s.week_start).filter((x): x is string => !!x)),
    );

    const demandByKey = new Map<string, number>(); // `${state}_${week}` → projected_visits
    if (weekStarts.length > 0) {
      const { data: demand } = await supabase
        .from('demand_forecast')
        .select('state_abbreviation, week_start, projected_visits')
        .in('week_start', weekStarts);
      for (const d of demand ?? []) {
        demandByKey.set(`${d.state_abbreviation.toUpperCase()}_${d.week_start}`, d.projected_visits);
      }
    }

    // ── Preload already-committed hours per state/week ───────────────────
    // Sum hours from submissions whose recommendation is approve/partial/overridden,
    // excluding the submissions we're re-evaluating in this run.
    const submissionIdsInScope = new Set(submissions.map(s => s.id));
    const committedByKey = new Map<string, number>(); // `${state}_${week}` → hours

    if (weekStarts.length > 0) {
      const { data: committed } = await supabase
        .from('schedule_submissions')
        .select('id, week_start, requested_states, recommended_hours, override_hours, override_status, recommendation_status')
        .in('week_start', weekStarts)
        .in('recommendation_status', ['approve', 'partial', 'overridden']);

      for (const c of committed ?? []) {
        if (submissionIdsInScope.has(c.id)) continue; // we'll recompute these
        const states = (c.requested_states ?? []) as string[];
        if (!states.length || !c.week_start) continue;
        const hours =
          (typeof c.override_hours === 'number' ? c.override_hours : null) ??
          (typeof c.recommended_hours === 'number' ? c.recommended_hours : null) ??
          0;
        if (hours <= 0) continue;
        // Distribute committed hours evenly across the listed states (best-effort
        // since we don't store per-state breakdown yet).
        const perState = hours / states.length;
        for (const st of states) {
          const k = `${st.toUpperCase()}_${c.week_start}`;
          committedByKey.set(k, (committedByKey.get(k) ?? 0) + perState);
        }
      }
    }

    // ── Evaluate each submission ─────────────────────────────────────────
    for (const sub of submissions) {
      try {
        if (!sub.provider_profile_id) {
          counters.skipped++;
          decisions.push({ id: sub.id, status: 'skipped', reason: 'unmatched_provider' });
          continue;
        }
        if (!sub.week_start) {
          counters.skipped++;
          decisions.push({ id: sub.id, status: 'skipped', reason: 'missing_week_start' });
          continue;
        }

        const requestedHours = sub.requested_hours_total ?? sumShiftHours(sub.requested_shifts);
        if (!requestedHours || requestedHours <= 0) {
          counters.skipped++;
          decisions.push({ id: sub.id, status: 'skipped', reason: 'no_hours_requested' });
          continue;
        }

        const licensed = licensedStatesByProvider.get(sub.provider_profile_id) ?? new Set<string>();
        const requested = new Set((sub.requested_states ?? []).map(s => s.toUpperCase()));

        let eligibleStates: string[];
        if (requested.size === 0) {
          eligibleStates = Array.from(licensed);
        } else {
          eligibleStates = Array.from(requested).filter(s => licensed.has(s));
        }

        if (eligibleStates.length === 0) {
          await writeDecision(supabase, sub.id, {
            status: 'decline',
            recommended_hours: 0,
            recommended_states: [],
            notes: requested.size === 0
              ? 'No active licenses found for this provider.'
              : `Provider not licensed in requested states: ${Array.from(requested).join(', ')}`,
          });
          counters.evaluated++;
          counters.declined++;
          decisions.push({ id: sub.id, status: 'decline', reason: 'no_licensed_states' });
          continue;
        }

        // Compute gap per state, ranked
        const gapByState: Array<{ state: string; gapHours: number; missingDemand: boolean }> = [];
        for (const st of eligibleStates) {
          const key = `${st}_${sub.week_start}`;
          const visits = demandByKey.get(key);
          if (visits === undefined) {
            gapByState.push({ state: st, gapHours: 0, missingDemand: true });
            continue;
          }
          const demandHours = visits / VISITS_PER_HOUR;
          const committed = committedByKey.get(key) ?? 0;
          const gap = Math.max(0, demandHours - committed);
          gapByState.push({ state: st, gapHours: gap, missingDemand: false });
        }
        gapByState.sort((a, b) => b.gapHours - a.gapHours);

        const totalGap = gapByState.reduce((s, g) => s + g.gapHours, 0);
        const missingDemandStates = gapByState.filter(g => g.missingDemand).map(g => g.state);

        let status: 'approve' | 'partial' | 'decline';
        let recommendedHours: number;
        const recommendedStates: string[] = [];

        if (totalGap <= 0) {
          status = 'decline';
          recommendedHours = 0;
        } else if (totalGap >= requestedHours) {
          status = 'approve';
          recommendedHours = requestedHours;
        } else {
          status = 'partial';
          recommendedHours = round2(totalGap);
        }

        // Allocate hours greedily to states with the biggest gaps
        let remaining = recommendedHours;
        for (const g of gapByState) {
          if (remaining <= 0 || g.gapHours <= 0) break;
          const take = Math.min(g.gapHours, remaining);
          if (take > 0) {
            recommendedStates.push(g.state);
            remaining -= take;
          }
        }

        const noteParts: string[] = [];
        noteParts.push(`requested=${requestedHours}h, total_gap=${round2(totalGap)}h`);
        if (gapByState.length) {
          noteParts.push(
            'state_gaps=' + gapByState.map(g => `${g.state}:${g.missingDemand ? 'no_data' : round2(g.gapHours) + 'h'}`).join(','),
          );
        }
        if (missingDemandStates.length) {
          noteParts.push(`missing_demand_for=${missingDemandStates.join(',')}`);
        }
        noteParts.push(`visits_per_hour=${VISITS_PER_HOUR}`);

        await writeDecision(supabase, sub.id, {
          status,
          recommended_hours: recommendedHours,
          recommended_states: recommendedStates,
          notes: noteParts.join('; '),
        });

        counters.evaluated++;
        if (status === 'approve') counters.approved++;
        else if (status === 'partial') counters.partial++;
        else counters.declined++;

        decisions.push({
          id: sub.id,
          provider: sub.provider_name_raw,
          week_start: sub.week_start,
          requested_hours: requestedHours,
          total_gap_hours: round2(totalGap),
          status,
          recommended_hours: recommendedHours,
          recommended_states: recommendedStates,
        });

        // Update local committed map so subsequent submissions in the same run
        // see this allocation.
        if (recommendedHours > 0 && recommendedStates.length) {
          const perState = recommendedHours / recommendedStates.length;
          for (const st of recommendedStates) {
            const k = `${st}_${sub.week_start}`;
            committedByKey.set(k, (committedByKey.get(k) ?? 0) + perState);
          }
        }
      } catch (e) {
        counters.errors++;
        const message = e instanceof Error ? e.message : String(e);
        decisions.push({ id: sub.id, status: 'error', error: message });
        console.error('Evaluate error', sub.id, message);
      }
    }

    const partial = counters.errors > 0;
    await finalize(partial ? 'partial' : 'success', {
      rows_processed: counters.evaluated,
      rows_failed: counters.errors,
      details: counters,
    });

    return json({ ok: true, runId, ...counters, decisions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalize('error', { error_message: message, details: counters });
    return json({ error: message, runId, ...counters }, 500);
  }
});

async function writeDecision(
  supabase: ReturnType<typeof createClient>,
  submissionId: string,
  decision: {
    status: 'approve' | 'partial' | 'decline';
    recommended_hours: number;
    recommended_states: string[];
    notes: string;
  },
) {
  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      recommendation_status: decision.status,
      recommended_hours: decision.recommended_hours,
      recommended_states: decision.recommended_states,
      recommendation_notes: decision.notes,
      evaluated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    // Don't overwrite a manual override
    .is('override_status', null);
  if (error) throw new Error(error.message);
}

function sumShiftHours(shifts: unknown): number | null {
  if (!Array.isArray(shifts)) return null;
  let total = 0;
  let any = false;
  for (const s of shifts) {
    const a = (s as { answer?: unknown })?.answer;
    if (typeof a === 'number') { total += a; any = true; }
    else if (typeof a === 'string') {
      const m = a.match(/-?\d+(\.\d+)?/);
      if (m) { total += Number(m[0]); any = true; }
    }
  }
  return any ? total : null;
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
