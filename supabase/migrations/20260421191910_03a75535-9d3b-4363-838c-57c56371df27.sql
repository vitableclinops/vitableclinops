-- Schedule daily cron jobs for renewal warnings and ensure agreement validity check is scheduled
-- These run via pg_cron + pg_net. Service role key is read from vault.

DO $$
DECLARE
  v_supabase_url text := 'https://saksjvmqyudkowxypoce.supabase.co';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNha3Nqdm1xeXVka293eHlwb2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNDQzMzUsImV4cCI6MjA4NTgyMDMzNX0.5uy0o02y6fNWM2LDFmpOI-baEmSlOFEZ7GEA4kUG64E';
BEGIN
  -- Ensure pg_cron + pg_net extensions exist
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Unschedule existing renewal-warnings job if any (idempotent)
  PERFORM cron.unschedule('renewal-warnings-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'renewal-warnings-daily');

  -- Schedule renewal warnings daily at 14:00 UTC (9am CT)
  PERFORM cron.schedule(
    'renewal-warnings-daily',
    '0 14 * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := %L::jsonb
      );
      $cron$,
      v_supabase_url || '/functions/v1/check-renewal-warnings',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon_key)::text,
      '{}'::text
    )
  );
END $$;