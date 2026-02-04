-- Collaborative Agreement Workflow Status Enum
CREATE TYPE public.agreement_workflow_status AS ENUM (
  'draft',
  'pending_signatures',
  'awaiting_physician_signature',
  'awaiting_provider_signatures',
  'fully_executed',
  'active',
  'pending_renewal',
  'termination_initiated',
  'terminated'
);

-- Email Notification Type Enum
CREATE TYPE public.notification_type AS ENUM (
  'agreement_initiated',
  'signature_requested',
  'signature_reminder',
  'agreement_executed',
  'meeting_scheduled',
  'termination_initiated',
  'termination_complete'
);

-- Collaborative Agreements Table
CREATE TABLE public.collaborative_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id TEXT NOT NULL,
  state_name TEXT NOT NULL,
  state_abbreviation TEXT NOT NULL,
  
  -- Physician info
  physician_id UUID,
  physician_name TEXT NOT NULL,
  physician_email TEXT NOT NULL,
  physician_npi TEXT,
  
  -- Agreement details
  workflow_status agreement_workflow_status NOT NULL DEFAULT 'draft',
  start_date DATE,
  end_date DATE,
  renewal_cadence TEXT DEFAULT 'annual',
  next_renewal_date DATE,
  
  -- Meeting requirements
  meeting_cadence TEXT DEFAULT 'monthly',
  chart_review_required BOOLEAN DEFAULT false,
  chart_review_frequency TEXT,
  
  -- E-signature tracking
  box_sign_request_id TEXT,
  box_sign_status TEXT,
  physician_signed_at TIMESTAMPTZ,
  
  -- Document storage
  agreement_document_url TEXT,
  termination_document_url TEXT,
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminated_at TIMESTAMPTZ,
  terminated_by UUID,
  termination_reason TEXT
);

-- Agreement Providers Junction Table (many providers per agreement)
CREATE TABLE public.agreement_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID REFERENCES public.collaborative_agreements(id) ON DELETE CASCADE NOT NULL,
  provider_id UUID,
  provider_name TEXT NOT NULL,
  provider_email TEXT NOT NULL,
  provider_npi TEXT,
  
  -- Signature tracking
  signature_status TEXT DEFAULT 'pending',
  signed_at TIMESTAMPTZ,
  box_sign_signer_id TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  removed_at TIMESTAMPTZ,
  removed_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agreement Workflow Steps Table (tracks progress)
CREATE TABLE public.agreement_workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID REFERENCES public.collaborative_agreements(id) ON DELETE CASCADE NOT NULL,
  step_number INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  step_description TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, skipped
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email Notifications Log
CREATE TABLE public.agreement_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID REFERENCES public.collaborative_agreements(id) ON DELETE CASCADE NOT NULL,
  notification_type notification_type NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  delivered BOOLEAN DEFAULT false,
  error_message TEXT,
  resend_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supervision Meetings Table
CREATE TABLE public.supervision_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID REFERENCES public.collaborative_agreements(id) ON DELETE CASCADE NOT NULL,
  scheduled_date TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  meeting_type TEXT DEFAULT 'collaborative_meeting',
  status TEXT DEFAULT 'scheduled', -- scheduled, completed, cancelled, missed
  location TEXT,
  video_link TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.collaborative_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervision_meetings ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allowing authenticated users to manage agreements for now)
CREATE POLICY "Authenticated users can view agreements"
  ON public.collaborative_agreements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create agreements"
  ON public.collaborative_agreements FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update agreements"
  ON public.collaborative_agreements FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view agreement providers"
  ON public.agreement_providers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage agreement providers"
  ON public.agreement_providers FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view workflow steps"
  ON public.agreement_workflow_steps FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage workflow steps"
  ON public.agreement_workflow_steps FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view notifications"
  ON public.agreement_notifications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create notifications"
  ON public.agreement_notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view meetings"
  ON public.supervision_meetings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage meetings"
  ON public.supervision_meetings FOR ALL
  TO authenticated
  USING (true);

-- Indexes for performance
CREATE INDEX idx_agreements_workflow_status ON public.collaborative_agreements(workflow_status);
CREATE INDEX idx_agreements_state ON public.collaborative_agreements(state_abbreviation);
CREATE INDEX idx_agreement_providers_agreement ON public.agreement_providers(agreement_id);
CREATE INDEX idx_workflow_steps_agreement ON public.agreement_workflow_steps(agreement_id);
CREATE INDEX idx_notifications_agreement ON public.agreement_notifications(agreement_id);
CREATE INDEX idx_meetings_agreement ON public.supervision_meetings(agreement_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_collaborative_agreements_updated_at
  BEFORE UPDATE ON public.collaborative_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();