create extension if not exists pgcrypto;

create table if not exists public.provider_pay_rates (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid not null references public.providers(id) on delete cascade,
  hourly_rate    numeric(7,2) not null check (hourly_rate >= 0),
  role           text,
  effective_from date not null,
  effective_to   date check (effective_to is null or effective_to > effective_from),
  source         text not null default 'metabase',
  created_at     timestamptz not null default now()
);

create unique index if not exists provider_pay_rates_active_unique
  on public.provider_pay_rates (provider_id, coalesce(role, ''))
  where effective_to is null;

create index if not exists provider_pay_rates_provider_idx
  on public.provider_pay_rates (provider_id, effective_from desc);

create table if not exists public.provider_scheduling_preferences (
  provider_id               uuid primary key references public.providers(id) on delete cascade,
  time_zone                 text not null default 'America/New_York' check (length(trim(time_zone)) > 0),
  late_booking_notice_hours numeric(6,2) not null default 24 check (late_booking_notice_hours >= 0 and late_booking_notice_hours <= 168),
  booking_cutoff_minutes    integer not null default 15 check (booking_cutoff_minutes >= 0 and booking_cutoff_minutes <= 1440),
  notify_late_bookings      boolean not null default true,
  email_late_bookings       boolean not null default true,
  push_late_bookings        boolean not null default false,
  updated_at                timestamptz not null default now(),
  created_at                timestamptz not null default now()
);

create index if not exists provider_scheduling_preferences_time_zone_idx
  on public.provider_scheduling_preferences (time_zone);

create table if not exists public.provider_booking_notifications (
  id                    uuid primary key default gen_random_uuid(),
  appointment_id        text not null,
  provider_id           uuid references public.providers(id) on delete set null,
  provider_email        text,
  provider_name         text,
  appointment_start_at  timestamptz not null,
  booked_at             timestamptz not null,
  minutes_until_start   numeric(8,2) not null,
  booking_cutoff_minutes integer not null,
  late_notice_hours     numeric(6,2) not null,
  notification_status   text not null,
  delivery_channel      text,
  notification_sent_at  timestamptz,
  error                 text,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create unique index if not exists provider_booking_notifications_appointment_idx
  on public.provider_booking_notifications (appointment_id);
create index if not exists provider_booking_notifications_provider_idx
  on public.provider_booking_notifications (provider_id, created_at desc);
create index if not exists provider_booking_notifications_start_idx
  on public.provider_booking_notifications (appointment_start_at);

alter table public.provider_pay_rates enable row level security;
alter table public.provider_scheduling_preferences enable row level security;
alter table public.provider_booking_notifications enable row level security;

drop policy if exists "provider_pay_rates ui read" on public.provider_pay_rates;
create policy "provider_pay_rates ui read" on public.provider_pay_rates
  for select to anon, authenticated using (true);

drop policy if exists "provider_scheduling_preferences ui read" on public.provider_scheduling_preferences;
create policy "provider_scheduling_preferences ui read" on public.provider_scheduling_preferences
  for select to anon, authenticated using (true);

drop policy if exists "provider_scheduling_preferences ui write" on public.provider_scheduling_preferences;
create policy "provider_scheduling_preferences ui write" on public.provider_scheduling_preferences
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "provider_booking_notifications ui read" on public.provider_booking_notifications;
create policy "provider_booking_notifications ui read" on public.provider_booking_notifications
  for select to anon, authenticated using (true);

drop policy if exists "provider_booking_notifications ui write" on public.provider_booking_notifications;
create policy "provider_booking_notifications ui write" on public.provider_booking_notifications
  for all to anon, authenticated using (true) with check (true);
