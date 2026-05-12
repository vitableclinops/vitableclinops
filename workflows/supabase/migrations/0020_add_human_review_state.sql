-- Human-review state for resubmissions. ClinOps reviews via the Workbench
-- Inbox tab and Approves or Parks each new submission that differs from the
-- prior decided submission for the same (provider, target_month).
--
-- State machine:
--   NULL       — no review required (single submission or already resolved
--                pre-feature)
--   pending    — set by the evaluator when a fresh submission differs from
--                the prior decided one; evaluator skips the group until a
--                human resolves it
--   approved   — ClinOps approved the new submission as authoritative; next
--                evaluator run picks it up normally
--   parked     — ClinOps rejected the new submission for now; evaluator
--                treats it as superseded so the prior submission stays
--                authoritative. Can be returned to 'pending' later.

alter table public.schedule_submissions
  add column if not exists human_review_state text
    check (human_review_state in ('pending', 'approved', 'parked')),
  add column if not exists human_review_resolved_at timestamptz,
  add column if not exists human_review_resolved_by uuid,
  add column if not exists human_review_resolved_label text,
  add column if not exists human_review_notes text;

create index if not exists schedule_submissions_human_review_idx
  on public.schedule_submissions (human_review_state)
  where human_review_state is not null;
