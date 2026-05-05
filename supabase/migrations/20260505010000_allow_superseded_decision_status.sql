-- Allow 'superseded' as a decision_status. When a provider resubmits for the
-- same (provider_id, target_month), older submissions in the group get this
-- status so the latest one carries the canonical decision while the older
-- rows remain visible for audit.

ALTER TABLE public.schedule_submissions
  DROP CONSTRAINT IF EXISTS schedule_submissions_decision_status_check;

ALTER TABLE public.schedule_submissions
  ADD CONSTRAINT schedule_submissions_decision_status_check
  CHECK (decision_status = ANY (ARRAY[
    'pending'::text,
    'accepted'::text,
    'partial'::text,
    'declined'::text,
    'superseded'::text
  ]));
