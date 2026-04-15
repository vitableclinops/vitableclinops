-- Ops feature tables: demand forecast, provider ops info, matching engine
-- Branch: ops-features

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. demand_forecast  (weekly projected visits per state from Metabase)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.demand_forecast (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation  text        NOT NULL,
  week_start          date        NOT NULL,
  projected_visits    integer     NOT NULL DEFAULT 0,
  imported_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_abbreviation, week_start)
);

CREATE INDEX idx_demand_forecast_state ON public.demand_forecast(state_abbreviation);
CREATE INDEX idx_demand_forecast_week  ON public.demand_forecast(week_start);

ALTER TABLE public.demand_forecast ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage demand_forecast" ON public.demand_forecast
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view demand_forecast" ON public.demand_forecast
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. provider_ops_info  (hourly rate, employment type for ops/cost tracking)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.provider_ops_info (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  hourly_rate     numeric(8,2),
  employment_type text        NOT NULL DEFAULT 'employee',  -- 'employee' | 'contractor'
  contractor_org  text,   -- e.g. 'DirectShifts'
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_ops_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage provider_ops_info" ON public.provider_ops_info
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view provider_ops_info" ON public.provider_ops_info
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

CREATE TRIGGER update_provider_ops_info_updated_at
  BEFORE UPDATE ON public.provider_ops_info
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. matching_engine_runs  (metadata for each optimizer run)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.matching_engine_runs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date              date        NOT NULL DEFAULT CURRENT_DATE,
  week_start            date        NOT NULL,
  status                text        NOT NULL DEFAULT 'completed',
  total_demand_hours    numeric(10,2),
  total_supply_hours    numeric(10,2),
  surplus_hours         numeric(10,2),
  gap_hours             numeric(10,2),
  states_balanced       integer,
  states_deficit        integer,
  states_surplus        integer,
  states_deactivated    jsonb       DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matching_runs_week ON public.matching_engine_runs(week_start);

ALTER TABLE public.matching_engine_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage matching_engine_runs" ON public.matching_engine_runs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view matching_engine_runs" ON public.matching_engine_runs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. matching_assignments  (per-provider-state assignments for a run)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.matching_assignments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid        NOT NULL REFERENCES public.matching_engine_runs(id) ON DELETE CASCADE,
  profile_id          uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  state_abbreviation  text        NOT NULL,
  assignment_type     text        NOT NULL,  -- 'primary' | 'overflow' | 'deactivate'
  assigned_hours      numeric(8,2),
  week_start          date,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matching_assignments_run     ON public.matching_assignments(run_id);
CREATE INDEX idx_matching_assignments_profile ON public.matching_assignments(profile_id);
CREATE INDEX idx_matching_assignments_state   ON public.matching_assignments(state_abbreviation);

ALTER TABLE public.matching_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage matching_assignments" ON public.matching_assignments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view matching_assignments" ON public.matching_assignments
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));
