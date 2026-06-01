-- July Scheduling Workbench data-flow support.
--
-- Safe patch migration for the ClinOps project (bbquooftytwprllipcsb). It
-- aligns the database with the current workbench/evaluator code without
-- replaying the older workflow reset migrations.

create extension if not exists pgcrypto;

-- schedule_submissions: evaluator statuses + validation/debug columns.
alter table if exists public.schedule_submissions
  drop constraint if exists schedule_submissions_decision_status_check;

alter table if exists public.schedule_submissions
  add constraint schedule_submissions_decision_status_check
  check (decision_status in ('pending', 'accepted', 'partial', 'declined', 'needs_review', 'superseded'));

alter table if exists public.schedule_submissions
  add column if not exists raw_requested_hours numeric(8,2),
  add column if not exists normalized_requested_hours numeric(8,2),
  add column if not exists effective_hours_used_for_forecast numeric(8,2),
  add column if not exists validation_status text,
  add column if not exists validation_warnings jsonb,
  add column if not exists validation_summary jsonb,
  add column if not exists normalized_slots jsonb,
  add column if not exists intervals_auto_corrected integer,
  add column if not exists intervals_needing_review integer,
  add column if not exists hours_removed_for_unavailability numeric(8,2),
  add column if not exists hours_removed_for_duplicates numeric(8,2),
  add column if not exists hours_changed_by_validation numeric(8,2),
  add column if not exists human_review_state text
    check (human_review_state in ('pending', 'approved', 'parked')),
  add column if not exists human_review_resolved_at timestamptz,
  add column if not exists human_review_resolved_by uuid,
  add column if not exists human_review_resolved_label text,
  add column if not exists human_review_notes text;

create index if not exists schedule_submissions_human_review_idx
  on public.schedule_submissions (human_review_state)
  where human_review_state is not null;

create index if not exists schedule_submissions_provider_month_idx
  on public.schedule_submissions (provider_id, target_month, submitted_at desc);

-- Per-shift recommendations emitted by evaluate-schedule-submissions.
create table if not exists public.shift_recommendations (
  id                     uuid primary key default gen_random_uuid(),
  submission_id          uuid not null references public.schedule_submissions(id) on delete cascade,
  provider_id            uuid references public.providers(id) on delete set null,
  provider_name          text not null,
  target_month           date not null,
  shift_date             date not null,
  start_min              integer not null,
  end_min                integer not null,
  hours                  numeric(6,2) not null check (hours >= 0),
  shift_type             text not null,
  assigned_state         text,
  recommendation         text not null check (recommendation in ('publish', 'cut')),
  recommendation_reason  text,
  decision_run_id        uuid not null,
  publish_status         text not null default 'pending'
    check (publish_status in ('pending', 'published_to_homebase', 'confirmed', 'cancelled')),
  published_at           timestamptz,
  published_by           uuid,
  ehr_posted_at          timestamptz,
  ehr_posted_by          uuid,
  homebase_shift_id      text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.shift_recommendations
  add column if not exists ehr_posted_at timestamptz,
  add column if not exists ehr_posted_by uuid,
  add column if not exists homebase_shift_id text,
  add column if not exists notes text;

create index if not exists shift_recommendations_month_idx
  on public.shift_recommendations (target_month, recommendation, shift_date);
create index if not exists shift_recommendations_provider_month_idx
  on public.shift_recommendations (provider_id, target_month);
create index if not exists shift_recommendations_submission_idx
  on public.shift_recommendations (submission_id);

-- Aggregate provider-level fallback publish status for providers that do not
-- yet have per-shift rows.
create table if not exists public.publish_status (
  id                  uuid primary key default gen_random_uuid(),
  provider_id          uuid not null references public.providers(id) on delete cascade,
  target_month         date not null,
  homebase_posted_at   timestamptz,
  homebase_posted_by   uuid,
  ehr_posted_at        timestamptz,
  ehr_posted_by        uuid,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider_id, target_month)
);

-- Append-only publish audit.
create table if not exists public.publish_audit_log (
  id                       uuid primary key default gen_random_uuid(),
  shift_recommendation_id  uuid,
  submission_id            uuid,
  provider_id              uuid,
  provider_name            text,
  target_month             date,
  shift_date               date,
  start_min                integer,
  end_min                  integer,
  shift_type               text,
  step                     text not null check (step in ('homebase', 'ehr')),
  action                   text not null check (action in ('marked', 'reverted', 'preserved')),
  actor_id                 uuid,
  actor_label              text,
  notes                    text,
  created_at               timestamptz not null default now()
);

create index if not exists publish_audit_log_created_idx
  on public.publish_audit_log (created_at desc);
create index if not exists publish_audit_log_target_month_idx
  on public.publish_audit_log (target_month, created_at desc);
create index if not exists publish_audit_log_provider_idx
  on public.publish_audit_log (provider_id, created_at desc);

-- Manual needs-review resolutions.
create table if not exists public.submission_override_log (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid references public.schedule_submissions(id) on delete cascade,
  prior_status    text,
  new_status      text not null,
  hours_basis     numeric(8,2),
  reason          text not null,
  actor_id        uuid,
  actor_label     text,
  created_at      timestamptz not null default now()
);

create index if not exists submission_override_log_submission_idx
  on public.submission_override_log (submission_id, created_at desc);

-- Optional monthly cost inputs used by v_monthly_cost_per_visit.
create table if not exists public.monthly_appointment_totals (
  id                    uuid primary key default gen_random_uuid(),
  month_start            date not null unique,
  total_appointments     integer,
  completed_appointments integer,
  total_wages_paid       numeric(12,2),
  data_source            text,
  notes                  text,
  imported_at            timestamptz not null default now()
);

-- Views consumed by evaluator and forecast hooks.
create or replace view public.v_monthly_demand as
select
  state,
  date_trunc('month', date)::date as month,
  sum(projected_visits)::numeric as total_visits
from public.demand_forecast
where is_baseline = true
group by state, date_trunc('month', date)::date;

drop view if exists public.v_provider_shift_summary;
create view public.v_provider_shift_summary as
select
  provider_id,
  provider_name,
  target_month,
  count(*)::integer as total_shifts,
  count(*) filter (where recommendation = 'publish')::integer as publish_count,
  coalesce(sum(hours) filter (where recommendation = 'publish'), 0)::numeric as publish_hours,
  count(*) filter (where recommendation = 'cut')::integer as cut_count,
  coalesce(sum(hours) filter (where recommendation = 'cut'), 0)::numeric as cut_hours,
  count(*) filter (where publish_status = 'pending' and recommendation = 'publish')::integer as pending_publish,
  count(*) filter (where publish_status in ('published_to_homebase', 'confirmed'))::integer as published_count,
  count(*) filter (where publish_status = 'confirmed')::integer as confirmed_count
from public.shift_recommendations
group by provider_id, provider_name, target_month;

create or replace view public.v_monthly_cost_per_visit as
select
  month_start,
  total_appointments,
  completed_appointments,
  total_wages_paid,
  case
    when total_appointments > 0 and total_wages_paid is not null
      then total_wages_paid / total_appointments
    else null
  end as approx_cost_per_scheduled_appointment,
  case
    when completed_appointments > 0 and total_wages_paid is not null
      then total_wages_paid / completed_appointments
    else null
  end as approx_cost_per_completed_visit,
  case
    when total_appointments > 0 and completed_appointments is not null
      then completed_appointments::numeric / total_appointments
    else null
  end as completion_rate
from public.monthly_appointment_totals;

-- Frontend read/write policies for the scheduling workbench's publishable
-- ClinOps client. Service-role edge functions bypass RLS.
alter table if exists public.providers enable row level security;
alter table if exists public.provider_licenses enable row level security;
alter table if exists public.state_demand_targets enable row level security;
alter table if exists public.sla_daily enable row level security;
alter table if exists public.schedule_submissions enable row level security;
alter table if exists public.shift_recommendations enable row level security;
alter table if exists public.publish_status enable row level security;
alter table if exists public.publish_audit_log enable row level security;
alter table if exists public.submission_override_log enable row level security;
alter table if exists public.monthly_appointment_totals enable row level security;

drop policy if exists "providers ui read" on public.providers;
create policy "providers ui read" on public.providers
  for select to anon, authenticated using (true);

drop policy if exists "provider_licenses ui read" on public.provider_licenses;
create policy "provider_licenses ui read" on public.provider_licenses
  for select to anon, authenticated using (true);

drop policy if exists "state_demand_targets ui read" on public.state_demand_targets;
create policy "state_demand_targets ui read" on public.state_demand_targets
  for select to anon, authenticated using (true);

drop policy if exists "sla_daily ui read" on public.sla_daily;
create policy "sla_daily ui read" on public.sla_daily
  for select to anon, authenticated using (true);

drop policy if exists "schedule_submissions ui read" on public.schedule_submissions;
create policy "schedule_submissions ui read" on public.schedule_submissions
  for select to anon, authenticated using (true);

drop policy if exists "schedule_submissions ui update" on public.schedule_submissions;
create policy "schedule_submissions ui update" on public.schedule_submissions
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "shift_recommendations ui read" on public.shift_recommendations;
create policy "shift_recommendations ui read" on public.shift_recommendations
  for select to anon, authenticated using (true);

drop policy if exists "shift_recommendations ui update" on public.shift_recommendations;
create policy "shift_recommendations ui update" on public.shift_recommendations
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "publish_status ui read" on public.publish_status;
create policy "publish_status ui read" on public.publish_status
  for select to anon, authenticated using (true);

drop policy if exists "publish_status ui write" on public.publish_status;
create policy "publish_status ui write" on public.publish_status
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "publish_audit_log ui read" on public.publish_audit_log;
create policy "publish_audit_log ui read" on public.publish_audit_log
  for select to anon, authenticated using (true);

drop policy if exists "publish_audit_log ui write" on public.publish_audit_log;
create policy "publish_audit_log ui write" on public.publish_audit_log
  for insert to anon, authenticated with check (true);

drop policy if exists "submission_override_log ui write" on public.submission_override_log;
create policy "submission_override_log ui write" on public.submission_override_log
  for insert to anon, authenticated with check (true);

drop policy if exists "monthly_appointment_totals ui read" on public.monthly_appointment_totals;
create policy "monthly_appointment_totals ui read" on public.monthly_appointment_totals
  for select to anon, authenticated using (true);
