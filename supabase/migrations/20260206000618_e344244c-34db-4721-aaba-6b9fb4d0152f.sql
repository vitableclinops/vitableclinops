-- Make physician_name and physician_email nullable on collaborative_agreements
-- This allows pending assignments to have NULL values instead of fake placeholders
ALTER TABLE public.collaborative_agreements 
  ALTER COLUMN physician_name DROP NOT NULL,
  ALTER COLUMN physician_email DROP NOT NULL;