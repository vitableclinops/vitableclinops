-- State-level same/next-day access snapshot.
--
-- These rows are intentionally non-additive across states: a single open
-- provider slot can be available in multiple states. Use them to answer
-- "what does access look like in this state?", not "what is network capacity?"

create table if not exists public.state_access_slots_daily (
  id              uuid primary key default gen_random_uuid(),
  access_date     date not null,
  state           text not null check (state ~ '^[A-Z]{2}$'),
  booked_slots    integer,
  available_slots integer,
  total_slots     integer,
  source          text not null default 'metabase_sync',
  source_card_id  integer,
  raw_payload     jsonb not null default '{}'::jsonb,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (access_date, state, source)
);

create index if not exists state_access_slots_daily_date_idx
  on public.state_access_slots_daily (access_date, state);

alter table public.state_access_slots_daily enable row level security;

drop policy if exists "state_access_slots_daily ui read" on public.state_access_slots_daily;
create policy "state_access_slots_daily ui read" on public.state_access_slots_daily
  for select to anon, authenticated using (true);
