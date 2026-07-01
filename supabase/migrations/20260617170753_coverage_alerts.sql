create table if not exists public.coverage_alerts (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  target_today date not null,
  target_tomorrow date not null,
  data_source text check (data_source is null or data_source in ('daily', 'five_week_avg', 'mixed')),
  critical_states jsonb not null default '[]'::jsonb,
  low_states jsonb not null default '[]'::jsonb,
  ok_states jsonb not null default '[]'::jsonb,
  opt_in_providers jsonb not null default '[]'::jsonb,
  outreach_email_subject text,
  outreach_email_body text,
  slack_posted boolean not null default false,
  error text
);

comment on table public.coverage_alerts is
  'Same-day / next-day coverage alert runs written by the same-next-day-coverage-alert edge function.';

create index if not exists coverage_alerts_run_at_desc_idx
  on public.coverage_alerts (run_at desc);

alter table public.coverage_alerts enable row level security;

revoke all on public.coverage_alerts from anon;
grant select on public.coverage_alerts to authenticated;
grant all on public.coverage_alerts to service_role;

drop policy if exists "coverage_alerts authenticated read" on public.coverage_alerts;
create policy "coverage_alerts authenticated read"
  on public.coverage_alerts
  for select
  to authenticated
  using (true);
