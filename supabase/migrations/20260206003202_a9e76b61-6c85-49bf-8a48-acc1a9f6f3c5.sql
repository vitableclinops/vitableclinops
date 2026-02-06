-- Create enum for collaboration requirement type
CREATE TYPE public.collab_requirement_type AS ENUM ('never', 'always', 'conditional');

-- Add new columns to state_compliance_requirements for tri-state collab logic
ALTER TABLE public.state_compliance_requirements 
ADD COLUMN IF NOT EXISTS collab_requirement_type public.collab_requirement_type DEFAULT 'never',
ADD COLUMN IF NOT EXISTS fpa_requirements_summary TEXT,
ADD COLUMN IF NOT EXISTS collab_notes TEXT,
ADD COLUMN IF NOT EXISTS independent_practice_requirements TEXT,
ADD COLUMN IF NOT EXISTS np_prohibited BOOLEAN DEFAULT FALSE;

-- Create table for pending license applications (aspirational, not yet verified)
CREATE TABLE IF NOT EXISTS public.provider_license_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  state_abbreviation TEXT NOT NULL,
  application_submitted_date DATE,
  expected_approval_date DATE,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(profile_id, state_abbreviation)
);

-- Enable RLS
ALTER TABLE public.provider_license_applications ENABLE ROW LEVEL SECURITY;

-- Policies for provider_license_applications
CREATE POLICY "Providers can view their own applications"
ON public.provider_license_applications FOR SELECT
USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Providers can insert their own applications"
ON public.provider_license_applications FOR INSERT
WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Providers can update their own applications"
ON public.provider_license_applications FOR UPDATE
USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage all applications"
ON public.provider_license_applications FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Create trigger for updated_at
CREATE TRIGGER update_provider_license_applications_updated_at
BEFORE UPDATE ON public.provider_license_applications
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create table for conditional collab decisions (admin approvals)
CREATE TABLE IF NOT EXISTS public.provider_state_collab_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  state_abbreviation TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('requires_collab', 'no_collab_required', 'pending_review')),
  decided_by UUID REFERENCES public.profiles(id),
  decided_at TIMESTAMP WITH TIME ZONE,
  decision_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(profile_id, state_abbreviation)
);

-- Enable RLS
ALTER TABLE public.provider_state_collab_decisions ENABLE ROW LEVEL SECURITY;

-- Policies for provider_state_collab_decisions
CREATE POLICY "Anyone can read collab decisions"
ON public.provider_state_collab_decisions FOR SELECT
USING (true);

CREATE POLICY "Admins can manage collab decisions"
ON public.provider_state_collab_decisions FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Create trigger for updated_at
CREATE TRIGGER update_provider_state_collab_decisions_updated_at
BEFORE UPDATE ON public.provider_state_collab_decisions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update state_compliance_requirements with authoritative classifications
-- NEVER requires collaborative agreements
UPDATE public.state_compliance_requirements 
SET collab_requirement_type = 'never', np_prohibited = false
WHERE state_abbreviation IN ('AK', 'AZ', 'DC', 'DE', 'HI', 'IA', 'ID', 'KS', 'MI', 'MT', 'ND', 'NH', 'NM', 'NV', 'OR', 'RI', 'WA', 'WY');

-- ALWAYS requires collaborative agreements
UPDATE public.state_compliance_requirements 
SET collab_requirement_type = 'always', np_prohibited = false
WHERE state_abbreviation IN ('CA', 'NC', 'NJ', 'NY', 'OH', 'OK', 'PA', 'TX', 'WI', 'WV');

-- CONDITIONAL - requires FPA confirmation
UPDATE public.state_compliance_requirements 
SET collab_requirement_type = 'conditional', np_prohibited = false,
    fpa_requirements_summary = 'FPA eligibility must be confirmed before determining collaboration needs.'
WHERE state_abbreviation IN ('AR', 'CO', 'CT', 'FL', 'IL', 'KY', 'MA', 'MD', 'ME', 'MN', 'NE', 'SD', 'UT', 'VA', 'VT');

-- NP-PROHIBITED states
UPDATE public.state_compliance_requirements 
SET np_prohibited = true, collab_requirement_type = 'never'
WHERE state_abbreviation IN ('AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA');