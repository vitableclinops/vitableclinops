-- Stores raw JSONB rows for Metabase reports that don't have dedicated tables yet.
-- Used by sync-metabase edge function for:
--   rpt_telemedicine_availability_by_state_per_day
--   average_sla_attainment
--   pcp_state_coverage
--   provider_appointment_count

create table if not exists metabase_raw_exports (
  id            uuid primary key default gen_random_uuid(),
  report_key    text not null,
  pulled_date   date not null,
  rows          jsonb not null default '[]',
  row_count     integer not null default 0,
  pulled_at     timestamptz not null default now(),
  unique (report_key, pulled_date)
);

-- Allow the app to read these exports
alter table metabase_raw_exports enable row level security;

create policy "Authenticated users can read raw exports"
  on metabase_raw_exports for select
  to authenticated
  using (true);
