
-- Add new columns to profiles table for extended provider data
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS birthday DATE,
ADD COLUMN IF NOT EXISTS home_address TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
ADD COLUMN IF NOT EXISTS preferred_name TEXT,
ADD COLUMN IF NOT EXISTS patient_age_preference TEXT,
ADD COLUMN IF NOT EXISTS service_offerings TEXT,
ADD COLUMN IF NOT EXISTS employment_start_date DATE,
ADD COLUMN IF NOT EXISTS employment_end_date DATE,
ADD COLUMN IF NOT EXISTS employment_status TEXT DEFAULT 'active';

-- Create a view for the limited provider directory (what providers see of each other)
-- Excludes PII like birthday, home address, emergency contact
CREATE OR REPLACE VIEW public.provider_directory_public
WITH (security_invoker=on) AS
SELECT 
  p.id,
  p.full_name,
  p.preferred_name,
  p.npi_number,
  p.credentials,
  p.avatar_url,
  p.employment_status,
  string_agg(DISTINCT ca.state_name, ', ' ORDER BY ca.state_name) as states
FROM public.profiles p
LEFT JOIN public.collaborative_agreements ca ON ca.physician_id = p.user_id OR ca.state_id IN (
  SELECT state_id FROM public.collaborative_agreements WHERE physician_name = p.full_name
)
WHERE p.employment_status = 'active'
GROUP BY p.id, p.full_name, p.preferred_name, p.npi_number, p.credentials, p.avatar_url, p.employment_status;

-- Update RLS policies on profiles to enforce access control
-- Drop existing policy that allows users to view their own profile
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Recreate with more restrictive policy
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = user_id);

-- Policy for admins to view all profiles (already exists but keeping explicit)
-- DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
-- CREATE POLICY "Admins can view all profiles"
-- ON public.profiles FOR SELECT
-- USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Add update policy for admins to update any profile
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile"
ON public.profiles FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::app_role));
