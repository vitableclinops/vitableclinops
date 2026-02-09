
-- Drop existing view first
DROP VIEW IF EXISTS public.provider_directory_public;

-- =============================================
-- 1. AGENCIES TABLE (may already exist from partial run)
-- =============================================
CREATE TABLE IF NOT EXISTS public.agencies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agencies' AND policyname = 'Admins can manage agencies') THEN
    CREATE POLICY "Admins can manage agencies" ON public.agencies FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agencies' AND policyname = 'Authenticated users can view agencies') THEN
    CREATE POLICY "Authenticated users can view agencies" ON public.agencies FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_agencies_updated_at ON public.agencies;
CREATE TRIGGER update_agencies_updated_at BEFORE UPDATE ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 2. ADD EMPLOYMENT TYPE + AGENCY TO PROFILES
-- =============================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'w2',
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.agencies(id),
  ADD COLUMN IF NOT EXISTS manages_own_renewals BOOLEAN DEFAULT false;

-- Add check constraint separately to avoid issues
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_employment_type_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_employment_type_check
      CHECK (employment_type IN ('w2', 'agency', '1099'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_agency ON public.profiles(agency_id);
CREATE INDEX IF NOT EXISTS idx_profiles_employment_type ON public.profiles(employment_type);

-- =============================================
-- 3. REIMBURSEMENT REQUESTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS public.reimbursement_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES public.profiles(id),
  provider_name TEXT NOT NULL,
  state_abbreviation TEXT NOT NULL,
  license_application_id UUID REFERENCES public.provider_license_applications(id),
  application_fee_amount NUMERIC(10,2),
  application_fee_receipt_url TEXT,
  admin_hours_spent NUMERIC(5,2),
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 50.00,
  admin_time_total NUMERIC(10,2) GENERATED ALWAYS AS (COALESCE(admin_hours_spent, 0) * hourly_rate) STORED,
  total_reimbursement NUMERIC(10,2) GENERATED ALWAYS AS (
    COALESCE(application_fee_amount, 0) + (COALESCE(admin_hours_spent, 0) * hourly_rate)
  ) STORED,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'processed')),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES public.profiles(id),
  description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reimbursement_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reimbursement_requests' AND policyname = 'Providers can view own reimbursements') THEN
    CREATE POLICY "Providers can view own reimbursements" ON public.reimbursement_requests
      FOR SELECT TO authenticated
      USING (provider_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reimbursement_requests' AND policyname = 'Providers can create own reimbursements') THEN
    CREATE POLICY "Providers can create own reimbursements" ON public.reimbursement_requests
      FOR INSERT TO authenticated
      WITH CHECK (provider_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reimbursement_requests' AND policyname = 'Providers can update draft reimbursements') THEN
    CREATE POLICY "Providers can update draft reimbursements" ON public.reimbursement_requests
      FOR UPDATE TO authenticated
      USING ((provider_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid()) AND status = 'draft') OR public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reimbursements_provider ON public.reimbursement_requests(provider_id);
CREATE INDEX IF NOT EXISTS idx_reimbursements_status ON public.reimbursement_requests(status);

DROP TRIGGER IF EXISTS update_reimbursements_updated_at ON public.reimbursement_requests;
CREATE TRIGGER update_reimbursements_updated_at BEFORE UPDATE ON public.reimbursement_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 4. PII-MASKED VIEW
-- =============================================
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
  actively_licensed_states,
  onboarding_completed,
  start_date_on_network,
  bio,
  languages,
  service_offerings,
  services_offered,
  patient_age_preference,
  min_patient_age,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN date_of_birth ELSE NULL END AS date_of_birth,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN birthday ELSE NULL END AS birthday,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN home_address ELSE NULL END AS home_address,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN address_line_1 ELSE NULL END AS address_line_1,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN address_line_2 ELSE NULL END AS address_line_2,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN address_city ELSE NULL END AS address_city,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN address_state ELSE NULL END AS address_state,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN postal_code ELSE NULL END AS postal_code,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN personal_email ELSE NULL END AS personal_email,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN emergency_contact_name ELSE NULL END AS emergency_contact_name,
  CASE WHEN public.has_role(auth.uid(), 'admin') THEN emergency_contact_phone ELSE NULL END AS emergency_contact_phone,
  created_at,
  updated_at
FROM public.profiles;
