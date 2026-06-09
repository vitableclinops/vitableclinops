-- Store provider-state utilization exports used by monthly scheduling decisions.
-- Rows are monthly aggregates by provider, state, role, and appointment type.

create table if not exists public.provider_state_utilization (
  id                       uuid primary key default gen_random_uuid(),
  month_date               date not null,
  provider_id              uuid references public.providers(id) on delete set null,
  provider_name            text not null,
  covered_appointment_type text not null default 'unknown',
  provider_role_category   text not null default 'unknown',
  state                    text not null check (state ~ '^[A-Z]{2}$'),
  available_count          integer not null default 0 check (available_count >= 0),
  booked_count             integer not null default 0 check (booked_count >= 0),
  booking_rate_pct         numeric(8,4) not null default 0 check (booking_rate_pct >= 0),
  imported_at              timestamptz not null default now(),
  source                   text not null default 'metabase_sync',
  synced_at                timestamptz,
  raw_payload              jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);

create unique index if not exists provider_state_utilization_provider_month_state_type_idx
  on public.provider_state_utilization (
    provider_name,
    month_date,
    state,
    covered_appointment_type,
    provider_role_category
  );

create index if not exists provider_state_utilization_provider_id_month_idx
  on public.provider_state_utilization (provider_id, month_date desc);

create index if not exists provider_state_utilization_provider_name_month_idx
  on public.provider_state_utilization (provider_name, month_date desc);

create index if not exists provider_state_utilization_state_month_idx
  on public.provider_state_utilization (state, month_date desc);

alter table public.provider_state_utilization enable row level security;

drop policy if exists "provider_state_utilization ui read" on public.provider_state_utilization;
create policy "provider_state_utilization ui read" on public.provider_state_utilization
  for select to anon, authenticated using (true);
