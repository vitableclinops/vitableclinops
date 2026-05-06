-- Scheduling Workbench Step 2 follow-up
-- Non-destructive compatibility backfill from legacy fields.

-- 1) providers email/status/classification backfill
UPDATE public.providers
SET
  vitable_email = COALESCE(vitable_email, email),
  status = COALESCE(
    status,
    CASE
      WHEN active = true THEN 'active'::public.provider_status
      WHEN active = false THEN 'paused'::public.provider_status
      ELSE 'onboarding'::public.provider_status
    END
  ),
  classification = COALESCE(classification, 'telehealth_1099'::public.provider_classification)
WHERE
  (vitable_email IS NULL AND email IS NOT NULL)
  OR status IS NULL
  OR classification IS NULL;

-- 2) provider_state_status compatibility mapping
-- Prefer new canonical state column; backfill from state_abbreviation where available.
UPDATE public.provider_state_status
SET state = state_abbreviation
WHERE state IS NULL
  AND state_abbreviation IS NOT NULL;

-- Map ehr_active from existing activation status enum/text when present.
UPDATE public.provider_state_status
SET ehr_active = CASE
  WHEN ehr_activation_status::text = 'active' THEN true
  ELSE false
END
WHERE ehr_active IS NULL;

-- 3) schedule_submissions month backfill from target_month/submitted_at
UPDATE public.schedule_submissions
SET month = COALESCE(month, target_month, date_trunc('month', submitted_at)::date)
WHERE month IS NULL;

-- 4) seed cohorts baseline if absent
INSERT INTO public.cohorts (name, states)
VALUES
  ('Core', '{}'),
  ('Growth', '{}'),
  ('021', '{}'),
  ('DE', ARRAY['DE']),
  ('MD Only', ARRAY['MD']),
  ('DMV', ARRAY['DC','MD','VA']),
  ('Therapy', '{}'),
  ('MH Coaching', '{}'),
  ('Health Coaching', '{}')
ON CONFLICT (name) DO NOTHING;

-- 5) helpful view for effective forecast (override wins)
CREATE OR REPLACE VIEW public.v_effective_demand_forecast AS
SELECT
  df.id AS demand_forecast_id,
  df.month,
  df.state,
  df.cohort,
  COALESCE(fo.weekday_target_hours, df.weekday_target_hours) AS weekday_target_hours,
  COALESCE(fo.weekend_target_hours, df.weekend_target_hours) AS weekend_target_hours,
  CASE WHEN fo.id IS NULL THEN false ELSE true END AS has_override,
  fo.reason AS override_reason,
  df.source,
  df.synced_at
FROM public.demand_forecast df
LEFT JOIN public.forecast_overrides fo
  ON fo.month = df.month
 AND fo.state = df.state
 AND fo.cohort = df.cohort;

-- 6) audit trigger helper for updated_at consistency
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cohorts_updated_at ON public.cohorts;
CREATE TRIGGER trg_cohorts_updated_at
BEFORE UPDATE ON public.cohorts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_proposed_shifts_updated_at ON public.proposed_shifts;
CREATE TRIGGER trg_proposed_shifts_updated_at
BEFORE UPDATE ON public.proposed_shifts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_activation_recommendations_updated_at ON public.activation_recommendations;
CREATE TRIGGER trg_activation_recommendations_updated_at
BEFORE UPDATE ON public.activation_recommendations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_publish_checklist_updated_at ON public.publish_checklist;
CREATE TRIGGER trg_publish_checklist_updated_at
BEFORE UPDATE ON public.publish_checklist
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
