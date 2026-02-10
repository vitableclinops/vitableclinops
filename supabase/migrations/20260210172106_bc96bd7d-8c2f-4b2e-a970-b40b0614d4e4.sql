
-- Add workflow readiness columns to agreement_transfers
ALTER TABLE public.agreement_transfers 
  ADD COLUMN IF NOT EXISTS readiness_status text NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS blocking_reasons jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS readiness_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_override boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_override_reason text,
  ADD COLUMN IF NOT EXISTS admin_override_by text,
  ADD COLUMN IF NOT EXISTS admin_override_at timestamptz;

-- Add workflow readiness columns to collaborative_agreements
ALTER TABLE public.collaborative_agreements
  ADD COLUMN IF NOT EXISTS readiness_status text NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS blocking_reasons jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS readiness_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_override boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_override_reason text,
  ADD COLUMN IF NOT EXISTS admin_override_by text,
  ADD COLUMN IF NOT EXISTS admin_override_at timestamptz;

-- Create a workflow_overrides audit table for tracking all admin overrides
CREATE TABLE IF NOT EXISTS public.workflow_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, -- 'transfer', 'agreement', 'activation'
  entity_id text NOT NULL,
  action text NOT NULL, -- what was overridden
  reason text NOT NULL,
  overridden_by uuid REFERENCES auth.users(id),
  overridden_by_name text,
  blocking_reasons_at_override jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read overrides" ON public.workflow_overrides
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert overrides" ON public.workflow_overrides
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
