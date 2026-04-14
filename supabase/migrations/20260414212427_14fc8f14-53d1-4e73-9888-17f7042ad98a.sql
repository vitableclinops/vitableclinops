
-- License optimization snapshots
CREATE TABLE public.license_optimization_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  profile_id uuid NOT NULL,
  state_abbreviation text NOT NULL,
  provider_hours_total numeric,
  active_license_count integer,
  allocated_hours numeric,
  unfilled_slots integer,
  sla_pct numeric,
  estimated_demand_hours numeric,
  coverage_ratio numeric,
  quadrant text DEFAULT 'UNKNOWN',
  wasted_flag boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date, profile_id, state_abbreviation)
);
ALTER TABLE public.license_optimization_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage snapshots" ON public.license_optimization_snapshots FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access snapshots" ON public.license_optimization_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- State activation
CREATE TABLE public.state_activation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.state_activation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage state activation" ON public.state_activation FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access state activation" ON public.state_activation FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read state activation" ON public.state_activation FOR SELECT TO authenticated USING (true);

-- State SLA attainment
CREATE TABLE public.state_sla_attainment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation text NOT NULL,
  sla_pct numeric NOT NULL DEFAULT 0,
  window_label text DEFAULT 'current',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(state_abbreviation, window_label)
);
ALTER TABLE public.state_sla_attainment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage SLA" ON public.state_sla_attainment FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access SLA" ON public.state_sla_attainment FOR ALL TO service_role USING (true) WITH CHECK (true);

-- State leftover slots
CREATE TABLE public.state_leftover_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation text NOT NULL,
  slot_date date NOT NULL,
  unfilled_slots integer NOT NULL DEFAULT 0,
  window_type text DEFAULT 'historical',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(state_abbreviation, slot_date, window_type)
);
ALTER TABLE public.state_leftover_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage leftover slots" ON public.state_leftover_slots FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access leftover slots" ON public.state_leftover_slots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed state_activation with states from provider_licenses
INSERT INTO public.state_activation (state_abbreviation, is_active)
SELECT DISTINCT state_abbreviation, true
FROM public.provider_licenses
WHERE status = 'active'
ON CONFLICT (state_abbreviation) DO NOTHING;
