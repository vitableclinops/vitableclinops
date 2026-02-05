-- Fix views to use SECURITY INVOKER (default behavior, explicitly stated)
-- Drop and recreate views with proper security

DROP VIEW IF EXISTS public.physician_profiles;
DROP VIEW IF EXISTS public.agreement_summary;

-- Recreate physician_profiles with explicit SECURITY INVOKER
CREATE VIEW public.physician_profiles 
WITH (security_invoker = true)
AS
SELECT 
  p.id,
  p.user_id,
  p.full_name,
  p.email,
  p.phone_number,
  p.npi_number,
  p.credentials,
  p.primary_specialty,
  p.avatar_url,
  p.employment_status,
  p.created_at,
  (
    SELECT COUNT(DISTINCT ca.id) 
    FROM collaborative_agreements ca 
    WHERE ca.physician_id = p.id 
    AND ca.workflow_status = 'active'
  ) as active_agreements_count,
  (
    SELECT COUNT(DISTINCT ap.provider_id) 
    FROM agreement_providers ap 
    JOIN collaborative_agreements ca ON ca.id = ap.agreement_id
    WHERE ca.physician_id = p.id 
    AND ap.is_active = true
  ) as supervised_providers_count,
  (
    SELECT array_agg(DISTINCT ca.state_abbreviation)
    FROM collaborative_agreements ca 
    WHERE ca.physician_id = p.id 
    AND ca.workflow_status = 'active'
  ) as active_states
FROM profiles p
JOIN user_roles ur ON ur.user_id = p.user_id
WHERE ur.role = 'physician';

-- Recreate agreement_summary with explicit SECURITY INVOKER
CREATE VIEW public.agreement_summary 
WITH (security_invoker = true)
AS
SELECT 
  ca.id,
  ca.state_abbreviation,
  ca.state_name,
  ca.physician_id,
  ca.physician_name,
  ca.physician_email,
  ca.workflow_status,
  ca.start_date,
  ca.end_date,
  ca.meeting_cadence,
  ca.chart_review_required,
  ca.chart_review_frequency,
  ca.next_renewal_date,
  ca.terminated_at,
  ca.termination_reason,
  ca.created_at,
  (SELECT COUNT(*) FROM agreement_providers ap WHERE ap.agreement_id = ca.id AND ap.is_active = true) as active_provider_count,
  (SELECT COUNT(*) FROM agreement_tasks at WHERE at.agreement_id = ca.id AND at.status IN ('pending', 'in_progress')) as pending_task_count,
  (SELECT MIN(sm.scheduled_date) FROM supervision_meetings sm WHERE sm.agreement_id = ca.id AND sm.scheduled_date > now() AND sm.status = 'scheduled') as next_meeting_date,
  scr.ca_required,
  scr.ca_meeting_cadence,
  scr.fpa_status,
  scr.meeting_months
FROM collaborative_agreements ca
LEFT JOIN state_compliance_requirements scr ON scr.state_abbreviation = ca.state_abbreviation;