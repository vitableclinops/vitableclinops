
-- 1. demand_forecast
CREATE TABLE IF NOT EXISTS public.demand_forecast (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation TEXT NOT NULL,
  week_start DATE NOT NULL,
  projected_visits NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (state_abbreviation, week_start)
);
ALTER TABLE public.demand_forecast ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read demand_forecast" ON public.demand_forecast FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage demand_forecast" ON public.demand_forecast FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. matching_engine_runs
CREATE TABLE IF NOT EXISTS public.matching_engine_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  surplus_hours NUMERIC DEFAULT 0,
  gap_hours NUMERIC DEFAULT 0,
  states_deactivated TEXT[] DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.matching_engine_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read matching_engine_runs" ON public.matching_engine_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert matching_engine_runs" ON public.matching_engine_runs FOR INSERT TO authenticated WITH CHECK (true);

-- 3. matching_assignments
CREATE TABLE IF NOT EXISTS public.matching_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.matching_engine_runs(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL,
  state_abbreviation TEXT NOT NULL,
  assignment_type TEXT NOT NULL DEFAULT 'primary',
  assigned_hours NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.matching_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read matching_assignments" ON public.matching_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert matching_assignments" ON public.matching_assignments FOR INSERT TO authenticated WITH CHECK (true);

-- 4. contractor_compliance_docs
CREATE TABLE IF NOT EXISTS public.contractor_compliance_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  state_abbreviation TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'missing',
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, state_abbreviation, doc_type)
);
ALTER TABLE public.contractor_compliance_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read contractor_compliance_docs" ON public.contractor_compliance_docs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage contractor_compliance_docs" ON public.contractor_compliance_docs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. provider_ops_info
CREATE TABLE IF NOT EXISTS public.provider_ops_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE,
  hourly_rate NUMERIC,
  employment_type TEXT,
  contractor_org TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_ops_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read provider_ops_info" ON public.provider_ops_info FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage provider_ops_info" ON public.provider_ops_info FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. utilization_daily
CREATE TABLE IF NOT EXISTS public.utilization_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  util_date DATE NOT NULL,
  overall_pct NUMERIC(6,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (util_date)
);
ALTER TABLE public.utilization_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read utilization_daily" ON public.utilization_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage utilization_daily" ON public.utilization_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
