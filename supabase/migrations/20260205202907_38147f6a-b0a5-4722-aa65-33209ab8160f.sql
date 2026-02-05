-- Create provider_licenses table to store per-state license data
CREATE TABLE public.provider_licenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_email TEXT, -- backup reference if profile not linked
  state_abbreviation TEXT NOT NULL,
  license_number TEXT,
  license_type TEXT, -- 'RN', 'NP', 'APRN', etc.
  status TEXT DEFAULT 'active', -- 'active', 'inactive', 'pending', 'expired'
  issue_date DATE,
  expiration_date DATE,
  requires_collab_agreement BOOLEAN DEFAULT false,
  collab_agreement_id UUID, -- reference to collaborative_agreements if applicable
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for common lookups
CREATE INDEX idx_provider_licenses_profile ON public.provider_licenses(profile_id);
CREATE INDEX idx_provider_licenses_state ON public.provider_licenses(state_abbreviation);
CREATE INDEX idx_provider_licenses_email ON public.provider_licenses(provider_email);
CREATE INDEX idx_provider_licenses_expiration ON public.provider_licenses(expiration_date);

-- Enable RLS
ALTER TABLE public.provider_licenses ENABLE ROW LEVEL SECURITY;

-- Admins can manage all licenses
CREATE POLICY "Admins can manage all licenses"
ON public.provider_licenses
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can view their own licenses
CREATE POLICY "Users can view their own licenses"
ON public.provider_licenses
FOR SELECT
USING (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_provider_licenses_updated_at
BEFORE UPDATE ON public.provider_licenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update provider_directory_public view to include license states aggregation
DROP VIEW IF EXISTS public.provider_directory_public;
CREATE VIEW public.provider_directory_public AS
SELECT 
  p.id,
  p.full_name,
  p.preferred_name,
  p.credentials,
  p.npi_number,
  p.avatar_url,
  p.employment_status,
  (
    SELECT string_agg(DISTINCT pl.state_abbreviation, ', ' ORDER BY pl.state_abbreviation)
    FROM public.provider_licenses pl 
    WHERE pl.profile_id = p.id AND pl.status = 'active'
  ) as states
FROM public.profiles p
WHERE p.employment_status = 'active' OR p.employment_status IS NULL;