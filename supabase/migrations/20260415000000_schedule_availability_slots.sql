-- Schedule compute-availability-slots to run nightly.
--
-- Execution order (UTC):
--   01:00  sync-homebase               (pulls latest Homebase shifts)
--   02:00  compute-availability-slots  (derives forecast slots from shifts)  ← this migration
--   03:00  compute-license-utilization (reads slots → builds optimizer snapshots)
--
-- Extensions are assumed already enabled by an earlier migration:
--   pg_cron (pg_catalog) + pg_net (extensions)
-- We re-enable defensively in case of out-of-order applies.
CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;

-- Remove any existing job with this name before (re)creating it
SELECT cron.unschedule('compute-availability-slots-nightly')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'compute-availability-slots-nightly'
);

SELECT cron.schedule(
  'compute-availability-slots-nightly',
  '0 2 * * *',   -- 02:00 UTC every night
  $$
  SELECT net.http_post(
    url     := 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/compute-availability-slots',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"days_back":7,"days_ahead":14}'::jsonb
  ) AS request_id;
  $$
);
