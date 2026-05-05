-- Add audit / validation fields populated by evaluate-schedule-submissions.
--
-- Background: previously the validation summary was crammed into
-- decision_notes as a semicolon-delimited string. That works for spot
-- audits but is unqueryable. These columns surface the per-submission
-- validation outcome so the UI, tests, and analytics can consume them
-- directly.
--
-- The raw Jotform submission stays untouched on raw_answers / parsed_shifts;
-- these columns describe the *normalized* view used for forecast decisions.

ALTER TABLE public.schedule_submissions
  -- Per-submission validation rollup (valid | auto_corrected | needs_review |
  -- partially_rejected). Distinct from decision_status, which captures the
  -- forecast outcome (accepted / partial / declined / needs_review / superseded).
  ADD COLUMN IF NOT EXISTS validation_status text,
  -- Sum of original durations (raw entries the provider submitted, before
  -- any AM/PM correction or override). Useful for "what did the provider
  -- type vs what did we use" reports.
  ADD COLUMN IF NOT EXISTS raw_requested_hours numeric,
  -- Sum of corrected durations (after override + default AM/PM corrections),
  -- still pre-dedup and pre-unavailable.
  ADD COLUMN IF NOT EXISTS normalized_requested_hours numeric,
  -- The number actually fed into the forecast approve/deny gap math.
  -- Equals normalized + dedup + minus unavailable, restricted to
  -- forecastKinds (telehealth-only by default).
  ADD COLUMN IF NOT EXISTS effective_hours_used_for_forecast numeric,
  -- Aggregate of every warning string emitted by the validator across
  -- intervals in this group (deduplicated).
  ADD COLUMN IF NOT EXISTS validation_warnings jsonb,
  -- The full normalized timeline (one entry per merged slot) — exact same
  -- structure used to generate shift_recommendations rows.
  ADD COLUMN IF NOT EXISTS normalized_slots jsonb,
  -- Convenience counters; full breakdown lives in validation_summary.
  ADD COLUMN IF NOT EXISTS intervals_auto_corrected integer,
  ADD COLUMN IF NOT EXISTS intervals_needing_review integer,
  ADD COLUMN IF NOT EXISTS hours_removed_for_unavailability numeric,
  ADD COLUMN IF NOT EXISTS hours_removed_for_duplicates numeric,
  ADD COLUMN IF NOT EXISTS hours_changed_by_validation numeric,
  -- Full NormalizationSummary object for any future field we don't promote
  -- to a top-level column.
  ADD COLUMN IF NOT EXISTS validation_summary jsonb;

COMMENT ON COLUMN public.schedule_submissions.validation_status IS
  'Per-submission validation outcome: valid | auto_corrected | needs_review | partially_rejected. Set by evaluate-schedule-submissions.';
COMMENT ON COLUMN public.schedule_submissions.raw_requested_hours IS
  'Sum of original durations as the provider entered them (pre-AM/PM correction, pre-dedup).';
COMMENT ON COLUMN public.schedule_submissions.normalized_requested_hours IS
  'Sum of durations after override / default AM/PM correction (pre-dedup, pre-unavailable).';
COMMENT ON COLUMN public.schedule_submissions.effective_hours_used_for_forecast IS
  'Hours actually fed into the forecast gap math (telehealth-only by default).';
COMMENT ON COLUMN public.schedule_submissions.validation_warnings IS
  'Deduplicated array of warning strings surfaced by the validator.';
COMMENT ON COLUMN public.schedule_submissions.normalized_slots IS
  'Full normalized timeline (post merge / dedup / unavailable subtraction). One row per slot.';

-- Allow needs_review as a decision_status for submissions where the
-- validator surfaced intervals requiring human review. Keeps existing
-- statuses (pending/accepted/partial/declined/superseded).
ALTER TABLE public.schedule_submissions
  DROP CONSTRAINT IF EXISTS schedule_submissions_decision_status_check;

ALTER TABLE public.schedule_submissions
  ADD CONSTRAINT schedule_submissions_decision_status_check
  CHECK (decision_status = ANY (ARRAY[
    'pending'::text,
    'accepted'::text,
    'partial'::text,
    'declined'::text,
    'needs_review'::text,
    'superseded'::text
  ]));
