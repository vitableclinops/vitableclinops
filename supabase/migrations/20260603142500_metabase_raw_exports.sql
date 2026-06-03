-- Raw Metabase report snapshots used for audit/debug context.

create table if not exists public.metabase_raw_exports (
  id          uuid primary key default gen_random_uuid(),
  report_key  text not null,
  pulled_date date not null,
  rows        jsonb not null default '[]'::jsonb,
  row_count   integer not null default 0,
  pulled_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (report_key, pulled_date)
);

create index if not exists metabase_raw_exports_key_date_idx
  on public.metabase_raw_exports (report_key, pulled_date desc);

alter table public.metabase_raw_exports enable row level security;

drop policy if exists "metabase_raw_exports ui read" on public.metabase_raw_exports;
create policy "metabase_raw_exports ui read" on public.metabase_raw_exports
  for select to anon, authenticated using (true);
