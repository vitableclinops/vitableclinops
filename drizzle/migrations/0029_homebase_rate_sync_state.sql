CREATE TABLE public.homebase_rate_sync_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  cron_token uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT (key, value, updated_at) ON public.homebase_rate_sync_state TO authenticated;
GRANT ALL ON public.homebase_rate_sync_state TO service_role;
ALTER TABLE public.homebase_rate_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read Homebase rate sync results" ON public.homebase_rate_sync_state
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.homebase_rate_sync_state (key) SELECT 'latest';
DO $migration$
BEGIN
  PERFORM cron.schedule(
    'sync-homebase-rates-hourly',
    '20 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://saksjvmqyudkowxypoce.supabase.co/functions/v1/sync-homebase-rates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rate-sync-token', (SELECT cron_token::text FROM public.homebase_rate_sync_state WHERE key = 'latest')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $job$
  );
END
$migration$;