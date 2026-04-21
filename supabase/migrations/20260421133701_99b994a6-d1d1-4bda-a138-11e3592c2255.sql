
create table if not exists public.provider_utilization_daily (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  util_date date not null,
  booked_timeslots integer,
  total_timeslots integer,
  utilization_pct numeric(6,2),
  imported_at timestamptz not null default now(),
  source text default 'metabase_sync',
  synced_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_name, util_date)
);

create index if not exists provider_utilization_daily_date_idx on public.provider_utilization_daily(util_date);
create index if not exists provider_utilization_daily_name_idx on public.provider_utilization_daily(provider_name);

alter table public.provider_utilization_daily enable row level security;

create policy "Admins read provider_utilization_daily"
  on public.provider_utilization_daily for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'pod_lead'));

create policy "Admins manage provider_utilization_daily"
  on public.provider_utilization_daily for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create trigger update_provider_utilization_daily_updated_at
  before update on public.provider_utilization_daily
  for each row execute function public.update_updated_at_column();
