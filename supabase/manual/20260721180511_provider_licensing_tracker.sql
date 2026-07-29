-- Provider licensing tracker for project wzwdcqozkmlaicjiompe.
-- Intended for manual execution in the Supabase SQL editor.
--
-- Compact sources checked on 2026-07-21:
-- NLC implementation map: https://www.nursecompact.com/files/NLC_Map.pdf
-- APRN Compact status: https://www.ncsbn.org/news/south-dakota-enacts-aprn-compact

create extension if not exists pgcrypto;

drop view if exists public.provider_effective_licenses;

create table if not exists public.states (
  code             text primary key check (code ~ '^[A-Z]{2}$'),
  name             text not null,
  is_nurse_compact boolean not null default false,
  is_aprn_compact  boolean not null default false
);

create table if not exists public.providers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  home_state            text references public.states(code) on update cascade,
  medallion_provider_id text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint providers_home_state_code_check
    check (home_state is null or home_state ~ '^[A-Z]{2}$')
);

create table if not exists public.provider_licenses (
  id                    uuid primary key default gen_random_uuid(),
  provider_id           uuid not null references public.providers(id) on delete cascade,
  state_code            text not null references public.states(code) on update cascade,
  license_type          text not null check (license_type in ('RN', 'NP')),
  status                text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'submitted', 'active', 'expired')),
  license_number        text,
  expiration_date       date,
  source                text not null default 'independent'
    check (source in ('medallion', 'independent', 'legitscript', 'multistate_compact')),
  medallion_license_id  text,
  last_synced_at        timestamptz,
  notes                 text,
  unique (provider_id, state_code, license_type)
);

create table if not exists public.license_tasks (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid not null references public.providers(id) on delete cascade,
  state_code     text not null references public.states(code) on update cascade,
  license_type   text not null check (license_type in ('RN', 'NP')),
  step_name      text not null,
  step_order     integer not null default 0,
  status         text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete', 'blocked')),
  owner          text,
  due_date       date,
  completed_at   timestamptz,
  notes          text
);

create index if not exists providers_home_state_idx
  on public.providers (home_state);
create index if not exists providers_medallion_provider_id_idx
  on public.providers (medallion_provider_id)
  where medallion_provider_id is not null;

create index if not exists provider_licenses_provider_idx
  on public.provider_licenses (provider_id);
create index if not exists provider_licenses_state_type_status_idx
  on public.provider_licenses (state_code, license_type, status);
create index if not exists provider_licenses_medallion_license_id_idx
  on public.provider_licenses (medallion_license_id)
  where medallion_license_id is not null;

create index if not exists license_tasks_provider_state_type_idx
  on public.license_tasks (provider_id, state_code, license_type);
create index if not exists license_tasks_status_due_date_idx
  on public.license_tasks (status, due_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists providers_updated_at on public.providers;
create trigger providers_updated_at
  before update on public.providers
  for each row execute function public.set_updated_at();

-- is_nurse_compact marks fully implemented NLC states where an active compact
-- RN license currently grants a practice privilege. Massachusetts is enacted
-- but awaiting implementation per the NCSBN map, so it is false here.
insert into public.states (code, name, is_nurse_compact, is_aprn_compact)
values
  ('AL', 'Alabama', true, false),
  ('AK', 'Alaska', false, false),
  ('AZ', 'Arizona', true, false),
  ('AR', 'Arkansas', true, false),
  ('CA', 'California', false, false),
  ('CO', 'Colorado', true, false),
  ('CT', 'Connecticut', true, false),
  ('DE', 'Delaware', true, true),
  ('DC', 'District of Columbia', false, false),
  ('FL', 'Florida', true, false),
  ('GA', 'Georgia', true, false),
  ('HI', 'Hawaii', false, false),
  ('ID', 'Idaho', true, false),
  ('IL', 'Illinois', false, false),
  ('IN', 'Indiana', true, false),
  ('IA', 'Iowa', true, false),
  ('KS', 'Kansas', true, false),
  ('KY', 'Kentucky', true, false),
  ('LA', 'Louisiana', true, false),
  ('ME', 'Maine', true, false),
  ('MD', 'Maryland', true, false),
  ('MA', 'Massachusetts', false, false),
  ('MI', 'Michigan', false, false),
  ('MN', 'Minnesota', false, false),
  ('MS', 'Mississippi', true, false),
  ('MO', 'Missouri', true, false),
  ('MT', 'Montana', true, false),
  ('NE', 'Nebraska', true, false),
  ('NV', 'Nevada', false, false),
  ('NH', 'New Hampshire', true, false),
  ('NJ', 'New Jersey', true, false),
  ('NM', 'New Mexico', true, false),
  ('NY', 'New York', false, false),
  ('NC', 'North Carolina', true, false),
  ('ND', 'North Dakota', true, true),
  ('OH', 'Ohio', true, false),
  ('OK', 'Oklahoma', true, false),
  ('OR', 'Oregon', false, false),
  ('PA', 'Pennsylvania', true, false),
  ('RI', 'Rhode Island', true, false),
  ('SC', 'South Carolina', true, false),
  ('SD', 'South Dakota', true, true),
  ('TN', 'Tennessee', true, false),
  ('TX', 'Texas', true, false),
  ('UT', 'Utah', true, true),
  ('VT', 'Vermont', true, false),
  ('VA', 'Virginia', true, false),
  ('WA', 'Washington', true, false),
  ('WV', 'West Virginia', true, false),
  ('WI', 'Wisconsin', true, false),
  ('WY', 'Wyoming', true, false)
on conflict (code) do update
set name = excluded.name,
    is_nurse_compact = excluded.is_nurse_compact,
    is_aprn_compact = excluded.is_aprn_compact;

insert into public.providers (name, home_state)
select 'Genevieve Teetie', 'PA'
where not exists (
  select 1 from public.providers where lower(name) = lower('Genevieve Teetie')
);

update public.providers
set home_state = 'PA'
where lower(name) = lower('Genevieve Teetie')
  and home_state is distinct from 'PA';

insert into public.providers (name, home_state)
select 'Rebecca Keuch', 'PA'
where not exists (
  select 1 from public.providers where lower(name) = lower('Rebecca Keuch')
);

update public.providers
set home_state = 'PA'
where lower(name) = lower('Rebecca Keuch')
  and home_state is distinct from 'PA';

create or replace view public.provider_effective_licenses
with (security_invoker = true)
as
with license_types as (
  select unnest(array['RN'::text, 'NP'::text]) as license_type
),
aprn_compact_runtime as (
  select count(*) >= 7 as is_operational
  from public.states
  where is_aprn_compact = true
),
license_grid as (
  select
    p.id as provider_id,
    p.name as provider_name,
    p.home_state,
    s.code as state_code,
    s.name as state_name,
    s.is_nurse_compact as target_is_nurse_compact,
    s.is_aprn_compact as target_is_aprn_compact,
    lt.license_type
  from public.providers p
  cross join public.states s
  cross join license_types lt
)
select
  grid.provider_id,
  grid.provider_name,
  grid.home_state,
  home.name as home_state_name,
  grid.state_code,
  grid.state_name,
  grid.license_type,
  case
    when pl.status = 'active' then 'active_direct'
    when (
      grid.license_type = 'RN'
      and coalesce(home.is_nurse_compact, false)
      and grid.target_is_nurse_compact
    ) or (
      grid.license_type = 'NP'
      and aprn.is_operational
      and coalesce(home.is_aprn_compact, false)
      and grid.target_is_aprn_compact
    ) then 'active_via_compact'
    when pl.status in ('in_progress', 'submitted') then 'in_progress'
    else 'needed'
  end as effective_status,
  (
    grid.license_type = 'RN'
    and coalesce(home.is_nurse_compact, false)
    and grid.target_is_nurse_compact
  ) or (
    grid.license_type = 'NP'
    and aprn.is_operational
    and coalesce(home.is_aprn_compact, false)
    and grid.target_is_aprn_compact
  ) as compact_coverage_available,
  case
    when grid.license_type = 'RN'
      and coalesce(home.is_nurse_compact, false)
      and grid.target_is_nurse_compact
      then 'nurse_licensure_compact'
    when grid.license_type = 'NP'
      and aprn.is_operational
      and coalesce(home.is_aprn_compact, false)
      and grid.target_is_aprn_compact
      then 'aprn_compact'
    else null
  end as compact_basis,
  grid.target_is_nurse_compact,
  grid.target_is_aprn_compact,
  coalesce(home.is_nurse_compact, false) as home_is_nurse_compact,
  coalesce(home.is_aprn_compact, false) as home_is_aprn_compact,
  aprn.is_operational as aprn_compact_operational,
  pl.id as license_id,
  pl.status as direct_status,
  pl.source,
  pl.license_number,
  pl.expiration_date,
  pl.medallion_license_id,
  pl.last_synced_at,
  pl.notes
from license_grid grid
left join public.states home
  on home.code = grid.home_state
cross join aprn_compact_runtime aprn
left join public.provider_licenses pl
  on pl.provider_id = grid.provider_id
 and pl.state_code = grid.state_code
 and pl.license_type = grid.license_type;

alter table public.states enable row level security;
alter table public.providers enable row level security;
alter table public.provider_licenses enable row level security;
alter table public.license_tasks enable row level security;

drop policy if exists "service_role read/write" on public.states;
create policy "service_role read/write" on public.states
  for all to service_role using (true) with check (true);

drop policy if exists "service_role read/write" on public.providers;
create policy "service_role read/write" on public.providers
  for all to service_role using (true) with check (true);

drop policy if exists "service_role read/write" on public.provider_licenses;
create policy "service_role read/write" on public.provider_licenses
  for all to service_role using (true) with check (true);

drop policy if exists "service_role read/write" on public.license_tasks;
create policy "service_role read/write" on public.license_tasks
  for all to service_role using (true) with check (true);

revoke all on table public.states from anon, authenticated;
revoke all on table public.providers from anon, authenticated;
revoke all on table public.provider_licenses from anon, authenticated;
revoke all on table public.license_tasks from anon, authenticated;
revoke all on table public.provider_effective_licenses from anon, authenticated;

grant select, insert, update, delete on table public.states to service_role;
grant select, insert, update, delete on table public.providers to service_role;
grant select, insert, update, delete on table public.provider_licenses to service_role;
grant select, insert, update, delete on table public.license_tasks to service_role;
grant select on table public.provider_effective_licenses to service_role;

comment on table public.providers is 'Provider master records for the licensing tracker.';
comment on table public.states is 'US states plus DC, with NLC and APRN Compact flags used by the effective license view.';
comment on table public.provider_licenses is 'Direct RN and NP license records by provider and jurisdiction.';
comment on table public.license_tasks is 'Operational task checklist rows for license acquisition or maintenance.';
comment on view public.provider_effective_licenses is 'Provider-state-license grid with direct and compact-derived effective licensing status.';
