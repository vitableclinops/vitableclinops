create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- pg_cron invokes the Edge Function through pg_net. The project URL is not
-- secret, but keeping it in Vault matches the Supabase scheduled-functions
-- pattern and lets the job body stay environment-neutral.
do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'project_url'
  ) then
    perform vault.create_secret(
      'https://bbquooftytwprllipcsb.supabase.co',
      'project_url',
      'Provider Ops Hub Supabase project URL for pg_cron edge function calls'
    );
  end if;
end
$$;

-- Manual prerequisite if the value is not already present in Vault:
--   select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'service_role_key', 'Service role JWT for pg_cron edge function calls');
-- To rotate an existing Vault entry:
--   select vault.update_secret(id, '<SUPABASE_SERVICE_ROLE_KEY>', 'service_role_key', 'Service role JWT for pg_cron edge function calls')
--   from vault.decrypted_secrets where name = 'service_role_key';

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'same-next-day-coverage-alert-morning'
  ) then
    perform cron.unschedule('same-next-day-coverage-alert-morning');
  end if;
end
$$;

-- 8:00 AM Central during daylight saving time (CDT) is 13:00 UTC.
-- During standard time (CST), update this to 14:00 UTC.
select cron.schedule(
  'same-next-day-coverage-alert-morning',
  '0 13 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/same-next-day-coverage-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := jsonb_build_object(
      'scheduled', true,
      'source', 'pg_cron',
      'requested_at', now()
    ),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

-- Optional midday re-check at 18:00 UTC. Uncomment after deciding whether the
-- extra Slack touchpoint is useful.
--
-- select cron.schedule(
--   'same-next-day-coverage-alert-midday',
--   '0 18 * * *',
--   $$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
--       || '/functions/v1/same-next-day-coverage-alert',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
--       'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
--     ),
--     body := jsonb_build_object(
--       'scheduled', true,
--       'source', 'pg_cron_midday',
--       'requested_at', now()
--     ),
--     timeout_milliseconds := 120000
--   ) as request_id;
--   $$
-- );
