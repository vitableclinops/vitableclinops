create extension if not exists pgcrypto;

create table if not exists public.scheduling_exceptions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  exception_type text,
  rule text not null,
  scheduling_action text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduling_exceptions_active_name_idx
  on public.scheduling_exceptions (active, name);

insert into public.scheduling_exceptions (
  slug,
  name,
  exception_type,
  rule,
  scheduling_action
)
values
  (
    'richard-rash',
    'Richard Rash',
    'Therapy / LPC',
    'Route through the mental health therapy service-line forecast, not the telehealth state allocator.',
    'Confirm 2.5h minimum shift blocks and keep EHR visit slots back-to-back with charting buffers.'
  ),
  (
    'margo-margaret-mulgrew',
    'Margo / Margaret Mulgrew',
    'Therapy / LPC alias',
    'Treat Margo and Margaret Mulgrew as the same provider for Jotform matching.',
    'Use the therapy forecast pool and check name aliases before marking a submission unmatched.'
  ),
  (
    'shashai',
    'Shashai',
    'Licensure / state check',
    'Do not assume all submitted states are schedulable without active-state confirmation.',
    'Check active licensure and EHR readiness before publishing shifts.'
  )
on conflict (slug) do update
set
  name = excluded.name,
  exception_type = excluded.exception_type,
  rule = excluded.rule,
  scheduling_action = excluded.scheduling_action,
  active = true,
  updated_at = now();

alter table public.scheduling_exceptions enable row level security;

drop policy if exists "scheduling_exceptions ui read" on public.scheduling_exceptions;
create policy "scheduling_exceptions ui read" on public.scheduling_exceptions
  for select to anon, authenticated using (true);

drop policy if exists "scheduling_exceptions ui write" on public.scheduling_exceptions;
create policy "scheduling_exceptions ui write" on public.scheduling_exceptions
  for all to anon, authenticated using (true) with check (true);
