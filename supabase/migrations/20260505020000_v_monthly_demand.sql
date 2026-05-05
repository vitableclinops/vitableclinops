-- Pre-aggregates demand_forecast to one row per (state, month). Lets the
-- evaluator pull baseline demand without hitting PostgREST's row caps —
-- a full month of demand_forecast at 47 states × 30 days = 1,410 rows is
-- enough to silently truncate the .select() call, which made PA invisible
-- to evaluation.

CREATE OR REPLACE VIEW public.v_monthly_demand AS
SELECT
  state,
  date_trunc('month', date)::date AS month,
  SUM(projected_visits) AS total_visits
FROM public.demand_forecast
WHERE is_baseline = true
GROUP BY state, date_trunc('month', date);
