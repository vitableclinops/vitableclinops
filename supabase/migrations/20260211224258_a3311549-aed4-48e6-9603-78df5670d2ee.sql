-- Change rxr_required from boolean to text to support descriptive values
ALTER TABLE public.state_compliance_requirements 
  ALTER COLUMN rxr_required TYPE text USING CASE WHEN rxr_required THEN 'Yes' ELSE 'No' END;

-- Also drop the collab_requirement_type enum we added earlier since we're merging TTP into conditional
-- and the frontend constants handle this logic
