-- Schedule compute-license-utilization nightly at 11:30 UTC, 30 minutes after sync-metabase
-- so the optimizer snapshots reflect the freshly-imported leftover slots, SLA, and forecast data.
SELECT cron.unschedule('compute-license-utilization-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-license-utilization-nightly');

SELECT cron.schedule(
  'compute-license-utilization-nightly',
  '30 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/compute-license-utilization',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNha3Nqdm1xeXVka293eHlwb2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNDQzMzUsImV4cCI6MjA4NTgyMDMzNX0.5uy0o02y6fNWM2LDFmpOI-baEmSlOFEZ7GEA4kUG64E'
    ),
    body := jsonb_build_object('window_days', 30, 'triggered_at', now(), 'source', 'pg_cron')
  );
  $$
);