-- =====================================================
-- AGREEMENT TASKS TABLE
-- Centralized task system for agreement lifecycle management
-- =====================================================

-- Task category enum
CREATE TYPE public.agreement_task_category AS ENUM (
  'agreement_creation',
  'signature',
  'supervision_meeting',
  'chart_review',
  'renewal',
  'termination',
  'compliance',
  'document',
  'custom'
);

-- Task status enum
CREATE TYPE public.agreement_task_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'blocked',
  'cancelled'
);

-- Create agreement_tasks table
CREATE TABLE public.agreement_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Relationships
  agreement_id UUID REFERENCES public.collaborative_agreements(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  physician_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  meeting_id UUID REFERENCES public.supervision_meetings(id) ON DELETE SET NULL,
  
  -- Core task fields
  title TEXT NOT NULL,
  description TEXT,
  category agreement_task_category NOT NULL DEFAULT 'custom',
  status agreement_task_status NOT NULL DEFAULT 'pending',
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  
  -- Assignment
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_role TEXT CHECK (assigned_role IN ('admin', 'provider', 'physician')) DEFAULT 'admin',
  
  -- Dates
  due_date DATE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  -- Auto-generation tracking
  is_auto_generated BOOLEAN DEFAULT false,
  auto_trigger TEXT, -- e.g., 'agreement_creation', 'renewal_due', 'meeting_scheduled'
  
  -- State context
  state_abbreviation TEXT,
  state_name TEXT,
  
  -- Additional data
  notes TEXT,
  blockers TEXT,
  external_url TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.agreement_tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage all tasks"
  ON public.agreement_tasks
  FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Providers can view their assigned tasks"
  ON public.agreement_tasks
  FOR SELECT
  USING (
    assigned_to IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Physicians can view their tasks"
  ON public.agreement_tasks
  FOR SELECT
  USING (
    assigned_to IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    OR physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- Indexes
CREATE INDEX idx_agreement_tasks_agreement_id ON public.agreement_tasks(agreement_id);
CREATE INDEX idx_agreement_tasks_provider_id ON public.agreement_tasks(provider_id);
CREATE INDEX idx_agreement_tasks_status ON public.agreement_tasks(status);
CREATE INDEX idx_agreement_tasks_due_date ON public.agreement_tasks(due_date);
CREATE INDEX idx_agreement_tasks_assigned_to ON public.agreement_tasks(assigned_to);

-- Trigger for updated_at
CREATE TRIGGER update_agreement_tasks_updated_at
  BEFORE UPDATE ON public.agreement_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- AUDIT LOG TABLE
-- Track all changes to agreements and related entities
-- =====================================================

CREATE TABLE public.agreement_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Entity reference
  entity_type TEXT NOT NULL CHECK (entity_type IN ('agreement', 'task', 'meeting', 'provider', 'document')),
  entity_id UUID NOT NULL,
  
  -- Action details
  action TEXT NOT NULL, -- e.g., 'created', 'updated', 'terminated', 'signed'
  changes JSONB, -- Store before/after values
  
  -- Actor
  performed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_by_name TEXT,
  performed_by_role TEXT,
  
  -- Context
  ip_address TEXT,
  user_agent TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agreement_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies (admin only)
CREATE POLICY "Admins can view audit logs"
  ON public.agreement_audit_log
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert audit logs"
  ON public.agreement_audit_log
  FOR INSERT
  WITH CHECK (true);

-- Index for querying by entity
CREATE INDEX idx_audit_log_entity ON public.agreement_audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON public.agreement_audit_log(created_at DESC);

-- =====================================================
-- PHYSICIAN PROFILES VIEW
-- Easy access to physician-specific profile data
-- =====================================================

CREATE OR REPLACE VIEW public.physician_profiles AS
SELECT 
  p.id,
  p.user_id,
  p.full_name,
  p.email,
  p.phone_number,
  p.npi_number,
  p.credentials,
  p.primary_specialty,
  p.avatar_url,
  p.employment_status,
  p.created_at,
  (
    SELECT COUNT(DISTINCT ca.id) 
    FROM collaborative_agreements ca 
    WHERE ca.physician_id = p.id 
    AND ca.workflow_status = 'active'
  ) as active_agreements_count,
  (
    SELECT COUNT(DISTINCT ap.provider_id) 
    FROM agreement_providers ap 
    JOIN collaborative_agreements ca ON ca.id = ap.agreement_id
    WHERE ca.physician_id = p.id 
    AND ap.is_active = true
  ) as supervised_providers_count,
  (
    SELECT array_agg(DISTINCT ca.state_abbreviation)
    FROM collaborative_agreements ca 
    WHERE ca.physician_id = p.id 
    AND ca.workflow_status = 'active'
  ) as active_states
FROM profiles p
JOIN user_roles ur ON ur.user_id = p.user_id
WHERE ur.role = 'physician';

-- =====================================================
-- AGREEMENT SUMMARY VIEW
-- Combined view for easier querying
-- =====================================================

CREATE OR REPLACE VIEW public.agreement_summary AS
SELECT 
  ca.id,
  ca.state_abbreviation,
  ca.state_name,
  ca.physician_id,
  ca.physician_name,
  ca.physician_email,
  ca.workflow_status,
  ca.start_date,
  ca.end_date,
  ca.meeting_cadence,
  ca.chart_review_required,
  ca.chart_review_frequency,
  ca.next_renewal_date,
  ca.terminated_at,
  ca.termination_reason,
  ca.created_at,
  -- Provider count
  (SELECT COUNT(*) FROM agreement_providers ap WHERE ap.agreement_id = ca.id AND ap.is_active = true) as active_provider_count,
  -- Has pending tasks
  (SELECT COUNT(*) FROM agreement_tasks at WHERE at.agreement_id = ca.id AND at.status IN ('pending', 'in_progress')) as pending_task_count,
  -- Next meeting
  (SELECT MIN(sm.scheduled_date) FROM supervision_meetings sm WHERE sm.agreement_id = ca.id AND sm.scheduled_date > now() AND sm.status = 'scheduled') as next_meeting_date,
  -- State compliance info
  scr.ca_required,
  scr.ca_meeting_cadence,
  scr.fpa_status,
  scr.meeting_months
FROM collaborative_agreements ca
LEFT JOIN state_compliance_requirements scr ON scr.state_abbreviation = ca.state_abbreviation;