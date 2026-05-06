-- Audit log for the Scheduling Workbench publish flow.
--
-- Sarabjeet asked for visibility into who marked which shifts published to
-- Homebase and the EHR, and when. The shift_recommendations row only stores
-- the LATEST publish_status / actor / timestamp, so reverts and re-evaluations
-- silently overwrite history. This append-only log keeps the full trail.
--
-- One row per action. `action` distinguishes user-driven changes from
-- evaluator-triggered preservation:
--   marked       — user toggled shift to published
--   reverted     — user toggled shift back to pending
--   preserved    — evaluator re-ran; existing publish state was carried
--                  forward onto the freshly emitted shift row
--
-- shift_recommendation_id is NOT a FK because evaluator re-runs delete and
-- re-insert shift_recommendations rows. We snapshot enough provider/shift
-- detail (provider_id, provider_name, shift_date, start_min, end_min,
-- shift_type, target_month) so audit history survives those re-inserts.

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
  step                     text not null
    check (step in ('homebase', 'ehr')),
  action                   text not null
    check (action in ('marked', 'reverted', 'preserved')),
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
create index if not exists publish_audit_log_shift_idx
  on public.publish_audit_log (shift_recommendation_id, created_at desc);

alter table public.publish_audit_log enable row level security;

drop policy if exists "publish_audit_log ui read" on public.publish_audit_log;
create policy "publish_audit_log ui read"
  on public.publish_audit_log
  for select
  to anon, authenticated
  using (true);

drop policy if exists "publish_audit_log ui write" on public.publish_audit_log;
create policy "publish_audit_log ui write"
  on public.publish_audit_log
  for insert
  to anon, authenticated
  with check (true);
