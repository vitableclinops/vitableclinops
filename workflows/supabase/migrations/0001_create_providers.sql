-- Provider master record. One row per active or formerly-active clinician.
-- No PHI: only operational metadata (status, IDs to other systems, shift types).

create extension if not exists "pgcrypto";

create table if not exists public.providers (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  email                    text unique,
  npi                      text unique,
  athena_provider_id       text,
  homebase_employee_id     text,
  ehr_activation_status    text not null default 'inactive'
    check (ehr_activation_status in ('active','inactive','activation_requested','offboarded')),
  readiness_status         text not null default 'training'
    check (readiness_status in ('ready','training','paused')),
  shift_types              text[] not null default '{}',
  is_telemedicine          boolean not null default false,
  is_in_home               boolean not null default false,
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists providers_active_idx
  on public.providers (active) where active = true;
create index if not exists providers_ehr_status_idx
  on public.providers (ehr_activation_status);
create index if not exists providers_shift_types_idx
  on public.providers using gin (shift_types);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists providers_updated_at on public.providers;
create trigger providers_updated_at
  before update on public.providers
  for each row execute function public.set_updated_at();
