-- Create agreement_transfers table to group termination + initiation workflows
CREATE TABLE public.agreement_transfers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  
  -- Source agreement being terminated
  source_agreement_id UUID NOT NULL,
  source_physician_id UUID,
  source_physician_name TEXT,
  source_physician_email TEXT,
  
  -- Target agreement being initiated
  target_agreement_id UUID,
  target_physician_id UUID,
  target_physician_name TEXT NOT NULL,
  target_physician_email TEXT,
  
  -- Affected providers (stored as JSON array of provider IDs)
  affected_provider_ids UUID[] NOT NULL DEFAULT '{}',
  affected_provider_count INTEGER NOT NULL DEFAULT 0,
  
  -- State context
  state_abbreviation TEXT NOT NULL,
  state_name TEXT NOT NULL,
  
  -- Effective date for the transfer
  effective_date DATE,
  
  -- Tracking
  initiated_by UUID,
  initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID,
  notes TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agreement_transfers ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage all transfers"
ON public.agreement_transfers
FOR ALL
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Physicians can view transfers involving them"
ON public.agreement_transfers
FOR SELECT
USING (
  source_physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR target_physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Add transfer_id column to agreement_tasks to group tasks under a transfer
ALTER TABLE public.agreement_tasks 
ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES public.agreement_transfers(id);

-- Add index for performance
CREATE INDEX idx_agreement_tasks_transfer_id ON public.agreement_tasks(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX idx_agreement_transfers_status ON public.agreement_transfers(status);
CREATE INDEX idx_agreement_transfers_source_agreement ON public.agreement_transfers(source_agreement_id);

-- Trigger for updated_at
CREATE TRIGGER update_agreement_transfers_updated_at
BEFORE UPDATE ON public.agreement_transfers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();