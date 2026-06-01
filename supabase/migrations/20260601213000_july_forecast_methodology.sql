-- July 2026 demand forecast methodology support.
--
-- Adds first-class fields for the simplified Metabase forecast:
-- raw weekly demand, active members, 0.95 seasonal adjustment, exact
-- month-week conversion, and service-line totals for MH coaching / therapy.

alter table if exists public.state_demand_targets
  add column if not exists raw_weekly_hours numeric(8,2),
  add column if not exists adjusted_weekly_hours numeric(8,2),
  add column if not exists daily_target_hours numeric(8,2),
  add column if not exists active_members integer,
  add column if not exists seasonal_multiplier numeric(4,3),
  add column if not exists methodology_version text;

create table if not exists public.service_line_demand_targets (
  service_line            text not null,
  month                   date not null,
  label                   text not null,
  scope                   text not null,
  source_card_id          integer,
  raw_weekly_hours        numeric(8,2) not null default 0 check (raw_weekly_hours >= 0),
  adjusted_weekly_hours   numeric(8,2) not null default 0 check (adjusted_weekly_hours >= 0),
  monthly_hours_target    numeric(8,2) not null default 0 check (monthly_hours_target >= 0),
  daily_target_hours      numeric(8,2) not null default 0 check (daily_target_hours >= 0),
  seasonal_multiplier     numeric(4,3) not null default 1.000,
  methodology_version     text,
  forecast_run_id         uuid,
  computed_at             timestamptz not null default now(),
  primary key (service_line, month)
);

create index if not exists service_line_demand_targets_month_idx
  on public.service_line_demand_targets (month desc);

alter table if exists public.service_line_demand_targets enable row level security;

drop policy if exists "service_line_demand_targets ui read" on public.service_line_demand_targets;
create policy "service_line_demand_targets ui read" on public.service_line_demand_targets
  for select to anon, authenticated using (true);
