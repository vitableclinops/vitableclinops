-- Add assigned_to_name and notification tracking to agreement_tasks
ALTER TABLE public.agreement_tasks 
ADD COLUMN IF NOT EXISTS assigned_to_name text,
ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS notification_status text DEFAULT 'pending';

-- Create table for transfer activity log (multi-party visibility)
CREATE TABLE IF NOT EXISTS public.transfer_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid REFERENCES public.agreement_transfers(id) ON DELETE CASCADE NOT NULL,
  task_id uuid REFERENCES public.agreement_tasks(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id),
  actor_name text,
  actor_role text,
  description text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Add lifecycle tracking to transfers
ALTER TABLE public.agreement_transfers
ADD COLUMN IF NOT EXISTS new_agreement_renewal_date date,
ADD COLUMN IF NOT EXISTS first_meeting_scheduled_date timestamptz,
ADD COLUMN IF NOT EXISTS meeting_cadence text,
ADD COLUMN IF NOT EXISTS chart_review_frequency text;

-- Enable RLS on transfer activity log
ALTER TABLE public.transfer_activity_log ENABLE ROW LEVEL SECURITY;

-- RLS policy: Admins can do everything
CREATE POLICY "Admins can manage transfer activity log"
ON public.transfer_activity_log
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RLS policy: Providers can view activities for transfers that affect them
-- Fix: cast uuid to text for array comparison
CREATE POLICY "Providers can view their transfer activities"
ON public.transfer_activity_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.agreement_transfers t
    WHERE t.id = transfer_activity_log.transfer_id
    AND auth.uid()::text = ANY(t.affected_provider_ids::text[])
  )
);

-- RLS policy: Physicians can view activities for transfers involving them
-- Fix: cast physician_id from text to uuid for comparison
CREATE POLICY "Physicians can view their transfer activities"
ON public.transfer_activity_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.agreement_transfers t
    WHERE t.id = transfer_activity_log.transfer_id
    AND (t.source_physician_id::text = auth.uid()::text OR t.target_physician_id::text = auth.uid()::text)
  )
);

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_transfer_activity_log_transfer_id ON public.transfer_activity_log(transfer_id);
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_assigned_to ON public.agreement_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_transfer_id ON public.agreement_tasks(transfer_id);