
-- ── Provider Cost Rates (PII / sensitive) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_cost_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_name text,
  employment_type text,
  hourly_rate numeric(10,2) NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS idx_provider_cost_rates_profile ON public.provider_cost_rates (profile_id);
CREATE INDEX IF NOT EXISTS idx_provider_cost_rates_effective ON public.provider_cost_rates (effective_from DESC, effective_to);
ALTER TABLE public.provider_cost_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read provider_cost_rates" ON public.provider_cost_rates
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage provider_cost_rates" ON public.provider_cost_rates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manage provider_cost_rates" ON public.provider_cost_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER set_provider_cost_rates_updated_at
  BEFORE UPDATE ON public.provider_cost_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Visit Cost Snapshots (per state per day) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visit_cost_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  state_abbreviation text NOT NULL,
  total_hours numeric(10,2) NOT NULL DEFAULT 0,
  total_cost numeric(12,2) NOT NULL DEFAULT 0,
  total_visits integer NOT NULL DEFAULT 0,
  cost_per_visit numeric(10,2),
  cost_per_hour numeric(10,2),
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, state_abbreviation)
);
CREATE INDEX IF NOT EXISTS idx_visit_cost_snapshots_date ON public.visit_cost_snapshots (snapshot_date DESC);
ALTER TABLE public.visit_cost_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read visit_cost_snapshots" ON public.visit_cost_snapshots
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manage visit_cost_snapshots" ON public.visit_cost_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Coverage Bridge Snapshots (joined supply vs demand) ─────────────────────
CREATE TABLE IF NOT EXISTS public.coverage_bridge_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  state_abbreviation text NOT NULL,
  supply_hours numeric(10,2) NOT NULL DEFAULT 0,
  supply_slots integer NOT NULL DEFAULT 0,
  demand_slots integer NOT NULL DEFAULT 0,
  demand_hours numeric(10,2) NOT NULL DEFAULT 0,
  gap_slots integer NOT NULL DEFAULT 0,
  coverage_ratio numeric(6,3),
  status text NOT NULL DEFAULT 'unknown',
  confidence text NOT NULL DEFAULT 'low',
  source_notes text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, state_abbreviation)
);
CREATE INDEX IF NOT EXISTS idx_coverage_bridge_date ON public.coverage_bridge_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_coverage_bridge_status ON public.coverage_bridge_snapshots (status);
ALTER TABLE public.coverage_bridge_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read coverage_bridge_snapshots" ON public.coverage_bridge_snapshots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manage coverage_bridge_snapshots" ON public.coverage_bridge_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
