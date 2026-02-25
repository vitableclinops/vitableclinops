
-- Trigger: auto-advance agreement workflow_status as tasks complete
-- Mapping:
--   draft + any task completed → in_progress
--   in_progress + all agreement_creation tasks done → pending_signatures (if signature tasks exist)
--   pending_signatures + all signature tasks done → pending_verification
--   pending_verification + all required tasks done → active (or cron handles via effective_date)

CREATE OR REPLACE FUNCTION public.advance_agreement_status_on_task_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_agreement_id uuid;
  v_current_status text;
  v_pending_creation_count int;
  v_pending_signature_count int;
  v_pending_required_count int;
  v_has_signature_tasks boolean;
  v_transfer_id uuid;
  v_target_agreement_id uuid;
BEGIN
  -- Only act on tasks transitioning to 'completed'
  IF NEW.status <> 'completed' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Determine the agreement_id: direct or via transfer
  v_agreement_id := NEW.agreement_id;
  
  IF v_agreement_id IS NULL AND NEW.transfer_id IS NOT NULL THEN
    SELECT target_agreement_id INTO v_agreement_id
    FROM public.agreement_transfers
    WHERE id = NEW.transfer_id;
  END IF;

  IF v_agreement_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get current workflow status
  SELECT workflow_status INTO v_current_status
  FROM public.collaborative_agreements
  WHERE id = v_agreement_id;

  IF v_current_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- TRANSITION 1: draft → in_progress (any task completed)
  IF v_current_status = 'draft' THEN
    UPDATE public.collaborative_agreements
    SET workflow_status = 'in_progress', updated_at = now()
    WHERE id = v_agreement_id;
    
    -- Also update workflow step
    UPDATE public.agreement_workflow_steps
    SET status = 'completed', completed_at = now()
    WHERE agreement_id = v_agreement_id AND step_number = 1 AND status <> 'completed';
    
    UPDATE public.agreement_workflow_steps
    SET status = 'in_progress', started_at = COALESCE(started_at, now())
    WHERE agreement_id = v_agreement_id AND step_number = 2 AND status = 'pending';
    
    v_current_status := 'in_progress';
  END IF;

  -- TRANSITION 2: in_progress → pending_signatures (all agreement_creation tasks done)
  IF v_current_status = 'in_progress' THEN
    -- Count pending agreement_creation tasks (excluding signature tasks)
    SELECT COUNT(*) INTO v_pending_creation_count
    FROM public.agreement_tasks
    WHERE (agreement_id = v_agreement_id OR 
           (transfer_id IS NOT NULL AND transfer_id IN (
             SELECT id FROM public.agreement_transfers WHERE target_agreement_id = v_agreement_id
           )))
      AND category = 'agreement_creation'
      AND is_required = true
      AND status NOT IN ('completed', 'cancelled', 'archived')
      AND archived_at IS NULL;

    -- Check if signature tasks exist for this agreement
    SELECT EXISTS(
      SELECT 1 FROM public.agreement_tasks
      WHERE (agreement_id = v_agreement_id OR 
             (transfer_id IS NOT NULL AND transfer_id IN (
               SELECT id FROM public.agreement_transfers WHERE target_agreement_id = v_agreement_id
             )))
        AND category = 'signature'
        AND archived_at IS NULL
    ) INTO v_has_signature_tasks;

    IF v_pending_creation_count = 0 AND v_has_signature_tasks THEN
      UPDATE public.collaborative_agreements
      SET workflow_status = 'pending_signatures', updated_at = now()
      WHERE id = v_agreement_id;
      
      UPDATE public.agreement_workflow_steps
      SET status = 'completed', completed_at = now()
      WHERE agreement_id = v_agreement_id AND step_number = 2 AND status <> 'completed';
      
      UPDATE public.agreement_workflow_steps
      SET status = 'in_progress', started_at = COALESCE(started_at, now())
      WHERE agreement_id = v_agreement_id AND step_number = 3 AND status = 'pending';
      
      v_current_status := 'pending_signatures';
    END IF;
  END IF;

  -- TRANSITION 3: pending_signatures → pending_verification (all signature tasks done)
  IF v_current_status = 'pending_signatures' THEN
    SELECT COUNT(*) INTO v_pending_signature_count
    FROM public.agreement_tasks
    WHERE (agreement_id = v_agreement_id OR 
           (transfer_id IS NOT NULL AND transfer_id IN (
             SELECT id FROM public.agreement_transfers WHERE target_agreement_id = v_agreement_id
           )))
      AND category = 'signature'
      AND is_required = true
      AND status NOT IN ('completed', 'cancelled', 'archived')
      AND archived_at IS NULL;

    IF v_pending_signature_count = 0 THEN
      UPDATE public.collaborative_agreements
      SET workflow_status = 'pending_verification', updated_at = now()
      WHERE id = v_agreement_id;
      
      UPDATE public.agreement_workflow_steps
      SET status = 'completed', completed_at = now()
      WHERE agreement_id = v_agreement_id AND step_number = 3 AND status <> 'completed';
      
      UPDATE public.agreement_workflow_steps
      SET status = 'in_progress', started_at = COALESCE(started_at, now())
      WHERE agreement_id = v_agreement_id AND step_number = 4 AND status = 'pending';
      
      v_current_status := 'pending_verification';
    END IF;
  END IF;

  -- TRANSITION 4: pending_verification → active (all required tasks done)
  -- Only if the effective date has passed or is today
  IF v_current_status = 'pending_verification' THEN
    SELECT COUNT(*) INTO v_pending_required_count
    FROM public.agreement_tasks
    WHERE (agreement_id = v_agreement_id OR 
           (transfer_id IS NOT NULL AND transfer_id IN (
             SELECT id FROM public.agreement_transfers WHERE target_agreement_id = v_agreement_id
           )))
      AND is_required = true
      AND status NOT IN ('completed', 'cancelled', 'archived')
      AND archived_at IS NULL;

    IF v_pending_required_count = 0 THEN
      -- Check effective date from linked transfer or agreement start_date
      DECLARE
        v_effective_date date;
      BEGIN
        SELECT COALESCE(
          (SELECT effective_date FROM public.agreement_transfers WHERE target_agreement_id = v_agreement_id LIMIT 1),
          (SELECT start_date FROM public.collaborative_agreements WHERE id = v_agreement_id)
        ) INTO v_effective_date;

        IF v_effective_date IS NULL OR v_effective_date <= CURRENT_DATE THEN
          UPDATE public.collaborative_agreements
          SET workflow_status = 'active', updated_at = now()
          WHERE id = v_agreement_id;
          
          UPDATE public.agreement_workflow_steps
          SET status = 'completed', completed_at = now()
          WHERE agreement_id = v_agreement_id AND step_number = 4 AND status <> 'completed';
          
          UPDATE public.agreement_workflow_steps
          SET status = 'completed', completed_at = now()
          WHERE agreement_id = v_agreement_id AND step_number = 5 AND status <> 'completed';
        END IF;
        -- If effective_date is in the future, stay at pending_verification; cron will activate on the date
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_advance_agreement_status ON public.agreement_tasks;

-- Create the trigger - fires AFTER the auto_create trigger
CREATE TRIGGER trg_advance_agreement_status
  AFTER UPDATE ON public.agreement_tasks
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed')
  EXECUTE FUNCTION public.advance_agreement_status_on_task_complete();
