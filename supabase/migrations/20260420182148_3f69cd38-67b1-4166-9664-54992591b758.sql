
-- 1. Generic sync_runs table for tracking nightly job health
CREATE TABLE IF NOT EXISTS public.sync_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  function_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,
  rows_processed INTEGER DEFAULT 0,
  rows_failed INTEGER DEFAULT 0,
  error_message TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_function_started
  ON public.sync_runs (function_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status
  ON public.sync_runs (status, started_at DESC);

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sync runs"
  ON public.sync_runs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages sync runs"
  ON public.sync_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Freshness columns for SLA + leftover slots tables
ALTER TABLE public.state_sla_attainment
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.state_leftover_slots
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_state_sla_synced_at
  ON public.state_sla_attainment (synced_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_state_leftover_synced_at
  ON public.state_leftover_slots (synced_at DESC NULLS LAST);
