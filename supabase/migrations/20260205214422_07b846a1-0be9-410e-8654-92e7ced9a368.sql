
-- Add medallion_document_url column to agreement_providers table
ALTER TABLE agreement_providers 
ADD COLUMN IF NOT EXISTS medallion_document_url text;

-- Add start_date column for effective dates
ALTER TABLE agreement_providers 
ADD COLUMN IF NOT EXISTS start_date date;
