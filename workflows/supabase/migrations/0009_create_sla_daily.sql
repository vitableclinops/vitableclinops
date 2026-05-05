-- Daily SLA bucketing per state. Matches the formula in
-- workflows/src/prompts/daily_availability_prompt.py:
--
--   daily_demand = monthly_completed_visits / 20
--   daily_target = max(5, daily_demand * 1.5)
--   ratio        = available_slots / daily_target
--
-- Buckets: critical (ratio < 1.0), low (1.0 <= ratio < 2.0), ok (>= 2.0).
-- sla_flagged is independent: true when MTD sla_pct < 85.

create table if not exists public.sla_daily (
  date                date not null,
  state               text not null,
  available_slots     integer not null check (available_slots >= 0),
  monthly_visits      integer check (monthly_visits is null or monthly_visits >= 0),
  daily_target        integer not null check (daily_target >= 5),
  ratio               numeric(6,3) not null,
  sla_pct             numeric(5,2) check (sla_pct is null or (sla_pct >= 0 and sla_pct <= 100)),
  status              text not null
    check (status in ('critical','low','ok','zero','no_data')),
  sla_flagged         boolean not null default false,
  computed_at         timestamptz not null default now(),
  primary key (date, state)
);

create index if not exists sla_daily_status_idx
  on public.sla_daily (status, date desc);
create index if not exists sla_daily_flagged_idx
  on public.sla_daily (date desc) where sla_flagged = true;
create index if not exists sla_daily_state_date_idx
  on public.sla_daily (state, date desc);
