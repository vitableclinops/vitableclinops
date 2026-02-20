
-- ============================================================
-- Data Model Cleanup: Remove duplicates, add FK constraints, add sync triggers
-- ============================================================

-- First drop the dependent view so we can alter columns
DROP VIEW IF EXISTS public.provider_directory_public;

-- 1. Drop duplicate `date_of_birth` column (0 rows have data; `birthday` has 47)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS date_of_birth;

-- 2. Drop `home_address` text column (0 rows have data; structured address fields have 48)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS home_address;

-- 3. Drop `collaborative_physician` text column (derived from collaborative_agreements)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS collaborative_physician;

-- 4. Drop `actively_licensed_states` denormalized text column (derived from provider_state_status)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS actively_licensed_states;

-- Recreate the view without the dropped columns
CREATE OR REPLACE VIEW public.provider_directory_public AS
SELECT 
    id,
    user_id,
    email,
    full_name,
    first_name,
    last_name,
    preferred_name,
    credentials,
    profession,
    primary_specialty,
    npi_number,
    phone_number,
    avatar_url,
    employment_status,
    employment_type,
    agency_id,
    manages_own_renewals,
    pod_id,
    activation_status,
    onboarding_completed,
    start_date_on_network,
    bio,
    languages,
    service_offerings,
    services_offered,
    patient_age_preference,
    min_patient_age,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN birthday ELSE NULL::date END AS birthday,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_line_1 ELSE NULL::text END AS address_line_1,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_line_2 ELSE NULL::text END AS address_line_2,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_city ELSE NULL::text END AS address_city,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_state ELSE NULL::text END AS address_state,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN postal_code ELSE NULL::text END AS postal_code,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN personal_email ELSE NULL::text END AS personal_email,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN emergency_contact_name ELSE NULL::text END AS emergency_contact_name,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN emergency_contact_phone ELSE NULL::text END AS emergency_contact_phone,
    created_at,
    updated_at
FROM profiles;

-- 5. Add FK constraints to agreement_transfers
ALTER TABLE public.agreement_transfers
  ADD CONSTRAINT agreement_transfers_source_agreement_id_fkey
  FOREIGN KEY (source_agreement_id) REFERENCES public.collaborative_agreements(id);

ALTER TABLE public.agreement_transfers
  ADD CONSTRAINT agreement_transfers_target_agreement_id_fkey
  FOREIGN KEY (target_agreement_id) REFERENCES public.collaborative_agreements(id);

ALTER TABLE public.agreement_transfers
  ADD CONSTRAINT agreement_transfers_source_physician_id_fkey
  FOREIGN KEY (source_physician_id) REFERENCES public.profiles(id);

ALTER TABLE public.agreement_transfers
  ADD CONSTRAINT agreement_transfers_target_physician_id_fkey
  FOREIGN KEY (target_physician_id) REFERENCES public.profiles(id);

-- 6. Sync trigger: when a profile's full_name or email changes, update all denormalized fields
CREATE OR REPLACE FUNCTION public.sync_profile_name_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.full_name IS DISTINCT FROM NEW.full_name THEN
    UPDATE public.agreement_tasks SET assigned_to_name = NEW.full_name
    WHERE assigned_to = NEW.id AND assigned_to_name IS DISTINCT FROM NEW.full_name;

    UPDATE public.milestone_tasks SET assigned_to_name = NEW.full_name
    WHERE assigned_to = NEW.id AND assigned_to_name IS DISTINCT FROM NEW.full_name;

    UPDATE public.milestone_tasks SET provider_name = NEW.full_name
    WHERE provider_id = NEW.id AND provider_name IS DISTINCT FROM NEW.full_name;

    UPDATE public.pods SET pod_lead_name = NEW.full_name
    WHERE pod_lead_id = NEW.id AND pod_lead_name IS DISTINCT FROM NEW.full_name;

    UPDATE public.collaborative_agreements SET physician_name = NEW.full_name
    WHERE physician_id = NEW.id AND physician_name IS DISTINCT FROM NEW.full_name;

    UPDATE public.collaborative_agreements SET provider_name = NEW.full_name
    WHERE provider_id = NEW.id AND provider_name IS DISTINCT FROM NEW.full_name;

    UPDATE public.agreement_providers SET provider_name = NEW.full_name
    WHERE provider_id = NEW.id AND provider_name IS DISTINCT FROM NEW.full_name;

    UPDATE public.meeting_attendees SET provider_name = NEW.full_name
    WHERE provider_id = NEW.id AND provider_name IS DISTINCT FROM NEW.full_name;
  END IF;

  IF OLD.email IS DISTINCT FROM NEW.email THEN
    UPDATE public.pods SET pod_lead_email = NEW.email
    WHERE pod_lead_id = NEW.id AND pod_lead_email IS DISTINCT FROM NEW.email;

    UPDATE public.collaborative_agreements SET physician_email = NEW.email
    WHERE physician_id = NEW.id AND physician_email IS DISTINCT FROM NEW.email;

    UPDATE public.collaborative_agreements SET provider_email = NEW.email
    WHERE provider_id = NEW.id AND provider_email IS DISTINCT FROM NEW.email;

    UPDATE public.agreement_providers SET provider_email = NEW.email
    WHERE provider_id = NEW.id AND provider_email IS DISTINCT FROM NEW.email;

    UPDATE public.meeting_attendees SET provider_email = NEW.email
    WHERE provider_id = NEW.id AND provider_email IS DISTINCT FROM NEW.email;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_profile_name_changes
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_name_changes();
