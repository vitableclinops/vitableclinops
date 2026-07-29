-- First-class review handoff metadata for the September scheduling workflow.
--
-- Review start means allocation is frozen into a draft and full-month
-- recalculation closes. Review sign-off means the human-reviewed draft is
-- approved and ready for the publish checklist.

alter table if exists public.schedule_builds
  add column if not exists review_started_at timestamptz,
  add column if not exists review_started_by uuid,
  add column if not exists review_started_by_label text,
  add column if not exists review_signed_off_at timestamptz,
  add column if not exists review_signed_off_by uuid,
  add column if not exists review_signed_off_by_label text;

alter table if exists public.scheduling_month_workflows
  add column if not exists review_started_by uuid,
  add column if not exists review_started_by_label text,
  add column if not exists review_signed_off_at timestamptz,
  add column if not exists review_signed_off_by uuid,
  add column if not exists review_signed_off_by_label text;

update public.schedule_builds
set
  review_started_at = coalesce(review_started_at, created_at),
  review_started_by = coalesce(review_started_by, created_by),
  review_started_by_label = coalesce(review_started_by_label, created_by_label),
  review_signed_off_at = coalesce(review_signed_off_at, locked_at),
  review_signed_off_by = coalesce(review_signed_off_by, locked_by),
  review_signed_off_by_label = coalesce(review_signed_off_by_label, locked_by_label)
where review_started_at is null
   or review_started_by is null
   or review_started_by_label is null
   or (locked_at is not null and review_signed_off_at is null);

update public.scheduling_month_workflows workflow
set
  review_started_by = coalesce(workflow.review_started_by, build.review_started_by),
  review_started_by_label = coalesce(workflow.review_started_by_label, build.review_started_by_label),
  review_signed_off_at = coalesce(workflow.review_signed_off_at, build.review_signed_off_at, workflow.locked_at),
  review_signed_off_by = coalesce(workflow.review_signed_off_by, build.review_signed_off_by),
  review_signed_off_by_label = coalesce(workflow.review_signed_off_by_label, build.review_signed_off_by_label)
from public.schedule_builds build
where workflow.active_build_id = build.id
  and (
    workflow.review_started_by is null
    or workflow.review_started_by_label is null
    or workflow.review_signed_off_at is null
  );

create index if not exists schedule_builds_review_started_idx
  on public.schedule_builds (target_month, review_started_at desc);

create index if not exists schedule_builds_review_signed_off_idx
  on public.schedule_builds (target_month, review_signed_off_at desc);
