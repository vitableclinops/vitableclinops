-- Extend provider_utilization_daily so the Daily Provider Utilization
-- Metabase card can persist unique slot counts for the SD/ND access report.
--
-- Older deployments only had provider_id/date/utilization_pct. The card now
-- returns provider names plus total slots and utilization; booked slots are
-- derived during sync when Metabase does not send them explicitly.

alter table public.provider_utilization_daily
  add column if not exists provider_name text,
  add column if not exists util_date date,
  add column if not exists booked_timeslots integer,
  add column if not exists total_timeslots integer,
  add column if not exists imported_at timestamptz not null default now(),
  add column if not exists source text,
  add column if not exists synced_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.provider_utilization_daily
  alter column provider_id drop not null,
  alter column data_source set default 'metabase_sync';

update public.provider_utilization_daily
set util_date = date
where util_date is null
  and date is not null;

create unique index if not exists provider_utilization_daily_provider_name_util_date_idx
  on public.provider_utilization_daily (provider_name, util_date);

create index if not exists provider_utilization_daily_util_date_idx
  on public.provider_utilization_daily (util_date);
