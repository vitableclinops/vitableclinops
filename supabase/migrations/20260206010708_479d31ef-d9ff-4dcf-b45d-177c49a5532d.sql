-- Add fields for editable tasks in transfer workflows
ALTER TABLE public.agreement_tasks
ADD COLUMN IF NOT EXISTS is_required boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS provider_id uuid,
ADD COLUMN IF NOT EXISTS physician_id uuid,
ADD COLUMN IF NOT EXISTS external_url text,
ADD COLUMN IF NOT EXISTS blockers text,
ADD COLUMN IF NOT EXISTS notes text;

-- Add state fields for better tracking
ALTER TABLE public.agreement_tasks
ADD COLUMN IF NOT EXISTS state_name text,
ADD COLUMN IF NOT EXISTS state_abbreviation text;

-- Add activity log type for task edits
ALTER TABLE public.transfer_activity_log
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Update agreement_transfers with lifecycle tracking fields
ALTER TABLE public.agreement_transfers
ADD COLUMN IF NOT EXISTS first_meeting_scheduled_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS new_agreement_renewal_date date,
ADD COLUMN IF NOT EXISTS meeting_cadence text,
ADD COLUMN IF NOT EXISTS chart_review_frequency text;

-- Create index for task ordering
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_transfer_sort 
ON public.agreement_tasks(transfer_id, sort_order);

-- Create index for assignee lookup
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_assignee 
ON public.agreement_tasks(assigned_to) WHERE assigned_to IS NOT NULL;

-- Add RLS policy for physicians to view tasks they're involved in
DROP POLICY IF EXISTS "Physicians can view their tasks" ON public.agreement_tasks;
CREATE POLICY "Physicians can view their tasks" ON public.agreement_tasks
FOR SELECT TO authenticated
USING (
  assigned_to IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Add RLS policy for providers to view tasks
DROP POLICY IF EXISTS "Providers can view their assigned tasks" ON public.agreement_tasks;
CREATE POLICY "Providers can view their assigned tasks" ON public.agreement_tasks
FOR SELECT TO authenticated
USING (
  assigned_to IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);