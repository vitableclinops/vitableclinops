CREATE OR REPLACE VIEW public.provider_directory_public AS
 SELECT id, user_id, email, full_name, first_name, last_name, preferred_name, credentials, profession,
    primary_specialty, npi_number, phone_number, avatar_url, employment_status, employment_type, agency_id,
    manages_own_renewals, pod_id, activation_status, onboarding_completed, start_date_on_network, bio, languages,
    service_offerings, services_offered, patient_age_preference, min_patient_age,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN birthday ELSE NULL::date END AS birthday,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_line_1 ELSE NULL::text END AS address_line_1,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_line_2 ELSE NULL::text END AS address_line_2,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_city ELSE NULL::text END AS address_city,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_state ELSE NULL::text END AS address_state,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN postal_code ELSE NULL::text END AS postal_code,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN personal_email ELSE NULL::text END AS personal_email,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN emergency_contact_name ELSE NULL::text END AS emergency_contact_name,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN emergency_contact_phone ELSE NULL::text END AS emergency_contact_phone,
    created_at, updated_at
   FROM profiles
  WHERE directory_visibility <> 'excluded';