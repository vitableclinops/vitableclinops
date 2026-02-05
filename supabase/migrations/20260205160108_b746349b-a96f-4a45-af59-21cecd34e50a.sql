-- Add provider-specific fields to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS phone_number text,
ADD COLUMN IF NOT EXISTS npi_number text,
ADD COLUMN IF NOT EXISTS credentials text;