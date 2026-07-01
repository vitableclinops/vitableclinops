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

-- 8:00 AM Central / 9:00 AM Eastern during daylight saving time is 13:00 UTC.
-- During standard time, update this to 14:00 UTC for 8:00 AM Central / 9:00 AM Eastern.
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
