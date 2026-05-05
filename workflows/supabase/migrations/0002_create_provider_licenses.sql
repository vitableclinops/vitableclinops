-- One row per (provider, state) license. License changes go here, not on providers.

create table if not exists public.provider_licenses (
  id              uuid primary key default gen_random_uuid(),
  provider_id     uuid not null references public.providers(id) on delete cascade,
  state           char(2) not null,
  license_number  text,
  expiration_date date,
  status          text not null default 'active'
    check (status in ('active','pending','expired','revoked')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (provider_id, state)
);

create index if not exists provider_licenses_state_active_idx
  on public.provider_licenses (state) where status = 'active';
create index if not exists provider_licenses_provider_idx
  on public.provider_licenses (provider_id);

drop trigger if exists provider_licenses_updated_at on public.provider_licenses;
create trigger provider_licenses_updated_at
  before update on public.provider_licenses
  for each row execute function public.set_updated_at();
