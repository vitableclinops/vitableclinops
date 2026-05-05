-- Migration: open SELECT to anon/authenticated on scheduling tables for the
-- Lovable UI. The original 0016_enable_rls_new_tables.sql migration installed
-- a blanket "no anon access" policy on every scheduling table assuming reads
-- would only flow through service-role edge functions. The Monthly Forecast
-- page in vitableclinops reads these tables directly via the publishable anon
-- key, so we replace the deny with SELECT-only policies.
--
-- Writes remain locked. Edge functions (sync-jotform-submissions,
-- compute-demand-forecast, evaluate-schedule-submissions, sync-homebase-rates)
-- continue to mutate via service-role.

DO $$
DECLARE
  t text;
  read_tables text[] := ARRAY[
    'providers',
    'provider_licenses',
    'provider_state_active',
    'provider_pay_rates',
    'provider_utilization_daily',
    'utilization_summary',
    'shifts',
    'schedule_submissions',
    'demand_forecast',
    'state_demand_targets',
    'sla_daily',
    'coverage_gaps_daily',
    'recommendations_daily',
    'recommendations_monthly',
    'monthly_appointment_totals'
  ];
BEGIN
  FOREACH t IN ARRAY read_tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "no anon access" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "ui read access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "ui read access" ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      t
    );
  END LOOP;
END $$;

GRANT SELECT ON public.v_monthly_demand TO anon, authenticated;
GRANT SELECT ON public.v_monthly_cost_per_visit TO anon, authenticated;
GRANT SELECT ON public.v_provider_current_rate TO anon, authenticated;
GRANT SELECT ON public.v_state_blended_rate TO anon, authenticated;
