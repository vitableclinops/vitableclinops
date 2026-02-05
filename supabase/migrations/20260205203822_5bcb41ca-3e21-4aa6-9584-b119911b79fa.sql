-- Add new columns to profiles table for comprehensive provider data
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS middle_name text,
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS profession text,
ADD COLUMN IF NOT EXISTS medallion_id text,
ADD COLUMN IF NOT EXISTS board_certificates text,
ADD COLUMN IF NOT EXISTS has_caqh_management boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_renew_licenses boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS practice_restrictions text,
ADD COLUMN IF NOT EXISTS has_collaborative_agreements boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS primary_specialty text,
ADD COLUMN IF NOT EXISTS secondary_contact_email text,
ADD COLUMN IF NOT EXISTS employment_offer_date date,
ADD COLUMN IF NOT EXISTS caqh_number text,
ADD COLUMN IF NOT EXISTS pronoun text,
ADD COLUMN IF NOT EXISTS address_line_1 text,
ADD COLUMN IF NOT EXISTS address_line_2 text,
ADD COLUMN IF NOT EXISTS address_city text,
ADD COLUMN IF NOT EXISTS address_state text,
ADD COLUMN IF NOT EXISTS postal_code text,
ADD COLUMN IF NOT EXISTS actively_licensed_states text;

-- Create index for common filter columns
CREATE INDEX IF NOT EXISTS idx_profiles_profession ON public.profiles(profession);
CREATE INDEX IF NOT EXISTS idx_profiles_primary_specialty ON public.profiles(primary_specialty);
CREATE INDEX IF NOT EXISTS idx_profiles_address_state ON public.profiles(address_state);

-- Update provider_directory_public view with new columns
DROP VIEW IF EXISTS public.provider_directory_public;

CREATE VIEW public.provider_directory_public
WITH (security_invoker=on) AS
SELECT 
  p.id,
  p.full_name,
  p.preferred_name,
  p.credentials,
  p.npi_number,
  p.avatar_url,
  p.employment_status,
  p.profession,
  p.primary_specialty,
  p.actively_licensed_states as states,
  p.address_state as home_state
FROM public.profiles p
WHERE p.employment_status = 'active' OR p.employment_status IS NULL;