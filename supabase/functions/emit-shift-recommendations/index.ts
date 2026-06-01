/**
 * emit-shift-recommendations edge function
 *
 * Reads post-decision schedule_submissions and writes per-shift
 * publish/cut rows into shift_recommendations. The output is what the
 * scheduling team uses to enter shifts into Homebase.
 *
 * Runs after evaluate-schedule-submissions has set decision_status,
 * accepted_hours, declined_hours and a decision_notes string that
 * includes "alloc=ST:Hh,..." for the per-state allocations.
 *
 * Timeline parity: this function uses the same shared
 * `buildSubmissionTimeline` / `buildShiftRecommendationRows` helpers as
 * the evaluator. Given the same submissions, the two functions produce
 * the exact same set of slots (and therefore shift rec rows) — guaranteed
 * by tests in availabilityValidation.test.ts.
 *
 * Modes:
 *   POST /functions/v1/emit-shift-recommendations?target_month=YYYY-MM-01
 *   POST /functions/v1/emit-shift-recommendations?provider_id=<uuid>
 *   POST /functions/v1/emit-shift-recommendations
 *     -> all current+future-month submissions with a decision
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildSubmissionTimeline,
  buildShiftRecommendationRows,
  emailFromParsedShifts,
  isScarceCoverageSlot,
  parseAllocationsFromNotes,
  type ParsedShiftsBlob,
} from '../_shared/submissionTimeline.ts';
import { DEFAULT_VALIDATION_CONFIG } from '../_shared/availabilityValidation.ts';

const MH_PROFESSIONS = new Set([
  'MENTAL_HEALTH_COACH',
  'MH_COACH',
  'LPC',
  'THERAPIST',
  'HEALTH_COACH',
]);
const normProfession = (profession: string | null | undefined) =>
  (profession ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const isMentalHealthProfession = (p: string | null | undefined) => {
  if (!p) return false;
  return MH_PROFESSIONS.has(normProfession(p));
};

const MH_MIN_SHIFT_HOURS = 2.5;
const MENTAL_HEALTH_VALIDATION_CONFIG = {
  ...DEFAULT_VALIDATION_CONFIG,
  min_single_shift_hours: MH_MIN_SHIFT_HOURS,
};
const MH_POLICY_CUT_REASON =
  'Cut — mental health shifts must be at least 2.5h (3 visits at 40m with 10m breaks)';
const MH_PUBLISH_REASON =
  'Publish (mental health schedule — weekly SLA; state allocator bypassed)';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Submission = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  parsed_shifts: ParsedShiftsBlob | null;
  decision_status: string;
  accepted_hours: number | null;
  declined_hours: number | null;
  decision_notes: string | null;
  submitted_at: string;
  decision_run_id: string | null;
};

type ProviderProfile = {
  id: string;
  profession: string | null;
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

  const counters = {
    groups: 0,
    rows_inserted: 0,
    rows_deleted: 0,
    skipped_no_decision: 0,
    skipped_needs_review: 0,
    errors: 0,
  };
  const errors: Array<{ submission_id: string; error: string }> = [];

  try {
    let q = supabase
      .from('schedule_submissions')
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, submitted_at, decision_run_id');

    if (monthFilter) q = q.eq('target_month', monthFilter);
    if (providerFilter) q = q.eq('provider_id', providerFilter);
    // We only emit recommendations for groups with a real allocator decision.
    // 'needs_review' rows are intentionally excluded — they require human
    // intervention before any shift can be published.
    q = q.in('decision_status', ['accepted', 'partial', 'declined']);
    q = q.range(0, 49999);

    const { data, error } = await q;
    if (error) throw new Error(`submissions load: ${error.message}`);

    const subs = (data ?? []) as Submission[];

    const groups = new Map<string, Submission[]>();
    for (const s of subs) {
      if (!s.provider_id) continue;
      const k = `${s.provider_id}|${s.target_month}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }

    // Need every submission in the group (including superseded) to rebuild
    // the timeline correctly — superseded rows still contributed slots.
    const providerMonths = Array.from(groups.keys());
    if (providerMonths.length > 0) {
      const providerIds = Array.from(new Set(providerMonths.map(k => k.split('|')[0])));
      const months = Array.from(new Set(providerMonths.map(k => k.split('|')[1])));
      const { data: peers, error: pErr } = await supabase
        .from('schedule_submissions')
        .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, submitted_at, decision_run_id')
        .in('provider_id', providerIds)
        .in('target_month', months)
        .eq('decision_status', 'superseded')
        .range(0, 49999);
      if (pErr) throw new Error(`peer load: ${pErr.message}`);
      for (const s of (peers ?? []) as Submission[]) {
        if (!s.provider_id) continue;
        const k = `${s.provider_id}|${s.target_month}`;
        if (groups.has(k)) groups.get(k)!.push(s);
      }
    }

    const providerIdsForEmit = Array.from(new Set(
      Array.from(groups.keys()).map(k => k.split('|')[0]),
    ));
    const professionByProvider = new Map<string, string | null>();
    if (providerIdsForEmit.length > 0) {
      const { data: providers, error: provErr } = await supabase
        .from('providers')
        .select('id, profession')
        .in('id', providerIdsForEmit);
      if (provErr) throw new Error(`provider load: ${provErr.message}`);
      for (const provider of (providers ?? []) as ProviderProfile[]) {
        professionByProvider.set(provider.id, provider.profession ?? null);
      }
    }

    for (const [key, groupSubs] of groups) {
      try {
        counters.groups++;
        const decided = groupSubs
          .filter(s => s.decision_status !== 'superseded')
          .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
        if (!decided) {
          counters.skipped_no_decision++;
          continue;
        }
        if (decided.decision_status === 'needs_review') {
          counters.skipped_needs_review++;
          continue;
        }
        const isMentalHealth =
          isMentalHealthProfession(professionByProvider.get(decided.provider_id!)) ||
          (decided.decision_notes ?? '').includes('mental_health_bypass');

        const ids = groupSubs.map(s => s.id);
        const { count: deletedCount, error: dErr } = await supabase
          .from('shift_recommendations')
          .delete({ count: 'exact' })
          .in('submission_id', ids);
        if (dErr) throw new Error(`delete prior: ${dErr.message}`);
        counters.rows_deleted += deletedCount ?? 0;

        // Build the canonical timeline using the same shared pipeline that
        // the evaluator used. Inputs (submissions, identity, target_month)
        // produce identical timelines on both sides.
        const validation = buildSubmissionTimeline(
          groupSubs.map(s => ({
            id: s.id,
            submitted_at: s.submitted_at,
            parsed_shifts: s.parsed_shifts ?? null,
          })),
          {
            providerId: decided.provider_id,
            email: emailFromParsedShifts(decided.parsed_shifts),
            name: decided.provider_name,
          },
          decided.target_month,
          isMentalHealth ? { config: MENTAL_HEALTH_VALIDATION_CONFIG } : {},
        );

        if (
          validation.timeline.length === 0 &&
          validation.forecastOutOfHoursTimeline.length === 0 &&
          validation.forecastPolicyCutTimeline.length === 0
        ) continue;

        const declined = Number(decided.declined_hours ?? 0);
        const allocations = parseAllocationsFromNotes(decided.decision_notes ?? '');
        // declined_hours stored on the row includes forecast cuts plus
        // policy cuts (outside operating hours, MH minimum-shift failures).
        // Policy cuts are re-emitted from their dedicated timelines, so we
        // subtract them here to leave only the forecast cut budget.
        const oohHours = Math.round((validation.summary.hours_removed_for_operating_hours ?? 0) * 100) / 100;
        const policyHours = Math.round((validation.summary.hours_removed_for_minimum_shift ?? 0) * 100) / 100;
        const forecastDeclined = Math.max(0, Math.round((declined - oohHours - policyHours) * 100) / 100);
        const protectScarceWindows = (decided.decision_notes ?? '')
          .includes('scarce_window_policy=protected_before_monthly_trim');
        const protectedForecastTimeline = protectScarceWindows
          ? validation.forecastTimeline.filter(isScarceCoverageSlot)
          : [];

        const rows = buildShiftRecommendationRows({
          providerId: decided.provider_id!,
          providerName: decided.provider_name,
          targetMonth: decided.target_month,
          timeline: validation.timeline,
          forecastTimeline: validation.forecastTimeline,
          outOfHoursTimeline: validation.forecastOutOfHoursTimeline,
          policyCutTimeline: validation.forecastPolicyCutTimeline,
          policyCutReason: isMentalHealth ? MH_POLICY_CUT_REASON : undefined,
          unallocatedForecastPublishReason: isMentalHealth ? MH_PUBLISH_REASON : undefined,
          protectedForecastTimeline,
          declinedHours: forecastDeclined,
          declineAll: decided.decision_status === 'declined',
          allocations,
          decisionRunId: decided.decision_run_id ?? crypto.randomUUID(),
        });

        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const { error: iErr } = await supabase.from('shift_recommendations').insert(chunk);
          if (iErr) throw new Error(`insert: ${iErr.message}`);
          counters.rows_inserted += chunk.length;
        }
      } catch (e) {
        counters.errors++;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ submission_id: key, error: msg });
        console.error('group failed', key, msg);
      }
    }

    return json({ ok: true, ...counters, errors });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err), ...counters }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
