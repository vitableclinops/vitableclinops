-- Add onboarding tracking fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS bio text,
ADD COLUMN IF NOT EXISTS activation_status text DEFAULT 'pending_onboarding';

-- Add index for quick lookup of incomplete onboarding
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_completed 
ON public.profiles (onboarding_completed) 
WHERE onboarding_completed = false;

-- Add comment for clarity
COMMENT ON COLUMN public.profiles.onboarding_completed IS 'Whether the provider has completed the initial onboarding wizard';
COMMENT ON COLUMN public.profiles.activation_status IS 'Current activation readiness: pending_onboarding, pending_licenses, pending_agreements, ready, active';