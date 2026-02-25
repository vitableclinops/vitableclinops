
CREATE OR REPLACE FUNCTION public.auto_set_renewal_date_on_task_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agreement_id uuid;
  v_start_date date;
  v_renewal_date date;
BEGIN
  -- Only fire when status transitions TO 'completed'
  IF NEW.status <> 'completed' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Only for 'Set renewal date' tasks
  IF lower(NEW.title) <> 'set renewal date' THEN
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

  -- Get the agreement start_date
  SELECT start_date::date INTO v_start_date
  FROM public.collaborative_agreements
  WHERE id = v_agreement_id;

  IF v_start_date IS NULL THEN
    -- Fallback to current date if no start_date set
    v_start_date := CURRENT_DATE;
  END IF;

  -- Calculate renewal date as 1 year from start_date
  v_renewal_date := v_start_date + interval '1 year';

  -- Update the agreement's next_renewal_date
  UPDATE public.collaborative_agreements
  SET next_renewal_date = v_renewal_date,
      updated_at = now()
  WHERE id = v_agreement_id;

  RETURN NEW;
END;
$function$;

-- Create trigger (drop first if exists to be safe)
DROP TRIGGER IF EXISTS trg_auto_set_renewal_date ON public.agreement_tasks;
CREATE TRIGGER trg_auto_set_renewal_date
  BEFORE UPDATE ON public.agreement_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_renewal_date_on_task_complete();
