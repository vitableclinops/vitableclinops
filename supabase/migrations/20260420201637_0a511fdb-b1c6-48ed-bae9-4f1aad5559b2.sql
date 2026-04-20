-- Schedule compute-coverage-bridge nightly at 12:00 UTC (30 min after license optimizer)
SELECT cron.unschedule('compute-coverage-bridge-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-coverage-bridge-nightly');

SELECT cron.schedule(
  'compute-coverage-bridge-nightly',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/compute-coverage-bridge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNha3Nqdm1xeXVka293eHlwb2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNDQzMzUsImV4cCI6MjA4NTgyMDMzNX0.5uy0o02y6fNWM2LDFmpOI-baEmSlOFEZ7GEA4kUG64E'
    ),
    body := jsonb_build_object('triggered_at', now(), 'source', 'pg_cron')
  );
  $$
);

-- Schedule compute-visit-cost nightly at 12:15 UTC
SELECT cron.unschedule('compute-visit-cost-nightly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-visit-cost-nightly');

SELECT cron.schedule(
  'compute-visit-cost-nightly',
  '15 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/compute-visit-cost',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNha3Nqdm1xeXVka293eHlwb2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNDQzMzUsImV4cCI6MjA4NTgyMDMzNX0.5uy0o02y6fNWM2LDFmpOI-baEmSlOFEZ7GEA4kUG64E'
    ),
    body := jsonb_build_object('triggered_at', now(), 'source', 'pg_cron')
  );
  $$
);