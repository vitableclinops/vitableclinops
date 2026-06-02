-- ClinOps Homebase persistence for same-day / next-day routing.
--
-- Older Homebase tables existed in the primary app schema, but the ClinOps
-- project needs its own copy because Homebase is the same-day schedule source
-- of truth for daily coverage routing.

create extension if not exists pgcrypto;

create table if not exists public.homebase_locations (
  id                 uuid primary key default gen_random_uuid(),
  homebase_uuid      text not null unique,
  name               text,
  address_1          text,
  address_2          text,
  city               text,
  state              text,
  zip                text,
  time_zone          text,
  synced_at          timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.homebase_employees (
  id                     uuid primary key default gen_random_uuid(),
  homebase_id            bigint not null unique,
  location_homebase_uuid text,
  email                  text,
  first_name             text,
  last_name              text,
  normalized_name        text,
  -- Legacy column name retained because existing functions read profile_id.
  -- Values are ClinOps providers.id.
  profile_id             uuid references public.providers(id) on delete set null,
  match_confidence       text,
  synced_at              timestamptz,
  created_at             timestamptz not null default now()
);

create table if not exists public.homebase_shifts (
  id                     uuid primary key default gen_random_uuid(),
  homebase_id            bigint not null unique,
  homebase_user_id       bigint,
  homebase_employee_id   uuid references public.homebase_employees(id) on delete set null,
  location_homebase_uuid text,
  role                   text,
  department             text,
  start_at               timestamptz,
  end_at                 timestamptz,
  scheduled_hours        numeric(8,2),
  published              boolean default false,
  scheduled              boolean default true,
  synced_at              timestamptz,
  created_at             timestamptz not null default now()
);

create table if not exists public.homebase_sync_runs (
  id                   uuid primary key default gen_random_uuid(),
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  status               text not null default 'running',
  locations_synced     integer default 0,
  employees_synced     integer default 0,
  employees_matched    integer default 0,
  employees_unmatched  integer default 0,
  shifts_synced        integer default 0,
  unmatched_sample     jsonb,
  error                text,
  created_at           timestamptz not null default now()
);

create table if not exists public.provider_name_mappings (
  id             uuid primary key default gen_random_uuid(),
  homebase_name  text not null,
  profile_id     uuid not null references public.providers(id) on delete cascade,
  created_at     timestamptz not null default now()
);

alter table if exists public.homebase_employees
  add column if not exists location_homebase_uuid text,
  add column if not exists match_confidence text,
  add column if not exists synced_at timestamptz;

alter table if exists public.homebase_shifts
  add column if not exists homebase_user_id bigint,
  add column if not exists homebase_employee_id uuid references public.homebase_employees(id) on delete set null,
  add column if not exists scheduled_hours numeric(8,2),
  add column if not exists published boolean default false,
  add column if not exists scheduled boolean default true,
  add column if not exists synced_at timestamptz;

create unique index if not exists homebase_locations_homebase_uuid_idx
  on public.homebase_locations (homebase_uuid);
create unique index if not exists homebase_employees_homebase_id_idx
  on public.homebase_employees (homebase_id);
create unique index if not exists homebase_shifts_homebase_id_idx
  on public.homebase_shifts (homebase_id);
create index if not exists homebase_employees_profile_idx
  on public.homebase_employees (profile_id);
create index if not exists homebase_employees_location_idx
  on public.homebase_employees (location_homebase_uuid);
create index if not exists homebase_shifts_employee_idx
  on public.homebase_shifts (homebase_employee_id);
create index if not exists homebase_shifts_start_idx
  on public.homebase_shifts (start_at);
create index if not exists homebase_sync_runs_started_idx
  on public.homebase_sync_runs (started_at desc);
create index if not exists provider_name_mappings_homebase_name_idx
  on public.provider_name_mappings (lower(homebase_name));

alter table public.homebase_locations enable row level security;
alter table public.homebase_employees enable row level security;
alter table public.homebase_shifts enable row level security;
alter table public.homebase_sync_runs enable row level security;
alter table public.provider_name_mappings enable row level security;

drop policy if exists "homebase_locations ui read" on public.homebase_locations;
create policy "homebase_locations ui read" on public.homebase_locations
  for select to anon, authenticated using (true);

drop policy if exists "homebase_employees ui read" on public.homebase_employees;
create policy "homebase_employees ui read" on public.homebase_employees
  for select to anon, authenticated using (true);

drop policy if exists "homebase_shifts ui read" on public.homebase_shifts;
create policy "homebase_shifts ui read" on public.homebase_shifts
  for select to anon, authenticated using (true);

drop policy if exists "homebase_sync_runs ui read" on public.homebase_sync_runs;
create policy "homebase_sync_runs ui read" on public.homebase_sync_runs
  for select to anon, authenticated using (true);

drop policy if exists "provider_name_mappings ui read" on public.provider_name_mappings;
create policy "provider_name_mappings ui read" on public.provider_name_mappings
  for select to anon, authenticated using (true);

drop policy if exists "provider_name_mappings ui write" on public.provider_name_mappings;
create policy "provider_name_mappings ui write" on public.provider_name_mappings
  for all to anon, authenticated using (true) with check (true);
