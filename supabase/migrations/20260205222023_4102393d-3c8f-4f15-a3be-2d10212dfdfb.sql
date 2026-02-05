-- Create state_compliance_requirements table
CREATE TABLE IF NOT EXISTS public.state_compliance_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation text NOT NULL UNIQUE,
  state_name text NOT NULL,
  ca_meeting_cadence text,
  ca_required boolean,
  rxr_required boolean,
  nlc boolean,
  np_md_ratio text,
  licenses text,
  fpa_status text,
  knowledge_base_url text,
  steps_to_confirm_eligibility text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.state_compliance_requirements ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view state compliance requirements"
  ON public.state_compliance_requirements
  FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage state compliance requirements"
  ON public.state_compliance_requirements
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_state_compliance_requirements_updated_at
  BEFORE UPDATE ON public.state_compliance_requirements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();