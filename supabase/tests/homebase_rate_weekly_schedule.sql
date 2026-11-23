-- Run after changing the Homebase rate job; raises on a missing or duplicate
-- rate-sync job, a disabled job, or a cadence other than weekly Monday.
DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname LIKE 'sync-homebase-rates-%') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Homebase rate-sync job';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname LIKE 'sync-homebase-rates-%'
      AND active = true AND schedule = '20 14 * * 1'
  ) THEN
    RAISE EXCEPTION 'Expected active weekly Monday Homebase rate sync at 14:20 UTC';
  END IF;
END;
$$;