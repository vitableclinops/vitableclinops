-- 1. Add alert tracking to sync_runs
ALTER TABLE public.sync_runs
  ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sync_runs_status_alerted
  ON public.sync_runs (status, last_alerted_at)
  WHERE status IN ('error', 'partial');

-- 2. Backfill synced_at + source on state_sla_attainment
UPDATE public.state_sla_attainment
   SET synced_at = COALESCE(synced_at, imported_at, created_at, now()),
       source    = COALESCE(source, 'metabase_sync')
 WHERE synced_at IS NULL OR source IS NULL;

-- 3. Backfill synced_at + source on state_leftover_slots
--    forecast rows came from compute-availability-slots; historical from Metabase CSV
UPDATE public.state_leftover_slots
   SET synced_at = COALESCE(synced_at, imported_at, created_at, now()),
       source    = COALESCE(
         source,
         CASE WHEN window_type = 'forecast' THEN 'compute_availability'
              ELSE 'metabase_sync'
         END
       )
 WHERE synced_at IS NULL OR source IS NULL;