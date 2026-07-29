-- September scheduling pipeline support.
--
-- Adds a versioned monthly draft layer around the existing allocator output.
-- Existing schedule_submissions and shift_recommendations remain the source
-- for intake/evaluation; schedule_builds snapshots the allocator output so
-- Review, Lock/Publish, and Amend can stop behaving like a live calculator.

create extension if not exists pgcrypto;

create table if not exists public.schedule_builds (
  id                    uuid primary key default gen_random_uuid(),
  target_month           date not null,
  version_number         integer not null,
  status                 text not null default 'review'
    check (status in ('draft', 'review', 'locked', 'published', 'superseded')),
  source_decision_run_id uuid,
  source                 text not null default 'shift_recommendations_snapshot',
  created_by             uuid,
  created_by_label       text,
  notes                  text,
  locked_at              timestamptz,
  locked_by              uuid,
  locked_by_label        text,
  published_at           timestamptz,
  published_by           uuid,
  published_by_label     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (target_month, version_number)
);

create table if not exists public.schedule_build_rows (
  id                              uuid primary key default gen_random_uuid(),
  build_id                        uuid not null references public.schedule_builds(id) on delete cascade,
  source_shift_recommendation_id  uuid,
  submission_id                   uuid references public.schedule_submissions(id) on delete set null,
  provider_id                     uuid references public.providers(id) on delete set null,
  provider_name                   text not null,
  target_month                    date not null,
  shift_date                      date not null,
  start_min                       integer not null,
  end_min                         integer not null,
  hours                           numeric(6,2) not null check (hours >= 0),
  shift_type                      text not null,
  assigned_state                  text,
  recommendation                  text not null check (recommendation in ('publish', 'cut')),
  recommendation_reason           text,
  decision_run_id                 uuid,
  source_publish_status           text,
  source_published_at             timestamptz,
  source_ehr_posted_at            timestamptz,
  created_at                      timestamptz not null default now()
);

create table if not exists public.scheduling_month_workflows (
  id                  uuid primary key default gen_random_uuid(),
  target_month         date not null unique,
  current_stage        text not null default 'intake'
    check (current_stage in ('intake', 'allocated', 'review', 'locked', 'published', 'amend')),
  active_build_id      uuid references public.schedule_builds(id) on delete set null,
  locked_build_id      uuid references public.schedule_builds(id) on delete set null,
  intake_started_at    timestamptz not null default now(),
  review_started_at    timestamptz,
  locked_at            timestamptz,
  published_at         timestamptz,
  amendment_started_at timestamptz,
  updated_by           uuid,
  updated_by_label     text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.schedule_amendment_requests (
  id                  uuid primary key default gen_random_uuid(),
  target_month         date not null,
  build_id             uuid references public.schedule_builds(id) on delete set null,
  submission_id        uuid references public.schedule_submissions(id) on delete set null,
  provider_id          uuid references public.providers(id) on delete set null,
  provider_name        text not null,
  request_type         text not null default 'resubmission'
    check (request_type in ('resubmission', 'manual_review', 'post_publish_change')),
  status               text not null default 'requested'
    check (status in ('requested', 'approved', 'parked', 'applied', 'rejected')),
  summary              text,
  notes                text,
  requested_by         uuid,
  requested_by_label   text,
  resolved_at          timestamptz,
  resolved_by          uuid,
  resolved_by_label    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists schedule_builds_month_idx
  on public.schedule_builds (target_month, version_number desc);

create index if not exists schedule_build_rows_build_idx
  on public.schedule_build_rows (build_id, provider_name, shift_date);

create index if not exists schedule_build_rows_month_idx
  on public.schedule_build_rows (target_month, recommendation, shift_date);

create index if not exists scheduling_month_workflows_month_idx
  on public.scheduling_month_workflows (target_month);

create index if not exists schedule_amendment_requests_month_idx
  on public.schedule_amendment_requests (target_month, created_at desc);

create index if not exists schedule_amendment_requests_provider_idx
  on public.schedule_amendment_requests (provider_id, created_at desc);

alter table public.schedule_builds enable row level security;
alter table public.schedule_build_rows enable row level security;
alter table public.scheduling_month_workflows enable row level security;
alter table public.schedule_amendment_requests enable row level security;

drop policy if exists "schedule_builds ui read" on public.schedule_builds;
create policy "schedule_builds ui read" on public.schedule_builds
  for select to anon, authenticated using (true);

drop policy if exists "schedule_builds ui write" on public.schedule_builds;
create policy "schedule_builds ui write" on public.schedule_builds
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "schedule_build_rows ui read" on public.schedule_build_rows;
create policy "schedule_build_rows ui read" on public.schedule_build_rows
  for select to anon, authenticated using (true);

drop policy if exists "schedule_build_rows ui write" on public.schedule_build_rows;
create policy "schedule_build_rows ui write" on public.schedule_build_rows
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "scheduling_month_workflows ui read" on public.scheduling_month_workflows;
create policy "scheduling_month_workflows ui read" on public.scheduling_month_workflows
  for select to anon, authenticated using (true);

drop policy if exists "scheduling_month_workflows ui write" on public.scheduling_month_workflows;
create policy "scheduling_month_workflows ui write" on public.scheduling_month_workflows
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "schedule_amendment_requests ui read" on public.schedule_amendment_requests;
create policy "schedule_amendment_requests ui read" on public.schedule_amendment_requests
  for select to anon, authenticated using (true);

drop policy if exists "schedule_amendment_requests ui write" on public.schedule_amendment_requests;
create policy "schedule_amendment_requests ui write" on public.schedule_amendment_requests
  for all to anon, authenticated using (true) with check (true);
