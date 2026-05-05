/**
 * evaluate-schedule-submissions edge function
 *
 * Reads schedule_submissions whose decision_status='pending' (or filtered by
 * target_month / submission_id), joins them against demand_forecast, and
 * writes back a decision (accepted / partial / declined) plus accepted_hours,
 * declined_hours, and decision_notes.
 *
 * Decision logic per submission:
 *   1. Provider must be matched (provider_id set). Otherwise leave pending.
 *   2. Eligible states = intersect(parsed_shifts.requested_states,
 *      provider's licensed states). If requested_states is empty, fall back
 *      to all licensed states.
 *   3. For each eligible state, sum projected_visits across the target_month
 *      from demand_forecast (is_baseline=true, latest forecast_run_id), then
 *      convert to hours via VISITS_PER_HOUR.
 *   4. Subtract already-committed hours from prior submissions for the same
 *      state+month with decision_status in (accepted, partial).
 *   5. total_gap = sum of remaining gap-hours across eligible states.
 *   6. requested = parsed_shifts.requested_hours_total.
 *   7. Decision:
 *        - total_gap >= requested        → accepted (accepted_hours=requested,
 *                                          declined_hours=0)
 *        - 0 < total_gap < requested     → partial  (accepted_hours=total_gap,
 *                                          declined_hours=requested-total_gap)
 *        - total_gap <= 0                → declined (accepted_hours=0,
 *                                          declined_hours=requested)
 *
 * Modes:
 *   POST /functions/v1/evaluate-schedule-submissions
 *     → evaluate all submissions where decision_status='pending'
 *   POST /functions/v1/evaluate-schedule-submissions?target_month=YYYY-MM-01
 *     → evaluate every submission for that month (skips ones already decided
 *       unless force=1)
 *   POST /functions/v1/evaluate-schedule-submissions?submission_id=<uuid>
 *     → evaluate a single submission
 *   Add &force=1 to overwrite existing non-pending decisions in this run
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VISITS_PER_HOUR = Number(Deno.env.get('VISITS_PER_HOUR') ?? '1.5');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ParsedShifts = {
  requested_states?: string[];
  requested_hours_total?: number | null;
  shifts?: unknown;
  email?: string | null;
  match_confidence?: string | null;
};

type Submission = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  parsed_shifts: ParsedShifts | null;
  decision_status: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const monthFilter = url.searchParams.get('target_month');
  const submissionIdFilter = url.searchParams.get('submission_id');
  const force = url.searchParams.get('force') === '1';

  const decisionRunId = crypto.randomUUID();
  const counters = { evaluated: 0, accepted: 0, partial: 0, declined: 0, skipped: 0, errors: 0 };
  const decisions: Array<Record<string, unknown>> = [];

  try {
    // ── Load submissions to evaluate ────────────────────────────────────
    let q = supabase
      .from('schedule_submissions')
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status');

    if (submissionIdFilter) {
      q = q.eq('id', submissionIdFilter);
    } else if (monthFilter) {
      q = q.eq('target_month', monthFilter);
      if (!force) q = q.eq('decision_status', 'pending');
    } else {
      q = q.eq('decision_status', 'pending');
    }

    const { data: subs, error: subsErr } = await q;
    if (subsErr) throw new Error(`Failed to load submissions: ${subsErr.message}`);
    const submissions = (subs ?? []) as Submission[];

    if (submissions.length === 0) {
      return json({ ok: true, decision_run_id: decisionRunId, ...counters, message: 'No submissions to evaluate' });
    }

    // ── Preload provider licenses ───────────────────────────────────────
    const providerIds = Array.from(
      new Set(submissions.map(s => s.provider_id).filter((x): x is string => !!x)),
    );
    const licensedStatesByProvider = new Map<string, Set<string>>();
    if (providerIds.length > 0) {
      const { data: licenses } = await supabase
        .from('provider_licenses')
        .select('provider_id, state, status')
        .in('provider_id', providerIds);
      for (const l of licenses ?? []) {
        if (!l.provider_id || !l.state) continue;
        if (l.status && !['active', 'verified', 'pending_renewal'].includes(l.status)) continue;
        const s = String(l.state).trim().toUpperCase();
        if (!licensedStatesByProvider.has(l.provider_id)) {
          licensedStatesByProvider.set(l.provider_id, new Set());
        }
        licensedStatesByProvider.get(l.provider_id)!.add(s);
      }
    }

    // ── Preload demand_forecast for the months in scope ─────────────────
    const months = Array.from(new Set(submissions.map(s => s.target_month)));
    // For each month: sum projected_visits per state across all dates in the
    // month, using the latest baseline forecast_run_id.
    const demandByKey = new Map<string, number>(); // `${state}_${month}` → demand_visits
    for (const month of months) {
      const monthStart = month;
      const next = nextMonth(month);
      const { data: rows } = await supabase
        .from('demand_forecast')
        .select('state, projected_visits, forecast_run_id, is_baseline, computed_at, date')
        .gte('date', monthStart)
        .lt('date', next)
        .eq('is_baseline', true);

      // Pick the latest forecast_run_id (max computed_at) and aggregate
      let latestRunId: string | null = null;
      let latestComputed = 0;
      for (const r of rows ?? []) {
        const ts = r.computed_at ? new Date(r.computed_at).getTime() : 0;
        if (ts > latestComputed) { latestComputed = ts; latestRunId = r.forecast_run_id; }
      }
      if (!latestRunId) continue;

      for (const r of rows ?? []) {
        if (r.forecast_run_id !== latestRunId) continue;
        const st = String(r.state).trim().toUpperCase();
        const k = `${st}_${month}`;
        demandByKey.set(k, (demandByKey.get(k) ?? 0) + Number(r.projected_visits ?? 0));
      }
    }

    // ── Preload already-committed hours per state/month ─────────────────
    const submissionIdsInScope = new Set(submissions.map(s => s.id));
    const committedByKey = new Map<string, number>();
    if (months.length > 0) {
      const { data: committed } = await supabase
        .from('schedule_submissions')
        .select('id, target_month, parsed_shifts, accepted_hours, decision_status')
        .in('target_month', months)
        .in('decision_status', ['accepted', 'partial']);

      for (const c of committed ?? []) {
        if (submissionIdsInScope.has(c.id)) continue;
        const ps = (c.parsed_shifts ?? {}) as ParsedShifts;
        const states = (ps.requested_states ?? []).map(s => s.toUpperCase());
        const hours = typeof c.accepted_hours === 'number' ? c.accepted_hours : 0;
        if (!states.length || hours <= 0 || !c.target_month) continue;
        const perState = hours / states.length;
        for (const st of states) {
          const k = `${st}_${c.target_month}`;
          committedByKey.set(k, (committedByKey.get(k) ?? 0) + perState);
        }
      }
    }

    // ── Evaluate each submission ────────────────────────────────────────
    for (const sub of submissions) {
      try {
        if (!sub.provider_id) {
          counters.skipped++;
          decisions.push({ id: sub.id, status: 'skipped', reason: 'unmatched_provider' });
          continue;
        }

        const ps = (sub.parsed_shifts ?? {}) as ParsedShifts;
        const requestedHours = ps.requested_hours_total ?? null;
        if (!requestedHours || requestedHours <= 0) {
          counters.skipped++;
          decisions.push({ id: sub.id, status: 'skipped', reason: 'no_hours_requested' });
          continue;
        }

        const licensed = licensedStatesByProvider.get(sub.provider_id) ?? new Set<string>();
        const requested = new Set((ps.requested_states ?? []).map(s => s.toUpperCase()));
        const eligibleStates = requested.size === 0
          ? Array.from(licensed)
          : Array.from(requested).filter(s => licensed.has(s));

        if (eligibleStates.length === 0) {
          await writeDecision(supabase, sub.id, {
            status: 'declined',
            accepted_hours: 0,
            declined_hours: requestedHours,
            notes: requested.size === 0
              ? 'Provider has no active licenses on file.'
              : `Provider not licensed in requested states: ${Array.from(requested).join(', ')}`,
            decision_run_id: decisionRunId,
          });
          counters.evaluated++;
          counters.declined++;
          decisions.push({ id: sub.id, status: 'declined', reason: 'no_licensed_states' });
          continue;
        }

        // Compute remaining gap-hours per state, ranked
        const gapByState: Array<{ state: string; gapHours: number; missingDemand: boolean }> = [];
        for (const st of eligibleStates) {
          const key = `${st}_${sub.target_month}`;
          const visits = demandByKey.get(key);
          if (visits === undefined) {
            gapByState.push({ state: st, gapHours: 0, missingDemand: true });
            continue;
          }
          const demandHours = visits / VISITS_PER_HOUR;
          const committed = committedByKey.get(key) ?? 0;
          gapByState.push({ state: st, gapHours: Math.max(0, demandHours - committed), missingDemand: false });
        }
        gapByState.sort((a, b) => b.gapHours - a.gapHours);

        const totalGap = gapByState.reduce((s, g) => s + g.gapHours, 0);
        const missingDemandStates = gapByState.filter(g => g.missingDemand).map(g => g.state);

        let status: 'accepted' | 'partial' | 'declined';
        let accepted: number;
        let declined: number;
        if (totalGap <= 0) {
          status = 'declined';
          accepted = 0;
          declined = requestedHours;
        } else if (totalGap >= requestedHours) {
          status = 'accepted';
          accepted = requestedHours;
          declined = 0;
        } else {
          status = 'partial';
          accepted = round2(totalGap);
          declined = round2(requestedHours - accepted);
        }

        // Allocate accepted hours greedily across states with biggest gaps
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
        noteParts.push(`requested=${requestedHours}h`);
        noteParts.push(`total_gap=${round2(totalGap)}h`);
        if (gapByState.length) {
          noteParts.push(
            'state_gaps=' + gapByState.map(g => `${g.state}:${g.missingDemand ? 'no_data' : round2(g.gapHours) + 'h'}`).join(','),
          );
        }
        if (allocations.length) {
          noteParts.push('alloc=' + allocations.map(a => `${a.state}:${a.hours}h`).join(','));
        }
        if (missingDemandStates.length) {
          noteParts.push(`missing_demand=${missingDemandStates.join(',')}`);
        }
        noteParts.push(`vph=${VISITS_PER_HOUR}`);

        await writeDecision(supabase, sub.id, {
          status,
          accepted_hours: accepted,
          declined_hours: declined,
          notes: noteParts.join('; '),
          decision_run_id: decisionRunId,
        });

        counters.evaluated++;
        if (status === 'accepted') counters.accepted++;
        else if (status === 'partial') counters.partial++;
        else counters.declined++;

        decisions.push({
          id: sub.id,
          provider: sub.provider_name,
          target_month: sub.target_month,
          requested_hours: requestedHours,
          total_gap_hours: round2(totalGap),
          status,
          accepted_hours: accepted,
          declined_hours: declined,
          allocations,
        });

        // Update local committed map so subsequent submissions in this run
        // see this allocation.
        if (accepted > 0 && allocations.length) {
          for (const a of allocations) {
            const k = `${a.state}_${sub.target_month}`;
            committedByKey.set(k, (committedByKey.get(k) ?? 0) + a.hours);
          }
        }
      } catch (e) {
        counters.errors++;
        const message = e instanceof Error ? e.message : String(e);
        decisions.push({ id: sub.id, status: 'error', error: message });
        console.error('Evaluate error', sub.id, message);
      }
    }

    return json({ ok: true, decision_run_id: decisionRunId, ...counters, decisions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message, decision_run_id: decisionRunId, ...counters }, 500);
  }
});

async function writeDecision(
  supabase: ReturnType<typeof createClient>,
  submissionId: string,
  decision: {
    status: 'accepted' | 'partial' | 'declined';
    accepted_hours: number;
    declined_hours: number;
    notes: string;
    decision_run_id: string;
  },
) {
  const { error } = await supabase
    .from('schedule_submissions')
    .update({
      decision_status: decision.status,
      accepted_hours: decision.accepted_hours,
      declined_hours: decision.declined_hours,
      decision_notes: decision.notes,
      decided_at: new Date().toISOString(),
      decision_run_id: decision.decision_run_id,
    })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);
}

function nextMonth(monthStartISO: string): string {
  const [y, m] = monthStartISO.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
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
