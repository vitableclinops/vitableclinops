-- Provider-state allocation sources for the July Scheduling Workbench.
--
-- The evaluator should not treat Homebase as the month-ahead scheduling
-- source of truth. Month-ahead eligibility now comes from:
--   * provider_licenses                         (existing/manual ClinOps)
--   * medallion_provider_licenses              (Medallion API)
--   * directshifts_provider_licenses           (static DirectShifts input)
--   * provider_state_active                    (live Metabase active-state overlay)

create extension if not exists pgcrypto;

create table if not exists public.medallion_provider_licenses (
  id                      uuid primary key default gen_random_uuid(),
  medallion_license_key   text not null unique,
  provider_id             uuid references public.providers(id) on delete set null,
  medallion_provider_id   text,
  provider_email          text,
  provider_name           text,
  state                   text not null check (state ~ '^[A-Z]{2}$'),
  status                  text not null default 'active',
  license_number          text,
  license_type            text,
  issue_date              date,
  expiration_date         date,
  source                  text not null default 'medallion_api',
  raw_payload             jsonb not null default '{}'::jsonb,
  synced_at               timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists medallion_provider_licenses_provider_idx
  on public.medallion_provider_licenses (provider_id, state);
create index if not exists medallion_provider_licenses_medallion_provider_idx
  on public.medallion_provider_licenses (medallion_provider_id);
create index if not exists medallion_provider_licenses_state_idx
  on public.medallion_provider_licenses (state, status);

create table if not exists public.directshifts_provider_licenses (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid references public.providers(id) on delete set null,
  provider_email    text,
  provider_name     text,
  state             text not null check (state ~ '^[A-Z]{2}$'),
  status            text not null default 'active',
  license_number    text,
  license_type      text,
  effective_from    date,
  effective_to      date,
  notes             text,
  source            text not null default 'directshifts_static',
  raw_payload       jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists directshifts_provider_licenses_provider_state_idx
  on public.directshifts_provider_licenses (provider_id, state, source)
  where provider_id is not null;
create unique index if not exists directshifts_provider_licenses_email_state_idx
  on public.directshifts_provider_licenses (lower(provider_email), state, source)
  where provider_id is null and provider_email is not null;
create index if not exists directshifts_provider_licenses_state_idx
  on public.directshifts_provider_licenses (state, status);

create table if not exists public.metabase_pcp_state_coverage (
  id              uuid primary key default gen_random_uuid(),
  row_key         text not null unique,
  provider_id     uuid references public.providers(id) on delete set null,
  provider_email  text,
  provider_name   text,
  npi             text,
  state           text not null check (state ~ '^[A-Z]{2}$'),
  is_active       boolean,
  active_members  integer,
  pcp_count       integer,
  coverage_pct    numeric(6,2),
  report_date     date not null,
  source_card_id  integer not null default 2940,
  raw_payload     jsonb not null default '{}'::jsonb,
  synced_at       timestamptz not null default now()
);

create index if not exists metabase_pcp_state_coverage_provider_idx
  on public.metabase_pcp_state_coverage (provider_id, state, report_date desc);
create index if not exists metabase_pcp_state_coverage_state_idx
  on public.metabase_pcp_state_coverage (state, report_date desc);

create table if not exists public.provider_state_active (
  provider_id   uuid not null references public.providers(id) on delete cascade,
  state         text not null check (state ~ '^[A-Z]{2}$'),
  is_active     boolean not null default true,
  synced_at     timestamptz not null default now(),
  primary key (provider_id, state)
);

alter table public.provider_state_active
  add column if not exists source text not null default 'manual',
  add column if not exists report_date date,
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists provider_name text,
  add column if not exists provider_email text;

alter table public.provider_state_active
  drop constraint if exists provider_state_active_pkey;

alter table public.provider_state_active
  add constraint provider_state_active_pkey primary key (provider_id, state, source);

create index if not exists provider_state_active_source_idx
  on public.provider_state_active (source, synced_at desc);
create index if not exists provider_state_active_state_idx
  on public.provider_state_active (state, is_active);

create table if not exists public.sync_runs (
  id              uuid primary key default gen_random_uuid(),
  function_name   text not null,
  status          text not null default 'running',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer,
  rows_processed  integer default 0,
  rows_failed     integer default 0,
  error_message   text,
  details         jsonb not null default '{}'::jsonb
);

create index if not exists sync_runs_function_started_idx
  on public.sync_runs (function_name, started_at desc);

drop view if exists public.v_provider_state_allocation_sources;
drop view if exists public.v_provider_state_eligibility;
create view public.v_provider_state_eligibility as
with license_candidates as (
  select
    pl.provider_id,
    upper(pl.state) as state,
    'provider_licenses'::text as source,
    pl.status,
    pl.license_number,
    pl.expiration_date,
    pl.updated_at
  from public.provider_licenses pl
  where pl.provider_id is not null
    and pl.state is not null
    and lower(coalesce(pl.status, 'active')) in ('active', 'verified', 'pending_renewal')
    and (pl.expiration_date is null or pl.expiration_date >= current_date)

  union all

  select
    coalesce(ml.provider_id, p.id) as provider_id,
    upper(ml.state) as state,
    'medallion_api'::text as source,
    ml.status,
    ml.license_number,
    ml.expiration_date,
    ml.synced_at as updated_at
  from public.medallion_provider_licenses ml
  left join public.providers p
    on (ml.provider_id is not null and p.id = ml.provider_id)
    or (
      ml.provider_id is null
      and ml.medallion_provider_id is not null
      and p.medallion_provider_id = ml.medallion_provider_id
    )
    or (
      ml.provider_id is null
      and ml.provider_email is not null
      and lower(p.email) = lower(ml.provider_email)
    )
  where coalesce(ml.provider_id, p.id) is not null
    and lower(coalesce(ml.status, 'active')) in ('active', 'verified', 'pending_renewal')
    and (ml.expiration_date is null or ml.expiration_date >= current_date)

  union all

  select
    coalesce(dl.provider_id, p.id) as provider_id,
    upper(dl.state) as state,
    'directshifts_static'::text as source,
    dl.status,
    dl.license_number,
    dl.effective_to as expiration_date,
    dl.updated_at
  from public.directshifts_provider_licenses dl
  left join public.providers p
    on (dl.provider_id is not null and p.id = dl.provider_id)
    or (
      dl.provider_id is null
      and dl.provider_email is not null
      and lower(p.email) = lower(dl.provider_email)
    )
    or (
      dl.provider_id is null
      and dl.provider_email is null
      and dl.provider_name is not null
      and lower(p.name) = lower(dl.provider_name)
    )
  where coalesce(dl.provider_id, p.id) is not null
    and lower(coalesce(dl.status, 'active')) in ('active', 'verified', 'pending_renewal')
    and (dl.effective_from is null or dl.effective_from <= current_date)
    and (dl.effective_to is null or dl.effective_to >= current_date)
),
license_rollup as (
  select
    provider_id,
    state,
    array_agg(distinct source order by source) as license_sources,
    bool_or(source = 'provider_licenses') as has_clinops_license,
    bool_or(source = 'medallion_api') as has_medallion_license,
    bool_or(source = 'directshifts_static') as has_directshifts_license,
    max(updated_at) as license_updated_at
  from license_candidates
  group by provider_id, state
),
latest_metabase_active as (
  select distinct on (provider_id, state)
    provider_id,
    state,
    is_active,
    source,
    synced_at,
    report_date
  from public.provider_state_active
  where source = 'metabase_pcp_state_coverage'
  order by provider_id, state, synced_at desc
)
select
  lr.provider_id,
  p.name as provider_name,
  p.email as provider_email,
  p.profession,
  p.active as provider_active,
  lr.state,
  lr.license_sources,
  lr.has_clinops_license,
  lr.has_medallion_license,
  lr.has_directshifts_license,
  ma.is_active as metabase_active,
  ma.synced_at as metabase_synced_at,
  ma.report_date as metabase_report_date,
  lr.license_updated_at,
  greatest(lr.license_updated_at, ma.synced_at) as updated_at,
  (
    p.active = true
    and coalesce(ma.is_active, true) = true
  ) as allocation_eligible,
  case
    when p.active is distinct from true then 'provider_inactive'
    when ma.is_active = false then 'metabase_inactive_state'
    else 'eligible'
  end as eligibility_status
from license_rollup lr
join public.providers p on p.id = lr.provider_id
left join latest_metabase_active ma
  on ma.provider_id = lr.provider_id
 and ma.state = lr.state;

create view public.v_provider_state_allocation_sources as
select
  count(*)::integer as provider_state_rows,
  count(*) filter (where allocation_eligible)::integer as allocation_eligible_rows,
  count(distinct provider_id)::integer as providers_with_any_license_source,
  count(distinct provider_id) filter (where allocation_eligible)::integer as allocation_eligible_providers,
  count(*) filter (where has_clinops_license)::integer as clinops_license_rows,
  count(*) filter (where has_medallion_license)::integer as medallion_license_rows,
  count(*) filter (where has_directshifts_license)::integer as directshifts_license_rows,
  count(*) filter (where metabase_active = true)::integer as metabase_active_rows,
  count(*) filter (where metabase_active = false)::integer as metabase_inactive_rows,
  max(updated_at) as updated_at
from public.v_provider_state_eligibility;

alter table public.medallion_provider_licenses enable row level security;
alter table public.directshifts_provider_licenses enable row level security;
alter table public.metabase_pcp_state_coverage enable row level security;
alter table public.provider_state_active enable row level security;
alter table if exists public.sync_runs enable row level security;

drop policy if exists "medallion_provider_licenses ui read" on public.medallion_provider_licenses;
create policy "medallion_provider_licenses ui read" on public.medallion_provider_licenses
  for select to anon, authenticated using (true);

drop policy if exists "directshifts_provider_licenses ui read" on public.directshifts_provider_licenses;
create policy "directshifts_provider_licenses ui read" on public.directshifts_provider_licenses
  for select to anon, authenticated using (true);

drop policy if exists "directshifts_provider_licenses ui write" on public.directshifts_provider_licenses;
create policy "directshifts_provider_licenses ui write" on public.directshifts_provider_licenses
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "metabase_pcp_state_coverage ui read" on public.metabase_pcp_state_coverage;
create policy "metabase_pcp_state_coverage ui read" on public.metabase_pcp_state_coverage
  for select to anon, authenticated using (true);

drop policy if exists "provider_state_active ui read" on public.provider_state_active;
create policy "provider_state_active ui read" on public.provider_state_active
  for select to anon, authenticated using (true);

drop policy if exists "sync_runs ui read" on public.sync_runs;
create policy "sync_runs ui read" on public.sync_runs
  for select to anon, authenticated using (true);
