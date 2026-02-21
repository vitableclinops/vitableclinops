-- Add fee discrepancy tracking to licensure steps
ALTER TABLE public.licensure_application_steps
ADD COLUMN fee_discrepancy jsonb;

-- Example structure:
-- { "original_amount": 49, "actual_amount": 55, "confirmed_match": false, "confirmed_at": "...", "admin_reviewed": false }

COMMENT ON COLUMN public.licensure_application_steps.fee_discrepancy IS 'Stores fee confirmation data: original_amount, actual_amount, confirmed_match, confirmed_at, admin_reviewed';