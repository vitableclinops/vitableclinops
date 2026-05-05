-- Derived monthly from demand_forecast. One row per (state, month).
-- Used by the daily SLA bucketing job and by Lovable dashboards.
--
-- daily_target_slots follows the canonical formula:
--   max(5, monthly_visits_target / 20 * 1.5)

create table if not exists public.state_demand_targets (
  state                       text not null,
  month                       date not null,
  monthly_visits_target       integer not null check (monthly_visits_target >= 0),
  daily_target_slots          integer not null check (daily_target_slots >= 5),
  monthly_hours_target        numeric(8,2) not null check (monthly_hours_target >= 0),
  growth_multiplier           numeric(4,3) not null default 1.000
    check (growth_multiplier >= 0.5 and growth_multiplier <= 3.0),
  forecast_run_id             uuid,
  computed_at                 timestamptz not null default now(),
  primary key (state, month)
);

create index if not exists state_demand_targets_month_idx
  on public.state_demand_targets (month desc);
