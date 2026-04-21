-- ---------------------------------------------------------------------------
-- Daily-grain provider utilization + same-day activation candidate support
--
-- Context:
--   `provider_utilization` stores a rolling 5-week average per provider.
--   That grain is too coarse to answer "who has low utilization *today at 8am*
--   and could be activated in a deficit state?"
--
--   This migration adds `provider_utilization_daily` — one row per provider
--   per day — populated from a new Metabase card ("Daily Provider Utilization")
--   by sync-metabase.
--
--   The companion edge function `suggest-activation-candidates` joins this
--   table with provider_licenses / provider_state_status / state_leftover_slots
--   to recommend specific providers to activate in deficit states.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_utilization_daily (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Provider identity (name from Metabase, linked to a profile when we can)
  provider_name TEXT NOT NULL,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Day this row describes
  util_date DATE NOT NULL,

  -- Core metrics
  booked_timeslots INTEGER,
  total_timeslots INTEGER,
  utilization_pct NUMERIC(5,2),

  -- Provenance
  imported_at TIMESTAMPTZ DEFAULT now(),
  source TEXT DEFAULT 'metabase_sync',
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (provider_name, util_date)
);

CREATE INDEX IF NOT EXISTS idx_provider_utilization_daily_date
  ON public.provider_utilization_daily (util_date);
CREATE INDEX IF NOT EXISTS idx_provider_utilization_daily_profile
  ON public.provider_utilization_daily (profile_id);
CREATE INDEX IF NOT EXISTS idx_provider_utilization_daily_date_util
  ON public.provider_utilization_daily (util_date, utilization_pct);

ALTER TABLE public.provider_utilization_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage daily utilization"
  ON public.provider_utilization_daily
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Leadership can view daily utilization"
  ON public.provider_utilization_daily
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'pod_lead'::app_role)
  );

CREATE TRIGGER update_provider_utilization_daily_updated_at
  BEFORE UPDATE ON public.provider_utilization_daily
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Snapshot table: log each run of suggest-activation-candidates so the UI
-- can render "last computed at" and an audit trail of which recommendations
-- have already been acted on.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.activation_candidate_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ran_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_date DATE NOT NULL,
  utilization_threshold NUMERIC(5,2),
  data_source TEXT NOT NULL, -- 'daily' | 'five_week_avg' | 'mixed'
  deficit_state_count INTEGER,
  candidate_count INTEGER,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_activation_candidate_runs_ran_at
  ON public.activation_candidate_runs (ran_at DESC);

ALTER TABLE public.activation_candidate_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage candidate runs"
  ON public.activation_candidate_runs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Leadership can view candidate runs"
  ON public.activation_candidate_runs
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'pod_lead'::app_role)
  );
