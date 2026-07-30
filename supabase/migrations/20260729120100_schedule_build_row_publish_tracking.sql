-- Track Homebase/EHR publishing directly on frozen schedule draft rows.
-- This lets the Publish checklist operate against Draft vN instead of the
-- mutable shift_recommendations table once a monthly build exists.
--
-- ORDER DEPENDENCY: must run AFTER 20260729120000_september_scheduling_pipeline
-- (which creates public.schedule_build_rows). Renamed from a 112611 timestamp
-- that sorted before the create-table migration and broke `supabase db push`.

alter table if exists public.schedule_build_rows
  add column if not exists publish_status text not null default 'pending'
    check (publish_status in ('pending', 'published_to_homebase', 'confirmed', 'cancelled')),
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid,
  add column if not exists ehr_posted_at timestamptz,
  add column if not exists ehr_posted_by uuid;

update public.schedule_build_rows
set
  publish_status = coalesce(source_publish_status, publish_status, 'pending'),
  published_at = coalesce(source_published_at, published_at),
  ehr_posted_at = coalesce(source_ehr_posted_at, ehr_posted_at)
where source_publish_status is not null
   or source_published_at is not null
   or source_ehr_posted_at is not null;

alter table if exists public.publish_audit_log
  add column if not exists schedule_build_row_id uuid references public.schedule_build_rows(id) on delete set null;

create index if not exists schedule_build_rows_publish_status_idx
  on public.schedule_build_rows (build_id, publish_status, shift_date);

create index if not exists publish_audit_log_build_row_idx
  on public.publish_audit_log (schedule_build_row_id, created_at desc);
