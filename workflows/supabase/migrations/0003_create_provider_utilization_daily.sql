-- Daily utilization snapshot per provider. Synced from Metabase
-- (Daily Provider Utilization card; falls back to 5-week rolling avg).

create table if not exists public.provider_utilization_daily (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.providers(id) on delete cascade,
  date              date not null,
  utilization_pct   numeric(5,2) not null check (utilization_pct >= 0 and utilization_pct <= 200),
  data_source       text not null check (data_source in ('daily','five_week_avg')),
  created_at        timestamptz not null default now(),
  unique (provider_id, date)
);

create index if not exists provider_utilization_provider_date_idx
  on public.provider_utilization_daily (provider_id, date desc);
create index if not exists provider_utilization_date_idx
  on public.provider_utilization_daily (date desc);
