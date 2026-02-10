
-- Step 1: Migrate data
DELETE FROM public.user_roles
WHERE role = 'leadership'
  AND user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'admin');

UPDATE public.user_roles SET role = 'admin' WHERE role = 'leadership';

-- Step 2: Drop all dependent policies that reference app_role
DROP POLICY IF EXISTS "Admins can manage agencies" ON public.agencies;
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.agreement_audit_log;
DROP POLICY IF EXISTS "Admins can manage all tasks" ON public.agreement_tasks;
DROP POLICY IF EXISTS "Admins can manage all transfers" ON public.agreement_transfers;
DROP POLICY IF EXISTS "Admins can delete calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Admins can insert calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Admins can update calendar events" ON public.calendar_events;
DROP POLICY IF EXISTS "Admins can view compliance log" ON public.compliance_status_log;
DROP POLICY IF EXISTS "Admins can manage all activation events" ON public.ehr_activation_events;
DROP POLICY IF EXISTS "Leadership can view all activation events" ON public.ehr_activation_events;
DROP POLICY IF EXISTS "Admins can manage enhancements" ON public.enhancement_registry;
DROP POLICY IF EXISTS "Admins can insert event activity" ON public.event_activity_log;
DROP POLICY IF EXISTS "Admins can view event activity" ON public.event_activity_log;
DROP POLICY IF EXISTS "Admins can insert attestations" ON public.event_attestations;
DROP POLICY IF EXISTS "Providers can update own attestations" ON public.event_attestations;
DROP POLICY IF EXISTS "Providers can view own attestations" ON public.event_attestations;
DROP POLICY IF EXISTS "Admins can manage all KB articles" ON public.kb_articles;
DROP POLICY IF EXISTS "Users can view published articles matching their roles" ON public.kb_articles;
DROP POLICY IF EXISTS "Admins can manage KB categories" ON public.kb_categories;
DROP POLICY IF EXISTS "Admins can manage milestone audit log" ON public.milestone_audit_log;
DROP POLICY IF EXISTS "Admins can manage all milestone tasks" ON public.milestone_tasks;
DROP POLICY IF EXISTS "Admins can manage pods" ON public.pods;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage all applications" ON public.provider_license_applications;
DROP POLICY IF EXISTS "Admins can manage all licenses" ON public.provider_licenses;
DROP POLICY IF EXISTS "Admins and physicians can manage compliance" ON public.provider_meeting_compliance;
DROP POLICY IF EXISTS "Admins can manage collab decisions" ON public.provider_state_collab_decisions;
DROP POLICY IF EXISTS "Admins can manage all provider state status" ON public.provider_state_status;
DROP POLICY IF EXISTS "Leadership can view all provider state status" ON public.provider_state_status;
DROP POLICY IF EXISTS "Providers can update draft reimbursements" ON public.reimbursement_requests;
DROP POLICY IF EXISTS "Providers can view own reimbursements" ON public.reimbursement_requests;
DROP POLICY IF EXISTS "Admins can view sensitive data log" ON public.sensitive_data_log;
DROP POLICY IF EXISTS "Admins can manage state compliance requirements" ON public.state_compliance_requirements;
DROP POLICY IF EXISTS "Admins can manage config" ON public.system_config;
DROP POLICY IF EXISTS "Admins can manage transfer activity log" ON public.transfer_activity_log;
DROP POLICY IF EXISTS "Admins can manage transfer provider status" ON public.transfer_provider_status;
DROP POLICY IF EXISTS "Admins can manage transfer task templates" ON public.transfer_task_templates;
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert overrides" ON public.workflow_overrides;
DROP POLICY IF EXISTS "Admins can read overrides" ON public.workflow_overrides;

-- Step 3: Drop dependent views and function
DROP VIEW IF EXISTS public.provider_directory_public;
DROP VIEW IF EXISTS public.physician_profiles;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role);

-- Step 4: Swap enum
ALTER TYPE public.app_role RENAME TO app_role_old;
CREATE TYPE public.app_role AS ENUM ('admin', 'provider', 'physician');
ALTER TABLE public.user_roles
  ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role;
DROP TYPE public.app_role_old;

-- Step 5: Recreate has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Step 6: Recreate views
CREATE VIEW public.physician_profiles AS
SELECT p.id, p.user_id, p.full_name, p.email, p.phone_number, p.npi_number,
    p.credentials, p.primary_specialty, p.avatar_url, p.employment_status, p.created_at,
    (SELECT count(DISTINCT ca.id) FROM collaborative_agreements ca
     WHERE ca.physician_id = p.id AND ca.workflow_status = 'active'::agreement_workflow_status) AS active_agreements_count,
    (SELECT count(DISTINCT ap.provider_id) FROM agreement_providers ap
     JOIN collaborative_agreements ca ON ca.id = ap.agreement_id
     WHERE ca.physician_id = p.id AND ap.is_active = true) AS supervised_providers_count,
    (SELECT array_agg(DISTINCT ca.state_abbreviation) FROM collaborative_agreements ca
     WHERE ca.physician_id = p.id AND ca.workflow_status = 'active'::agreement_workflow_status) AS active_states
FROM profiles p JOIN user_roles ur ON ur.user_id = p.user_id
WHERE ur.role = 'physician'::app_role;

CREATE VIEW public.provider_directory_public AS
SELECT id, user_id, email, full_name, first_name, last_name, preferred_name, credentials,
    profession, primary_specialty, npi_number, phone_number, avatar_url, employment_status,
    employment_type, agency_id, manages_own_renewals, pod_id, activation_status,
    actively_licensed_states, onboarding_completed, start_date_on_network, bio, languages,
    service_offerings, services_offered, patient_age_preference, min_patient_age,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN date_of_birth ELSE NULL::date END AS date_of_birth,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN birthday ELSE NULL::date END AS birthday,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN home_address ELSE NULL::text END AS home_address,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_line_1 ELSE NULL::text END AS address_line_1,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_line_2 ELSE NULL::text END AS address_line_2,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_city ELSE NULL::text END AS address_city,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN address_state ELSE NULL::text END AS address_state,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN postal_code ELSE NULL::text END AS postal_code,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN personal_email ELSE NULL::text END AS personal_email,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN emergency_contact_name ELSE NULL::text END AS emergency_contact_name,
    CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN emergency_contact_phone ELSE NULL::text END AS emergency_contact_phone,
    created_at, updated_at
FROM profiles;

-- Step 7: Recreate all policies (without leadership, merged into admin)
CREATE POLICY "Admins can manage agencies" ON public.agencies FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can view audit logs" ON public.agreement_audit_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all tasks" ON public.agreement_tasks FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all transfers" ON public.agreement_transfers FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete calendar events" ON public.calendar_events FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert calendar events" ON public.calendar_events FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update calendar events" ON public.calendar_events FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can view compliance log" ON public.compliance_status_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all activation events" ON public.ehr_activation_events FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage enhancements" ON public.enhancement_registry FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert event activity" ON public.event_activity_log FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can view event activity" ON public.event_activity_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert attestations" ON public.event_attestations FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Providers can update own attestations" ON public.event_attestations FOR UPDATE TO authenticated
  USING ((EXISTS (SELECT 1 FROM profiles p WHERE p.id = event_attestations.provider_id AND p.user_id = auth.uid())) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Providers can view own attestations" ON public.event_attestations FOR SELECT TO authenticated
  USING ((EXISTS (SELECT 1 FROM profiles p WHERE p.id = event_attestations.provider_id AND p.user_id = auth.uid())) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all KB articles" ON public.kb_articles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view published articles matching their roles" ON public.kb_articles FOR SELECT TO authenticated
  USING (published = true AND (
    'provider'::text = ANY(visibility_roles)
    OR (has_role(auth.uid(), 'admin'::app_role) AND 'admin'::text = ANY(visibility_roles))
    OR (has_role(auth.uid(), 'physician'::app_role) AND 'physician'::text = ANY(visibility_roles))
  ));

CREATE POLICY "Admins can manage KB categories" ON public.kb_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage milestone audit log" ON public.milestone_audit_log FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all milestone tasks" ON public.milestone_tasks FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage pods" ON public.pods FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all applications" ON public.provider_license_applications FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all licenses" ON public.provider_licenses FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins and physicians can manage compliance" ON public.provider_meeting_compliance FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'physician'::app_role));

CREATE POLICY "Admins can manage collab decisions" ON public.provider_state_collab_decisions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all provider state status" ON public.provider_state_status FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Providers can update draft reimbursements" ON public.reimbursement_requests FOR UPDATE TO authenticated
  USING ((provider_id = (SELECT profiles.id FROM profiles WHERE profiles.user_id = auth.uid()) AND status = 'draft'::text) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Providers can view own reimbursements" ON public.reimbursement_requests FOR SELECT TO authenticated
  USING (provider_id = (SELECT profiles.id FROM profiles WHERE profiles.user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can view sensitive data log" ON public.sensitive_data_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage state compliance requirements" ON public.state_compliance_requirements FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage config" ON public.system_config FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage transfer activity log" ON public.transfer_activity_log FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage transfer provider status" ON public.transfer_provider_status FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage transfer task templates" ON public.transfer_task_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can view all user roles" ON public.user_roles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert overrides" ON public.workflow_overrides FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can read overrides" ON public.workflow_overrides FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
