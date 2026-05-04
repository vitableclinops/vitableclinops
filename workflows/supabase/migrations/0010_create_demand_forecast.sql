-- Per-(date, state) projected visit volume, produced by the demand-forecast
-- skill. forecast_run_id ties together all rows from one forecast run, so we
-- can keep history and compare baseline vs. adjusted vs. prior cycle.

create table if not exists public.demand_forecast (
  date                date not null,
  state               text not null,
  projected_visits    numeric(8,2) not null check (projected_visits >= 0),
  forecast_run_id     uuid not null,
  is_baseline         boolean not null default false,
  computed_at         timestamptz not null default now(),
  primary key (date, state, forecast_run_id)
);

create index if not exists demand_forecast_state_date_idx
  on public.demand_forecast (state, date);
create index if not exists demand_forecast_run_idx
  on public.demand_forecast (forecast_run_id);
create index if not exists demand_forecast_recent_idx
  on public.demand_forecast (date desc) where is_baseline = false;
