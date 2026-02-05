-- Add chart review link to profiles
ALTER TABLE public.profiles
ADD COLUMN chart_review_folder_url text;

-- Add chart review link per agreement
ALTER TABLE public.agreement_providers
ADD COLUMN chart_review_url text;

-- Add meeting months to state compliance (which months require meetings: 1-12)
ALTER TABLE public.state_compliance_requirements
ADD COLUMN meeting_months integer[] DEFAULT ARRAY[]::integer[];

-- Track meeting compliance per provider
CREATE TABLE public.provider_meeting_compliance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.supervision_meetings(id) ON DELETE CASCADE,
  state_abbreviation text NOT NULL,
  meeting_month date NOT NULL,
  required boolean NOT NULL DEFAULT true,
  attended boolean DEFAULT false,
  attended_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(provider_id, meeting_id, state_abbreviation)
);

-- Enable RLS
ALTER TABLE public.provider_meeting_compliance ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins and physicians can manage compliance"
ON public.provider_meeting_compliance
FOR ALL
USING (
  has_role(auth.uid(), 'admin') OR 
  has_role(auth.uid(), 'physician')
);

CREATE POLICY "Providers can view their own compliance"
ON public.provider_meeting_compliance
FOR SELECT
USING (
  provider_id IN (
    SELECT id FROM profiles WHERE user_id = auth.uid()
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_provider_meeting_compliance_updated_at
BEFORE UPDATE ON public.provider_meeting_compliance
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();