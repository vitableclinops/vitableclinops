-- Shifts pulled from Homebase. One row per scheduled shift.
-- Refreshed daily; the natural key is homebase_shift_id so resyncs upsert.

create table if not exists public.shifts (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         uuid references public.providers(id) on delete set null,
  homebase_shift_id   text not null unique,
  date                date not null,
  start_time          timestamptz not null,
  end_time            timestamptz not null,
  hours               numeric(5,2) not null check (hours >= 0 and hours <= 24),
  role                text,
  state               text,
  location_id         text,
  source              text not null default 'homebase',
  synced_at           timestamptz not null default now()
);

create index if not exists shifts_date_idx
  on public.shifts (date desc);
create index if not exists shifts_provider_date_idx
  on public.shifts (provider_id, date desc);
create index if not exists shifts_state_date_idx
  on public.shifts (state, date desc) where state is not null;
