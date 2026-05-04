-- Q7 — calculated daily. For each (date, state):
--   gap = scheduled_capacity - projected_demand
-- Negative gap = shortage, positive = surplus.

create table if not exists public.coverage_gaps_daily (
  date                  date not null,
  state                 text not null,
  scheduled_capacity    integer not null check (scheduled_capacity >= 0),
  projected_demand      integer not null check (projected_demand >= 0),
  gap                   integer not null,
  status                text not null
    check (status in ('shortage','balanced','surplus')),
  computed_at           timestamptz not null default now(),
  primary key (date, state)
);

create index if not exists coverage_gaps_status_idx
  on public.coverage_gaps_daily (status, date desc);
create index if not exists coverage_gaps_state_date_idx
  on public.coverage_gaps_daily (state, date desc);
