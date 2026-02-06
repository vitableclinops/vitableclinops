-- Create enums for readiness and activation statuses
CREATE TYPE readiness_status AS ENUM ('not_ready', 'ready', 'at_risk', 'blocked');
CREATE TYPE ehr_activation_status AS ENUM ('inactive', 'activation_requested', 'active', 'deactivation_requested', 'deactivated');
CREATE TYPE mismatch_type AS ENUM ('active_but_not_ready', 'ready_but_inactive', 'expired_license_but_active', 'expired_collab_but_active', 'none');

-- Create provider_state_status table (one row per provider-state)
CREATE TABLE public.provider_state_status (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id UUID NOT NULL,
  state_abbreviation TEXT NOT NULL,
  
  -- Readiness (computed/stored)
  readiness_status readiness_status NOT NULL DEFAULT 'not_ready',
  readiness_reason TEXT,
  readiness_last_evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- EHR Activation (manual workflow)
  ehr_activation_status ehr_activation_status NOT NULL DEFAULT 'inactive',
  ehr_activated_at TIMESTAMP WITH TIME ZONE,
  ehr_activated_by UUID,
  ehr_deactivated_at TIMESTAMP WITH TIME ZONE,
  ehr_deactivated_by UUID,
  
  -- Effective dates (for scheduled activations)
  activation_effective_date DATE,
  deactivation_effective_date DATE,
  activation_notes TEXT,
  
  -- Overrides / exceptions
  readiness_override BOOLEAN DEFAULT false,
  override_reason TEXT,
  override_expires_at DATE,
  
  -- Mismatch detection
  mismatch_type mismatch_type DEFAULT 'none',
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Unique constraint per provider-state
  UNIQUE(provider_id, state_abbreviation)
);

-- Create ehr_activation_events table (audit trail)
CREATE TABLE public.ehr_activation_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id UUID NOT NULL,
  state_abbreviation TEXT NOT NULL,
  
  event_type TEXT NOT NULL, -- requested_activation, activated, requested_deactivation, deactivated, override_readiness
  previous_status TEXT,
  new_status TEXT,
  
  actor_id UUID,
  actor_name TEXT,
  notes TEXT,
  evidence_link TEXT, -- optional ticket/screenshot link
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.provider_state_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ehr_activation_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for provider_state_status
CREATE POLICY "Admins can manage all provider state status"
ON public.provider_state_status
FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Providers can view their own state status"
ON public.provider_state_status
FOR SELECT
USING (provider_id IN (
  SELECT id FROM profiles WHERE user_id = auth.uid()
));

CREATE POLICY "Leadership can view all provider state status"
ON public.provider_state_status
FOR SELECT
USING (has_role(auth.uid(), 'leadership'));

-- RLS policies for ehr_activation_events
CREATE POLICY "Admins can manage all activation events"
ON public.ehr_activation_events
FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Providers can view their own activation events"
ON public.ehr_activation_events
FOR SELECT
USING (provider_id IN (
  SELECT id FROM profiles WHERE user_id = auth.uid()
));

CREATE POLICY "Leadership can view all activation events"
ON public.ehr_activation_events
FOR SELECT
USING (has_role(auth.uid(), 'leadership'));

-- Add trigger for updated_at on provider_state_status
CREATE TRIGGER update_provider_state_status_updated_at
BEFORE UPDATE ON public.provider_state_status
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_provider_state_status_provider ON public.provider_state_status(provider_id);
CREATE INDEX idx_provider_state_status_state ON public.provider_state_status(state_abbreviation);
CREATE INDEX idx_provider_state_status_mismatch ON public.provider_state_status(mismatch_type) WHERE mismatch_type != 'none';
CREATE INDEX idx_provider_state_status_activation ON public.provider_state_status(ehr_activation_status);
CREATE INDEX idx_ehr_activation_events_provider ON public.ehr_activation_events(provider_id);
CREATE INDEX idx_ehr_activation_events_state ON public.ehr_activation_events(state_abbreviation);