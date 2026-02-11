
-- Step 1: Add provider columns to collaborative_agreements
ALTER TABLE public.collaborative_agreements
  ADD COLUMN IF NOT EXISTS provider_id uuid,
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS provider_email text,
  ADD COLUMN IF NOT EXISTS provider_npi text;

-- Step 2: Function to split multi-provider agreements
CREATE OR REPLACE FUNCTION public.split_multi_provider_agreements()
RETURNS void AS $$
DECLARE
  orig_agreement RECORD;
  prov RECORD;
  first_provider boolean;
  new_agreement_id uuid;
BEGIN
  FOR orig_agreement IN
    SELECT ca.* FROM collaborative_agreements ca
    WHERE EXISTS (SELECT 1 FROM agreement_providers ap WHERE ap.agreement_id = ca.id)
  LOOP
    first_provider := true;
    
    FOR prov IN
      SELECT * FROM agreement_providers ap
      WHERE ap.agreement_id = orig_agreement.id
      ORDER BY ap.created_at ASC
    LOOP
      IF first_provider THEN
        UPDATE collaborative_agreements
        SET provider_id = prov.provider_id,
            provider_name = prov.provider_name,
            provider_email = prov.provider_email,
            provider_npi = prov.provider_npi
        WHERE id = orig_agreement.id;
        first_provider := false;
      ELSE
        new_agreement_id := gen_random_uuid();
        
        INSERT INTO collaborative_agreements (
          id, state_id, state_name, state_abbreviation,
          physician_id, physician_name, physician_email, physician_npi,
          physician_signed_at, workflow_status, readiness_status,
          start_date, end_date, next_renewal_date,
          meeting_cadence, renewal_cadence, supervision_type,
          chart_review_required, chart_review_frequency,
          agreement_document_url, medallion_document_url, medallion_id,
          box_sign_request_id, box_sign_status,
          source, created_by, created_at, updated_at,
          provider_id, provider_name, provider_email, provider_npi,
          admin_override, admin_override_at, admin_override_by, admin_override_reason,
          blocking_reasons, readiness_last_checked_at,
          provider_message, provider_message_sent_at, provider_message_sent_by,
          terminated_at, terminated_by, termination_reason, termination_document_url
        )
        VALUES (
          new_agreement_id, orig_agreement.state_id, orig_agreement.state_name, orig_agreement.state_abbreviation,
          orig_agreement.physician_id, orig_agreement.physician_name, orig_agreement.physician_email, orig_agreement.physician_npi,
          orig_agreement.physician_signed_at, orig_agreement.workflow_status, orig_agreement.readiness_status,
          orig_agreement.start_date, orig_agreement.end_date, orig_agreement.next_renewal_date,
          orig_agreement.meeting_cadence, orig_agreement.renewal_cadence, orig_agreement.supervision_type,
          orig_agreement.chart_review_required, orig_agreement.chart_review_frequency,
          orig_agreement.agreement_document_url, orig_agreement.medallion_document_url, orig_agreement.medallion_id,
          orig_agreement.box_sign_request_id, orig_agreement.box_sign_status,
          orig_agreement.source, orig_agreement.created_by, orig_agreement.created_at, now(),
          prov.provider_id, prov.provider_name, prov.provider_email, prov.provider_npi,
          orig_agreement.admin_override, orig_agreement.admin_override_at, orig_agreement.admin_override_by, orig_agreement.admin_override_reason,
          orig_agreement.blocking_reasons, orig_agreement.readiness_last_checked_at,
          orig_agreement.provider_message, orig_agreement.provider_message_sent_at, orig_agreement.provider_message_sent_by,
          orig_agreement.terminated_at, orig_agreement.terminated_by, orig_agreement.termination_reason, orig_agreement.termination_document_url
        );
        
        UPDATE agreement_providers SET agreement_id = new_agreement_id WHERE id = prov.id;
        
        UPDATE agreement_tasks
        SET agreement_id = new_agreement_id
        WHERE agreement_id = orig_agreement.id
          AND provider_id = prov.provider_id
          AND provider_id IS NOT NULL;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Execute the split
SELECT public.split_multi_provider_agreements();

-- Step 4: Clean up
DROP FUNCTION public.split_multi_provider_agreements();

-- Step 5: Recreate agreement_summary view with provider info
DROP VIEW IF EXISTS public.agreement_summary;
CREATE OR REPLACE VIEW public.agreement_summary AS
SELECT
  ca.id,
  ca.state_abbreviation,
  ca.state_name,
  ca.physician_id,
  ca.physician_name,
  ca.physician_email,
  ca.provider_id,
  ca.provider_name,
  ca.provider_email,
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
  (SELECT count(*) FROM agreement_providers ap WHERE ap.agreement_id = ca.id AND ap.is_active = true) AS active_provider_count,
  (SELECT count(*) FROM agreement_tasks at2 WHERE at2.agreement_id = ca.id AND at2.status IN ('pending'::agreement_task_status, 'in_progress'::agreement_task_status)) AS pending_task_count,
  (SELECT min(sm.scheduled_date) FROM supervision_meetings sm WHERE sm.agreement_id = ca.id AND sm.scheduled_date > now() AND sm.status = 'scheduled') AS next_meeting_date,
  scr.ca_required,
  scr.ca_meeting_cadence,
  scr.fpa_status,
  scr.meeting_months
FROM collaborative_agreements ca
LEFT JOIN state_compliance_requirements scr ON scr.state_abbreviation = ca.state_abbreviation;
