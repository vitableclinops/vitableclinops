-- Same-day / next-day coverage routing engine persistence.
--
-- Backs the `compute-daily-coverage-routing` edge function and the refreshed
-- `send-ops-dashboard-slack` digest. The daily routing path is intentionally
-- separate from the legacy `state_leftover_slots` forecast path, which stays
-- available for dashboard/legacy context but is NOT used for routed
-- same-day / next-day decisions.
--
-- Unit of account is HOURS of provider availability throughout. Confirmed
-- coverage (matched + scheduled + active license/scope + active/EHR-live) is
-- stored separately from tentative licensed-only upside so status can be
-- driven by confirmed coverage alone.

create extension if not exists pgcrypto;

-- ── Metabase ingestion: daily state demand (card 3478 + fallbacks) ──────────
create table if not exists public.daily_state_demand (
  id             uuid primary key default gen_random_uuid(),
  coverage_date  date not null,
  state          text not null check (state ~ '^[A-Z]{2}$'),
  demand_hours   numeric(10,2) not null default 0,
  source         text not null default 'daily_card',
  source_card_id integer,
  raw_payload    jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now(),
  unique (coverage_date, state, source)
);

create index if not exists daily_state_demand_date_idx
  on public.daily_state_demand (coverage_date, state);

-- ── Metabase ingestion: daily provider booked appointments (card 3479) ──────
create table if not exists public.daily_provider_booked_appointments (
  id                uuid primary key default gen_random_uuid(),
  coverage_date     date not null,
  provider_name_raw text not null,
  profile_id        uuid references public.profiles(id) on delete set null,
  state             text not null check (state ~ '^[A-Z]{2}$'),
  appointment_count integer not null default 0,
  booked_hours      numeric(10,2),
  matched           boolean not null default false,
  source_card_id    integer,
  raw_payload       jsonb not null default '{}'::jsonb,
  synced_at         timestamptz not null default now(),
  unique (coverage_date, provider_name_raw, state)
);

create index if not exists daily_provider_booked_appointments_date_idx
  on public.daily_provider_booked_appointments (coverage_date, state);
create index if not exists daily_provider_booked_appointments_profile_idx
  on public.daily_provider_booked_appointments (profile_id, coverage_date);

-- ── Routing run metadata ────────────────────────────────────────────────────
create table if not exists public.daily_coverage_routing_runs (
  id              uuid primary key default gen_random_uuid(),
  generated_at    timestamptz not null default now(),
  run_label       text not null default 'manual',
  timezone        text not null default 'America/Chicago',
  coverage_dates  date[] not null default '{}',
  demand_source   text,
  booked_source   text,
  dry_run         boolean not null default false,
  status          text not null default 'success',
  totals          jsonb not null default '{}'::jsonb,
  params          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists daily_coverage_routing_runs_generated_idx
  on public.daily_coverage_routing_runs (generated_at desc);
create index if not exists daily_coverage_routing_runs_fresh_idx
  on public.daily_coverage_routing_runs (dry_run, generated_at desc);

-- ── Per-state coverage rows ─────────────────────────────────────────────────
create table if not exists public.daily_coverage_state_rows (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   uuid not null references public.daily_coverage_routing_runs(id) on delete cascade,
  coverage_date            date not null,
  state                    text not null check (state ~ '^[A-Z]{2}$'),
  demand_hours             numeric(10,2),
  demand_source            text,
  booked_locked_hours      numeric(10,2) not null default 0,
  confirmed_assigned_hours numeric(10,2) not null default 0,
  confirmed_coverage_hours numeric(10,2) not null default 0,
  tentative_upside_hours   numeric(10,2) not null default 0,
  coverage_ratio           numeric(10,4),
  gap_hours                numeric(10,2) not null default 0,
  status                   text not null check (status in ('ok', 'low', 'critical', 'zero', 'no_data')),
  created_at               timestamptz not null default now()
);

create index if not exists daily_coverage_state_rows_run_idx
  on public.daily_coverage_state_rows (run_id, coverage_date, state);
create index if not exists daily_coverage_state_rows_status_idx
  on public.daily_coverage_state_rows (coverage_date, status);

-- ── Per-provider shift assignments ──────────────────────────────────────────
create table if not exists public.daily_coverage_provider_assignments (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.daily_coverage_routing_runs(id) on delete cascade,
  coverage_date         date not null,
  profile_id            uuid references public.profiles(id) on delete set null,
  provider_name         text not null,
  profession            text,
  scheduled_hours       numeric(10,2) not null default 0,
  booked_locked_hours   numeric(10,2) not null default 0,
  assignments           jsonb not null default '[]'::jsonb,
  unassigned_free_hours numeric(10,2) not null default 0,
  created_at            timestamptz not null default now()
);

create index if not exists daily_coverage_provider_assignments_run_idx
  on public.daily_coverage_provider_assignments (run_id, coverage_date);

-- ── Booked appointment locks ────────────────────────────────────────────────
create table if not exists public.daily_coverage_booked_locks (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.daily_coverage_routing_runs(id) on delete cascade,
  coverage_date date not null,
  profile_id    uuid references public.profiles(id) on delete set null,
  provider_name text not null,
  state         text not null,
  hours         numeric(10,2) not null default 0,
  source        text not null,
  matched       boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists daily_coverage_booked_locks_run_idx
  on public.daily_coverage_booked_locks (run_id, coverage_date);

-- ── Recommendations (moves + adds) ──────────────────────────────────────────
create table if not exists public.daily_coverage_recommendations (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.daily_coverage_routing_runs(id) on delete cascade,
  coverage_date   date not null,
  kind            text not null check (kind in ('move', 'add')),
  state           text not null,
  profile_id      uuid references public.profiles(id) on delete set null,
  provider_name   text not null,
  hours           numeric(10,2),
  gap_hours       numeric(10,2),
  source          text,
  tentative       boolean not null default false,
  utilization_pct numeric(6,2),
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists daily_coverage_recommendations_run_idx
  on public.daily_coverage_recommendations (run_id, coverage_date, kind);

-- ── Data-quality warnings ───────────────────────────────────────────────────
create table if not exists public.daily_coverage_data_quality (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.daily_coverage_routing_runs(id) on delete cascade,
  coverage_date date not null,
  warning_type  text not null,
  state         text,
  detail        text not null,
  hours         numeric(10,2),
  created_at    timestamptz not null default now()
);

create index if not exists daily_coverage_data_quality_run_idx
  on public.daily_coverage_data_quality (run_id, coverage_date);

-- ── Convenience view: latest non-dry-run state coverage ─────────────────────
drop view if exists public.v_daily_coverage_latest_state;
create view public.v_daily_coverage_latest_state as
with latest as (
  select id, generated_at, coverage_dates
  from public.daily_coverage_routing_runs
  where dry_run = false
  order by generated_at desc
  limit 1
)
select
  l.generated_at,
  r.run_id,
  r.coverage_date,
  r.state,
  r.demand_hours,
  r.demand_source,
  r.booked_locked_hours,
  r.confirmed_assigned_hours,
  r.confirmed_coverage_hours,
  r.tentative_upside_hours,
  r.coverage_ratio,
  r.gap_hours,
  r.status
from latest l
join public.daily_coverage_state_rows r on r.run_id = l.id;

-- ── RLS: UI read-only; service-role edge functions bypass RLS for writes ────
alter table public.daily_state_demand enable row level security;
alter table public.daily_provider_booked_appointments enable row level security;
alter table public.daily_coverage_routing_runs enable row level security;
alter table public.daily_coverage_state_rows enable row level security;
alter table public.daily_coverage_provider_assignments enable row level security;
alter table public.daily_coverage_booked_locks enable row level security;
alter table public.daily_coverage_recommendations enable row level security;
alter table public.daily_coverage_data_quality enable row level security;

drop policy if exists "daily_state_demand ui read" on public.daily_state_demand;
create policy "daily_state_demand ui read" on public.daily_state_demand
  for select to anon, authenticated using (true);

drop policy if exists "daily_provider_booked_appointments ui read" on public.daily_provider_booked_appointments;
create policy "daily_provider_booked_appointments ui read" on public.daily_provider_booked_appointments
  for select to anon, authenticated using (true);

drop policy if exists "daily_coverage_routing_runs ui read" on public.daily_coverage_routing_runs;
create policy "daily_coverage_routing_runs ui read" on public.daily_coverage_routing_runs
  for select to anon, authenticated using (true);

drop policy if exists "daily_coverage_state_rows ui read" on public.daily_coverage_state_rows;
create policy "daily_coverage_state_rows ui read" on public.daily_coverage_state_rows
  for select to anon, authenticated using (true);

drop policy if exists "daily_coverage_provider_assignments ui read" on public.daily_coverage_provider_assignments;
create policy "daily_coverage_provider_assignments ui read" on public.daily_coverage_provider_assignments
  for select to anon, authenticated using (true);

drop policy if exists "daily_coverage_booked_locks ui read" on public.daily_coverage_booked_locks;
create policy "daily_coverage_booked_locks ui read" on public.daily_coverage_booked_locks
  for select to anon, authenticated using (true);

drop policy if exists "daily_coverage_recommendations ui read" on public.daily_coverage_recommendations;
create policy "daily_coverage_recommendations ui read" on public.daily_coverage_recommendations
  for select to anon, authenticated using (true);

drop policy if exists "daily_coverage_data_quality ui read" on public.daily_coverage_data_quality;
create policy "daily_coverage_data_quality ui read" on public.daily_coverage_data_quality
  for select to anon, authenticated using (true);
