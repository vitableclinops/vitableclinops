-- Replace the per-provider utilization-based scaffolding with a flat monthly
-- totals table + ratio view. Cost-per-visit is calculated manually elsewhere;
-- this stores monthly inputs (Metabase 2443/2439 + manual wage total) and
-- a directional approximation view.

DROP VIEW  IF EXISTS public.v_cost_per_visit_monthly;
DROP TABLE IF EXISTS public.provider_metrics_monthly;

-- Monthly appointment + wage totals at the network level.
-- Sources:
--   total_appointments     <- Metabase 2443 (https://metabase.vitablehealth.com/question/2443)
--   completed_appointments <- Metabase 2439 (https://metabase.vitablehealth.com/question/2439)
--   total_wages_paid       <- manual/payroll, one number per month
CREATE TABLE IF NOT EXISTS public.monthly_appointment_totals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start            date NOT NULL UNIQUE,
  total_appointments     integer,
  completed_appointments integer,
  total_wages_paid       numeric,
  data_source            text,
  notes                  text,
  imported_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_appointment_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no anon access"
  ON public.monthly_appointment_totals
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Directional cost-per-visit. Approximation only -- the authoritative number
-- is calculated manually offline.
CREATE OR REPLACE VIEW public.v_monthly_cost_per_visit AS
SELECT
  month_start,
  total_appointments,
  completed_appointments,
  total_wages_paid,
  ROUND(
    (completed_appointments::numeric / NULLIF(total_appointments, 0))::numeric,
    3
  )                                                                   AS completion_rate,
  ROUND(
    (total_wages_paid / NULLIF(completed_appointments, 0))::numeric,
    2
  )                                                                   AS approx_cost_per_completed_visit,
  ROUND(
    (total_wages_paid / NULLIF(total_appointments, 0))::numeric,
    2
  )                                                                   AS approx_cost_per_scheduled_appointment
FROM public.monthly_appointment_totals
ORDER BY month_start DESC;
