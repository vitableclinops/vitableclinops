-- Per-provider current open rate (latest active row from provider_pay_rates).
CREATE OR REPLACE VIEW public.v_provider_current_rate AS
SELECT
  p.id                       AS provider_id,
  p.name,
  p.profession,
  p.email,
  p.homebase_employee_id,
  p.active,
  ppr.hourly_rate,
  ppr.role                   AS rate_role,
  ppr.source                 AS rate_source,
  ppr.effective_from
FROM public.providers p
LEFT JOIN public.provider_pay_rates ppr
  ON ppr.provider_id = p.id AND ppr.effective_to IS NULL;

-- Per-state blended rate stats across active providers licensed in that state.
CREATE OR REPLACE VIEW public.v_state_blended_rate AS
SELECT
  psa.state,
  COUNT(DISTINCT psa.provider_id) AS licensed_provider_count,
  COUNT(DISTINCT CASE WHEN ppr.hourly_rate IS NOT NULL THEN psa.provider_id END)
    AS rated_provider_count,
  ROUND(AVG(ppr.hourly_rate)::numeric, 2) AS avg_hourly_rate,
  ROUND(
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ppr.hourly_rate)::numeric,
    2
  ) AS median_hourly_rate,
  MIN(ppr.hourly_rate) AS min_hourly_rate,
  MAX(ppr.hourly_rate) AS max_hourly_rate
FROM public.provider_state_active psa
JOIN public.providers p ON p.id = psa.provider_id AND p.active
LEFT JOIN public.provider_pay_rates ppr
  ON ppr.provider_id = psa.provider_id AND ppr.effective_to IS NULL
WHERE psa.is_active
GROUP BY psa.state;

-- Staging table for per-provider monthly metrics imported from Metabase
-- (card 3287 + sister cards). Populate any combination of the optional
-- fields; cost-per-visit needs at minimum completed_visits AND one of
-- (worked_hours) OR (scheduled_hours + utilization_pct).
CREATE TABLE IF NOT EXISTS public.provider_metrics_monthly (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  month_start       date NOT NULL,
  scheduled_hours   numeric,
  worked_hours      numeric,
  completed_visits  integer,
  utilization_pct   numeric,
  data_source       text NOT NULL DEFAULT 'metabase_3287',
  imported_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_metrics_monthly_unique UNIQUE (provider_id, month_start, data_source)
);

CREATE INDEX IF NOT EXISTS idx_pmm_provider_month
  ON public.provider_metrics_monthly (provider_id, month_start DESC);

ALTER TABLE public.provider_metrics_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no anon access"
  ON public.provider_metrics_monthly
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Per-provider, per-month cost-per-visit.
-- worked_hours preferred; falls back to scheduled_hours * utilization_pct / 100.
CREATE OR REPLACE VIEW public.v_cost_per_visit_monthly AS
WITH base AS (
  SELECT
    pmm.*,
    COALESCE(
      pmm.worked_hours,
      pmm.scheduled_hours * pmm.utilization_pct / 100.0
    ) AS effective_worked_hours
  FROM public.provider_metrics_monthly pmm
)
SELECT
  b.provider_id,
  p.name                                 AS provider,
  p.profession,
  b.month_start,
  b.scheduled_hours,
  b.utilization_pct,
  b.effective_worked_hours               AS worked_hours,
  b.completed_visits,
  ppr.hourly_rate,
  ppr.source                             AS rate_source,
  ROUND((b.effective_worked_hours * ppr.hourly_rate)::numeric, 2)        AS labor_cost,
  ROUND(
    (b.completed_visits::numeric / NULLIF(b.effective_worked_hours, 0))::numeric,
    2
  )                                                                       AS visits_per_worked_hour,
  ROUND(
    ((b.effective_worked_hours * ppr.hourly_rate) /
     NULLIF(b.completed_visits, 0))::numeric,
    2
  )                                                                       AS cost_per_visit
FROM base b
JOIN public.providers p ON p.id = b.provider_id
LEFT JOIN public.provider_pay_rates ppr
  ON ppr.provider_id = b.provider_id AND ppr.effective_to IS NULL;
