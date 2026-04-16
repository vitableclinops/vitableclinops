-- ─────────────────────────────────────────────────────────────────────────────
-- Tables for 4 new Metabase reports pulled daily by GitHub Actions
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Network-wide average SLA attainment (one row per day)
create table if not exists public.sla_attainment_aggregate (
  id           uuid primary key default gen_random_uuid(),
  report_date  date not null,
  avg_sla_pct  numeric(6,2) not null,
  imported_at  timestamptz not null default now(),
  unique (report_date)
);

alter table public.sla_attainment_aggregate enable row level security;

create policy "Authenticated users can read sla_attainment_aggregate"
  on public.sla_attainment_aggregate for select
  to authenticated using (true);

create policy "Service role can write sla_attainment_aggregate"
  on public.sla_attainment_aggregate for all
  to service_role using (true) with check (true);

-- 2. Telemedicine availability per state per day
create table if not exists public.telemedicine_availability (
  id                  uuid primary key default gen_random_uuid(),
  state_abbreviation  text not null,
  report_date         date not null,
  availability_pct    numeric(6,2),
  available_count     integer,
  imported_at         timestamptz not null default now(),
  unique (state_abbreviation, report_date)
);

alter table public.telemedicine_availability enable row level security;

create policy "Authenticated users can read telemedicine_availability"
  on public.telemedicine_availability for select
  to authenticated using (true);

create policy "Service role can write telemedicine_availability"
  on public.telemedicine_availability for all
  to service_role using (true) with check (true);

-- 3. PCP state coverage (latest snapshot per state per day)
create table if not exists public.pcp_state_coverage (
  id                  uuid primary key default gen_random_uuid(),
  state_abbreviation  text not null,
  report_date         date not null,
  pcp_count           integer,
  coverage_pct        numeric(6,2),
  imported_at         timestamptz not null default now(),
  unique (state_abbreviation, report_date)
);

alter table public.pcp_state_coverage enable row level security;

create policy "Authenticated users can read pcp_state_coverage"
  on public.pcp_state_coverage for select
  to authenticated using (true);

create policy "Service role can write pcp_state_coverage"
  on public.pcp_state_coverage for all
  to service_role using (true) with check (true);

-- 4. Provider appointment counts per day
create table if not exists public.provider_appointment_count (
  id                  uuid primary key default gen_random_uuid(),
  provider_name_raw   text not null,
  report_date         date not null,
  appointment_count   integer not null default 0,
  imported_at         timestamptz not null default now(),
  unique (provider_name_raw, report_date)
);

alter table public.provider_appointment_count enable row level security;

create policy "Authenticated users can read provider_appointment_count"
  on public.provider_appointment_count for select
  to authenticated using (true);

create policy "Service role can write provider_appointment_count"
  on public.provider_appointment_count for all
  to service_role using (true) with check (true);
