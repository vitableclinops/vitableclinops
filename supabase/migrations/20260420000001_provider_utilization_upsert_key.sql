-- ─────────────────────────────────────────────────────────────────────────────
-- Add UNIQUE constraint needed for sync-metabase upsert
--
-- sync-metabase's handleProviderUtilization does:
--   .upsert(records, { onConflict: 'provider_name,window_start' })
-- Without a matching unique constraint Supabase/Postgres rejects the upsert.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.provider_utilization
  drop constraint if exists provider_utilization_name_window_unique;

alter table public.provider_utilization
  add constraint provider_utilization_name_window_unique
  unique (provider_name, window_start);
