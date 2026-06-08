-- Durable Scheduling Workbench recalculation history.
--
-- Each evaluator run gets one row per target month, plus provider-level
-- change rows for only the providers whose decision/allocation changed.

create extension if not exists pgcrypto;

create table if not exists public.scheduling_recalculation_runs (
  id                              uuid primary key default gen_random_uuid(),
  decision_run_id                 uuid not null,
  target_month                    date not null,
  trigger_source                  text not null default 'evaluate-schedule-submissions',
  groups_count                    integer not null default 0,
  changed_provider_count          integer not null default 0,
  decision_accepted_delta_hours   numeric(8,2) not null default 0,
  decision_declined_delta_hours   numeric(8,2) not null default 0,
  publishable_delta_hours         numeric(8,2) not null default 0,
  cut_delta_hours                 numeric(8,2) not null default 0,
  result_summary                  jsonb not null default '{}'::jsonb,
  created_at                      timestamptz not null default now(),
  unique (decision_run_id, target_month)
);

create table if not exists public.scheduling_recalculation_changes (
  id                              uuid primary key default gen_random_uuid(),
  run_id                          uuid not null references public.scheduling_recalculation_runs(id) on delete cascade,
  decision_run_id                 uuid not null,
  target_month                    date not null,
  provider_id                     uuid,
  provider_name                   text not null,
  before_status                   text,
  after_status                    text,
  decision_accepted_before        numeric(8,2) not null default 0,
  decision_accepted_after         numeric(8,2) not null default 0,
  decision_accepted_delta         numeric(8,2) not null default 0,
  decision_declined_before        numeric(8,2) not null default 0,
  decision_declined_after         numeric(8,2) not null default 0,
  decision_declined_delta         numeric(8,2) not null default 0,
  publishable_hours_before        numeric(8,2) not null default 0,
  publishable_hours_after         numeric(8,2) not null default 0,
  publishable_hours_delta         numeric(8,2) not null default 0,
  cut_hours_before                numeric(8,2) not null default 0,
  cut_hours_after                 numeric(8,2) not null default 0,
  cut_hours_delta                 numeric(8,2) not null default 0,
  publishable_shifts_before       integer not null default 0,
  publishable_shifts_after        integer not null default 0,
  cut_shifts_before               integer not null default 0,
  cut_shifts_after                integer not null default 0,
  before_allocations              jsonb not null default '[]'::jsonb,
  after_allocations               jsonb not null default '[]'::jsonb,
  reason                          text,
  created_at                      timestamptz not null default now()
);

create index if not exists scheduling_recalculation_runs_month_idx
  on public.scheduling_recalculation_runs (target_month, created_at desc);

create index if not exists scheduling_recalculation_changes_run_idx
  on public.scheduling_recalculation_changes (run_id, provider_name);

create index if not exists scheduling_recalculation_changes_month_idx
  on public.scheduling_recalculation_changes (target_month, created_at desc);

alter table public.scheduling_recalculation_runs enable row level security;
alter table public.scheduling_recalculation_changes enable row level security;

drop policy if exists "scheduling_recalculation_runs ui read" on public.scheduling_recalculation_runs;
create policy "scheduling_recalculation_runs ui read" on public.scheduling_recalculation_runs
  for select to anon, authenticated using (true);

drop policy if exists "scheduling_recalculation_changes ui read" on public.scheduling_recalculation_changes;
create policy "scheduling_recalculation_changes ui read" on public.scheduling_recalculation_changes
  for select to anon, authenticated using (true);
