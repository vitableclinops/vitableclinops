-- Add blocked status and evidence fields to agreement_tasks
ALTER TABLE public.agreement_tasks 
ADD COLUMN IF NOT EXISTS blocked_reason text,
ADD COLUMN IF NOT EXISTS blocked_until date,
ADD COLUMN IF NOT EXISTS escalated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
ADD COLUMN IF NOT EXISTS escalated_by uuid;

-- Add effective date fields to agreement_transfers
ALTER TABLE public.agreement_transfers
ADD COLUMN IF NOT EXISTS termination_effective_date date,
ADD COLUMN IF NOT EXISTS initiation_effective_date date;

-- Create task templates table for reusable checklists
CREATE TABLE IF NOT EXISTS public.transfer_task_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  state_abbreviation text, -- null = global template
  phase text NOT NULL CHECK (phase IN ('termination', 'initiation')),
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on templates
ALTER TABLE public.transfer_task_templates ENABLE ROW LEVEL SECURITY;

-- Admins can manage templates
CREATE POLICY "Admins can manage transfer task templates"
ON public.transfer_task_templates FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Anyone authenticated can view templates
CREATE POLICY "Authenticated users can view templates"
ON public.transfer_task_templates FOR SELECT TO authenticated
USING (true);

-- Create provider tracking within transfers (per-provider status)
CREATE TABLE IF NOT EXISTS public.transfer_provider_status (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id uuid NOT NULL REFERENCES public.agreement_transfers(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  provider_name text NOT NULL,
  provider_email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed')),
  blocked_reason text,
  blocked_until date,
  escalated boolean DEFAULT false,
  escalated_at timestamptz,
  last_activity_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transfer_id, provider_id)
);

-- Enable RLS
ALTER TABLE public.transfer_provider_status ENABLE ROW LEVEL SECURITY;

-- Admins can manage provider status
CREATE POLICY "Admins can manage transfer provider status"
ON public.transfer_provider_status FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Providers can view their own status
CREATE POLICY "Providers can view their transfer status"
ON public.transfer_provider_status FOR SELECT TO authenticated
USING (
  provider_id IN (
    SELECT id FROM profiles WHERE user_id = auth.uid()
  )
);

-- Add provider_id to agreement_tasks for per-provider tracking
ALTER TABLE public.agreement_tasks
ADD COLUMN IF NOT EXISTS transfer_provider_id uuid REFERENCES public.transfer_provider_status(id) ON DELETE SET NULL;

-- Create index for efficient task queue queries
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_assigned_to ON public.agreement_tasks(assigned_to) WHERE status != 'completed';
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_due_date ON public.agreement_tasks(due_date) WHERE status != 'completed';
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_escalated ON public.agreement_tasks(escalated) WHERE escalated = true;
CREATE INDEX IF NOT EXISTS idx_transfer_provider_status_transfer ON public.transfer_provider_status(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_provider_status_provider ON public.transfer_provider_status(provider_id);