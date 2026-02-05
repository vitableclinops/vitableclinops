-- Add missing columns to profiles table for Notion import
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS collaborative_physician TEXT,
ADD COLUMN IF NOT EXISTS min_patient_age TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS personal_email TEXT,
ADD COLUMN IF NOT EXISTS languages TEXT,
ADD COLUMN IF NOT EXISTS services_offered TEXT;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';