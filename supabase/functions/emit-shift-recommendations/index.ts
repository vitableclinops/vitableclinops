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
  type ShiftRecommendationRow,
} from '../_shared/submissionTimeline.ts';
import { DEFAULT_VALIDATION_CONFIG } from '../_shared/availabilityValidation.ts';

const MH_COACHING_PROFESSIONS = new Set([
  'MENTAL_HEALTH_COACH',
  'MH_COACH',
  'HEALTH_COACH',
]);
const THERAPY_PROFESSIONS = new Set([
  'LPC',
  'LCSW',
  'LICSW',
  'LMFT',
  'MFT',
  'LMHC',
  'THERAPIST',
  'LICENSED_CLINICAL_SOCIAL_WORKER',
  'LICENSED_PROFESSIONAL_COUNSELOR',
]);
const MENTAL_HEALTH_PROVIDER_OVERRIDES = new Map<string, 'mh_coaching' | 'therapy'>([
  ['matthew vazquez', 'mh_coaching'],
  ['matthew vasquez', 'mh_coaching'],
  ['jamie fuentes', 'mh_coaching'],
  ['jennifer yost', 'mh_coaching'],
  ['esha shah', 'mh_coaching'],
  ['liana griebsch', 'mh_coaching'],
  ['li griebsch', 'mh_coaching'],
  ['li greibsch', 'mh_coaching'],
  ['michelle diederich', 'mh_coaching'],
  ['margaret margo mulgrew', 'therapy'],
  ['margaret mulgrew', 'therapy'],
  ['margo mulgrew', 'therapy'],
  ['richard travis rash', 'therapy'],
  ['richard rash', 'therapy'],
  ['mishelle lockerby', 'therapy'],
  ['mishelle lockerby direct shifts', 'therapy'],
]);
const normProfession = (profession: string | null | undefined) =>
  (profession ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const normProviderName = (name: string | null | undefined) =>
  (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const isMentalHealthProvider = (
  profession: string | null | undefined,
  ...providerNames: Array<string | null | undefined>
) => {
  for (const providerName of providerNames) {
    if (MENTAL_HEALTH_PROVIDER_OVERRIDES.has(normProviderName(providerName))) return true;
  }
  const norm = normProfession(profession);
  return MH_COACHING_PROFESSIONS.has(norm) || THERAPY_PROFESSIONS.has(norm);
};

// Policy (Jul 2026): MH providers no longer have a hard 2.5h minimum shift,
// and weekend after-hours shifts are approvable (weekend window extended to
// full day). Weekday operating-hours window remains 9a–9p ET.
const MH_MIN_SHIFT_HOURS = 0;
const MENTAL_HEALTH_VALIDATION_CONFIG = {
  ...DEFAULT_VALIDATION_CONFIG,
  min_single_shift_hours: MH_MIN_SHIFT_HOURS,
  weekend_window_start_min: 0,
  weekend_window_end_min: 24 * 60,
};
const OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG = {
  ...DEFAULT_VALIDATION_CONFIG,
  weekday_window_start_min: 0,
  weekday_window_end_min: 24 * 60,
  weekend_window_start_min: 0,
  weekend_window_end_min: 24 * 60,
};
const MH_OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG = {
  ...OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG,
  min_single_shift_hours: MH_MIN_SHIFT_HOURS,
};
const MH_POLICY_CUT_REASON =
  'Cut — mental health shift policy violation';
const MH_PUBLISH_REASON =
  'Publish (mental health service-line forecast; state allocator bypassed)';

const shiftKey = (r: {
  submission_id: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  shift_type: string;
}) =>
  `${r.submission_id}|${r.shift_date}|${r.start_min}|${r.end_min}|${r.shift_type}`;

function assertUniqueShiftRecommendationRows(rows: ShiftRecommendationRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = shiftKey(row);
    if (seen.has(key)) {
      throw new Error(`duplicate shift_recommendations row generated for ${key}`);
    }
    seen.add(key);
  }
}

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
  human_review_state?: string | null;
};

// Human-review states that indicate the submission has been manually
// pinned by ops. When ops sets a submission to 'pending' (via the Inbox)
// or 'parked', the current shift_recommendations rows are the source of
// truth and MUST NOT be deleted/rebuilt from parsed_shifts. Same lock
// applies inside evaluate-schedule-submissions (see lines ~1424).
const HUMAN_LOCK_STATES = new Set(['pending', 'parked']);

type ProviderProfile = {
  id: string;
  name: string | null;
  profession: string | null;
};

type PublishedShiftLockRow = {
  id: string;
  submission_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  target_month: string | null;
  shift_date: string | null;
  start_min: number | string | null;
  end_min: number | string | null;
  hours: number | string | null;
  shift_type: string | null;
  assigned_state: string | null;
  recommendation?: string | null;
  publish_status: string | null;
  published_at: string | null;
  published_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
  homebase_shift_id: string | null;
};

type PreservedPublishState = {
  publish_status: string;
  published_at: string | null;
  published_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
  homebase_shift_id: string | null;
};

type ShiftRecommendationWriteRow = Omit<ShiftRecommendationRow, 'publish_status'> & {
  publish_status: string;
  published_at?: string | null;
  published_by?: string | null;
  ehr_posted_at?: string | null;
  ehr_posted_by?: string | null;
  homebase_shift_id?: string | null;
};

const LOCKED_PUBLISH_STATUSES = new Set(['published_to_homebase', 'confirmed']);

const isLockedPublishStatus = (status: string | null | undefined) =>
  LOCKED_PUBLISH_STATUSES.has(status ?? '');

const numeric = (value: number | string | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const recommendationOverlapsPublishedLock = (
  row: ShiftRecommendationRow,
  lock: PublishedShiftLockRow,
) => {
  if (!row.provider_id || row.provider_id !== lock.provider_id) return false;
  if (row.target_month !== String(lock.target_month ?? '').slice(0, 10)) return false;
  if (row.shift_date !== String(lock.shift_date ?? '').slice(0, 10)) return false;
  const lockStart = numeric(lock.start_min);
  const lockEnd = numeric(lock.end_min);
  return lockStart < row.end_min && row.start_min < lockEnd;
};

const hasManualOutsideOperatingHoursException = (
  parsedShifts: Submission['parsed_shifts'],
) => {
  if (!parsedShifts || typeof parsedShifts !== 'object' || Array.isArray(parsedShifts)) {
    return false;
  }
  const correction = parsedShifts.clinops_manual_correction;
  return Boolean(
    correction &&
      typeof correction === 'object' &&
      !Array.isArray(correction) &&
      (correction as Record<string, unknown>).allow_outside_operating_hours === true,
  );
};

const validationOptionsForSubmission = (
  latest: Submission,
  isMentalHealth: boolean,
) => {
  const allowOutsideOperatingHours = hasManualOutsideOperatingHoursException(latest.parsed_shifts);
  if (allowOutsideOperatingHours) {
    return {
      options: {
        config: isMentalHealth
          ? MH_OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG
          : OUTSIDE_OPERATING_HOURS_EXCEPTION_CONFIG,
      },
    };
  }
  return {
    options: isMentalHealth ? { config: MENTAL_HEALTH_VALIDATION_CONFIG } : {},
  };
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
      .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, submitted_at, decision_run_id, human_review_state');

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

    // Load superseded peers so their stale recommendation rows can be deleted
    // AND so they participate in the merged timeline — the evaluator uses the
    // full resubmission chain (prior + latest) via buildSubmissionTimeline,
    // and emit must match to produce the same slots.
    const providerMonths = Array.from(groups.keys());
    if (providerMonths.length > 0) {
      const providerIds = Array.from(new Set(providerMonths.map(k => k.split('|')[0])));
      const months = Array.from(new Set(providerMonths.map(k => k.split('|')[1])));
      const { data: peers, error: pErr } = await supabase
        .from('schedule_submissions')
        .select('id, provider_id, provider_name, target_month, parsed_shifts, decision_status, accepted_hours, declined_hours, decision_notes, submitted_at, decision_run_id, human_review_state')
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
    const providerProfileByProvider = new Map<string, ProviderProfile>();
    if (providerIdsForEmit.length > 0) {
      const { data: providers, error: provErr } = await supabase
        .from('providers')
        .select('id, name, profession')
        .in('id', providerIdsForEmit);
      if (provErr) throw new Error(`provider load: ${provErr.message}`);
      for (const provider of (providers ?? []) as ProviderProfile[]) {
        providerProfileByProvider.set(provider.id, provider);
      }
    }

    for (const [key, groupSubs] of groups) {
      try {
        counters.groups++;
        const activeGroupSubs = groupSubs.filter(s => s.decision_status !== 'superseded');
        const decided = activeGroupSubs
          .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
        if (!decided) {
          counters.skipped_no_decision++;
          continue;
        }
        if (decided.decision_status === 'needs_review') {
          counters.skipped_needs_review++;
          continue;
        }
        // Ops manual lock — leave shift_recommendations rows untouched.
        // Setting human_review_state to 'pending' or 'parked' is how ops
        // pins a manually-corrected submission so subsequent emit/eval
        // runs don't reset the fix.
        if (HUMAN_LOCK_STATES.has(decided.human_review_state ?? '')) {
          counters.skipped_needs_review++;
          continue;
        }
        const providerProfile = providerProfileByProvider.get(decided.provider_id!);
        const isMentalHealth =
          isMentalHealthProvider(
            providerProfile?.profession,
            providerProfile?.name,
            decided.provider_name,
          ) ||
          (decided.decision_notes ?? '').includes('mental_health_bypass');

        const ids = groupSubs.map(s => s.id);
        const { data: priorRows, error: priorErr } = await supabase
          .from('shift_recommendations')
          .select(
            'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, hours, shift_type, assigned_state, recommendation, publish_status, published_at, published_by, ehr_posted_at, ehr_posted_by, homebase_shift_id',
          )
          .in('submission_id', ids);
        if (priorErr) throw new Error(`read prior: ${priorErr.message}`);

        const priorByKey = new Map<string, typeof priorRows[number]>();
        for (const prior of priorRows ?? []) priorByKey.set(shiftKey(prior), prior);
        const lockedPriorRows = ((priorRows ?? []) as PublishedShiftLockRow[])
          .filter(row => row.recommendation === 'publish' && isLockedPublishStatus(row.publish_status));
        const unlockedPriorIds = (priorRows ?? [])
          .filter(row => !isLockedPublishStatus(row.publish_status))
          .map(row => row.id)
          .filter(Boolean);
        if (unlockedPriorIds.length > 0) {
          const { count: deletedCount, error: dErr } = await supabase
            .from('shift_recommendations')
            .delete({ count: 'exact' })
            .in('id', unlockedPriorIds);
          if (dErr) throw new Error(`delete prior: ${dErr.message}`);
          counters.rows_deleted += deletedCount ?? 0;
        }

        // Build the canonical timeline using the same shared pipeline that
        // the evaluator used. Inputs (submissions, identity, target_month)
        // produce identical timelines on both sides.
        const validationSelection = validationOptionsForSubmission(decided, isMentalHealth);
        // Include superseded peers in the timeline so the evaluator's merged
        // resubmission timeline is reproduced exactly here.
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
          validationSelection.options,
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
        assertUniqueShiftRecommendationRows(rows);
        const mergedRows: ShiftRecommendationWriteRow[] = [];
        for (const row of rows) {
          const overlappingLock = lockedPriorRows.find(lock =>
            recommendationOverlapsPublishedLock(row, lock),
          );
          if (overlappingLock) continue;
          const prior = priorByKey.get(shiftKey(row));
          if (!prior) {
            mergedRows.push(row);
            continue;
          }
          const carry: PreservedPublishState = {
            publish_status: prior.publish_status,
            published_at: prior.published_at,
            published_by: prior.published_by,
            ehr_posted_at: prior.ehr_posted_at,
            ehr_posted_by: prior.ehr_posted_by,
            homebase_shift_id: prior.homebase_shift_id,
          };
          mergedRows.push({ ...row, ...carry });
        }

        const CHUNK = 500;
        for (let i = 0; i < mergedRows.length; i += CHUNK) {
          const chunk = mergedRows.slice(i, i + CHUNK);
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
