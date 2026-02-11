-- Add a numeric column for enforceable NP:MD ratio limits
-- NULL means no limit in that state
ALTER TABLE public.state_compliance_requirements 
ADD COLUMN np_md_ratio_limit integer DEFAULT NULL;

-- Add a comment for clarity
COMMENT ON COLUMN public.state_compliance_requirements.np_md_ratio_limit IS 'Maximum number of NPs a single physician can supervise in this state. NULL = no limit.';
