
-- ── PCP State Coverage ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pcp_state_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation text NOT NULL,
  report_date date NOT NULL,
  pcp_count integer,
  coverage_pct numeric(5,2),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_abbreviation, report_date)
);
CREATE INDEX IF NOT EXISTS idx_pcp_state_coverage_date ON public.pcp_state_coverage (report_date DESC);
ALTER TABLE public.pcp_state_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read pcp_state_coverage" ON public.pcp_state_coverage
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manage pcp_state_coverage" ON public.pcp_state_coverage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Provider Appointment Count ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_appointment_count (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name_raw text NOT NULL,
  report_date date NOT NULL,
  appointment_count integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_name_raw, report_date)
);
CREATE INDEX IF NOT EXISTS idx_provider_appointment_count_date ON public.provider_appointment_count (report_date DESC);
ALTER TABLE public.provider_appointment_count ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read provider_appointment_count" ON public.provider_appointment_count
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manage provider_appointment_count" ON public.provider_appointment_count
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── SLA Attainment Aggregate ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sla_attainment_aggregate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL UNIQUE,
  avg_sla_pct numeric(5,2) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sla_attainment_aggregate_date ON public.sla_attainment_aggregate (report_date DESC);
ALTER TABLE public.sla_attainment_aggregate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read sla_attainment_aggregate" ON public.sla_attainment_aggregate
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manage sla_attainment_aggregate" ON public.sla_attainment_aggregate
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Telemedicine Availability ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.telemedicine_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation text NOT NULL,
  report_date date NOT NULL,
  availability_pct numeric(5,2),
  available_count integer,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_abbreviation, report_date)
);
CREATE INDEX IF NOT EXISTS idx_telemedicine_availability_date ON public.telemedicine_availability (report_date DESC);
ALTER TABLE public.telemedicine_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read telemedicine_availability" ON public.telemedicine_availability
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manage telemedicine_availability" ON public.telemedicine_availability
  FOR ALL TO service_role USING (true) WITH CHECK (true);
