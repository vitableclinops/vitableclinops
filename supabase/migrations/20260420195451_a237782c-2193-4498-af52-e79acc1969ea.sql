-- Add source and synced_at columns to demand_forecast for freshness tracking parity with other Metabase tables
ALTER TABLE public.demand_forecast
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_demand_forecast_synced_at ON public.demand_forecast (synced_at DESC);

-- Schedule alert-sync-failures every 15 minutes via pg_cron
-- (pg_cron and pg_net are already enabled for other scheduled functions)
SELECT cron.unschedule('alert-sync-failures')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'alert-sync-failures');

SELECT cron.schedule(
  'alert-sync-failures',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/alert-sync-failures',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNha3Nqdm1xeXVka293eHlwb2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNDQzMzUsImV4cCI6MjA4NTgyMDMzNX0.5uy0o02y6fNWM2LDFmpOI-baEmSlOFEZ7GEA4kUG64E'
    ),
    body := jsonb_build_object('triggered_at', now())
  );
  $$
);

-- Schedule sync-metabase nightly at 11:00 UTC (matches the GitHub Actions schedule we are deprecating)
SELECT cron.unschedule('sync-metabase-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-metabase-nightly');

SELECT cron.schedule(
  'sync-metabase-nightly',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/sync-metabase',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', current_setting('app.sync_secret', true)
    ),
    body := jsonb_build_object('triggered_at', now(), 'source', 'pg_cron')
  );
  $$
);