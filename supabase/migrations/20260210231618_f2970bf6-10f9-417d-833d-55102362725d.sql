-- Update physician_profiles view to include all MD/DO profiles regardless of role assignment
CREATE OR REPLACE VIEW public.physician_profiles AS
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
    (SELECT count(DISTINCT ca.id)
     FROM collaborative_agreements ca
     WHERE ca.physician_id = p.id AND ca.workflow_status = 'active') AS active_agreements_count,
    (SELECT count(DISTINCT ap.provider_id)
     FROM agreement_providers ap
     JOIN collaborative_agreements ca ON ca.id = ap.agreement_id
     WHERE ca.physician_id = p.id AND ap.is_active = true) AS supervised_providers_count,
    (SELECT array_agg(DISTINCT ca.state_abbreviation)
     FROM collaborative_agreements ca
     WHERE ca.physician_id = p.id AND ca.workflow_status = 'active') AS active_states
FROM profiles p
WHERE 
    p.profession IN ('MD', 'DO')
    OR p.credentials IN ('MD', 'DO')
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = p.user_id AND ur.role = 'physician');