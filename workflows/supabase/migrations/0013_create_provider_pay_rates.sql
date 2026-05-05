-- Provider pay rates. Time-bounded — a provider can have multiple historical
-- rows; effective_to=null means currently effective.
-- Used for cost-per-visit projections in the monthly forecast skill.

create table if not exists public.provider_pay_rates (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         uuid not null references public.providers(id) on delete cascade,
  hourly_rate         numeric(7,2) not null check (hourly_rate >= 0),
  role                text,
  effective_from      date not null,
  effective_to        date check (effective_to is null or effective_to > effective_from),
  source              text not null default 'metabase',
  created_at          timestamptz not null default now()
);

-- Only one currently-effective rate per (provider, role)
create unique index if not exists provider_pay_rates_active_unique
  on public.provider_pay_rates (provider_id, coalesce(role, ''))
  where effective_to is null;

create index if not exists provider_pay_rates_provider_idx
  on public.provider_pay_rates (provider_id, effective_from desc);
