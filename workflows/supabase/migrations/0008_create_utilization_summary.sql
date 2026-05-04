-- Rolling utilization summary per provider.
-- week_max_pct  = max daily utilization over the last 7 days
-- month_avg_pct = average daily utilization over the last 30 days
--
-- Refreshed nightly by sync_provider_utilization. Daily snapshots stay in
-- provider_utilization_daily; this table is the read surface for the daily
-- report and recommendation engine, since per-provider per-day is too noisy
-- (providers don't all work every day).

create table if not exists public.utilization_summary (
  provider_id       uuid primary key references public.providers(id) on delete cascade,
  week_max_pct      numeric(5,2) check (week_max_pct >= 0 and week_max_pct <= 200),
  month_avg_pct     numeric(5,2) check (month_avg_pct >= 0 and month_avg_pct <= 200),
  data_source       text not null default 'daily'
    check (data_source in ('daily','five_week_avg','mixed')),
  computed_at       timestamptz not null default now()
);
