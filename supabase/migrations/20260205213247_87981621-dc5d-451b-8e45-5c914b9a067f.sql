-- Add supervision_type column to collaborative_agreements for Primary/Backup tracking
ALTER TABLE public.collaborative_agreements 
ADD COLUMN IF NOT EXISTS supervision_type text DEFAULT 'primary';

-- Add medallion_document_url for storing the signed document URL from Medallion
ALTER TABLE public.collaborative_agreements 
ADD COLUMN IF NOT EXISTS medallion_document_url text;

-- Add medallion_provider_id to track the Medallion unique ID for sync
ALTER TABLE public.collaborative_agreements 
ADD COLUMN IF NOT EXISTS medallion_id text;

-- Add source tracking to know where the agreement came from
ALTER TABLE public.collaborative_agreements 
ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- Create indexes for better search/filtering performance
CREATE INDEX IF NOT EXISTS idx_ca_state_abbreviation ON public.collaborative_agreements(state_abbreviation);
CREATE INDEX IF NOT EXISTS idx_ca_physician_name ON public.collaborative_agreements(physician_name);
CREATE INDEX IF NOT EXISTS idx_ca_workflow_status ON public.collaborative_agreements(workflow_status);
CREATE INDEX IF NOT EXISTS idx_ca_supervision_type ON public.collaborative_agreements(supervision_type);

-- Add index on agreement_providers for faster lookups
CREATE INDEX IF NOT EXISTS idx_ap_provider_name ON public.agreement_providers(provider_name);