
-- Fix 1: Re-point the FK from provider_license_applications to licensure_applications
ALTER TABLE public.reimbursement_requests
  DROP CONSTRAINT reimbursement_requests_license_application_id_fkey;

ALTER TABLE public.reimbursement_requests
  ADD CONSTRAINT reimbursement_requests_license_application_id_fkey
  FOREIGN KEY (license_application_id) REFERENCES public.licensure_applications(id);

-- Fix 2: Replace the trigger function to use 'approved' instead of 'completed'
CREATE OR REPLACE FUNCTION public.on_licensure_step_completed_with_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app record;
  v_reimb_id uuid;
BEGIN
  -- Fire when status changes TO 'approved' AND fee_amount is set
  IF NEW.status = 'approved'
     AND (OLD.status IS DISTINCT FROM 'approved')
     AND NEW.fee_amount IS NOT NULL
     AND NEW.fee_amount > 0
     AND (NEW.reimbursement_request_id IS NULL) THEN

    -- Get parent application info
    SELECT provider_id, provider_name, state_abbreviation, id
    INTO v_app
    FROM public.licensure_applications
    WHERE id = NEW.application_id;

    IF v_app IS NOT NULL THEN
      INSERT INTO public.reimbursement_requests (
        provider_id, provider_name, state_abbreviation,
        license_application_id, application_fee_amount,
        application_fee_receipt_url, status, submitted_at
      ) VALUES (
        v_app.provider_id, v_app.provider_name, v_app.state_abbreviation,
        v_app.id, NEW.fee_amount,
        NEW.fee_receipt_url, 'submitted', now()
      )
      RETURNING id INTO v_reimb_id;

      -- Link back to step
      NEW.reimbursement_request_id := v_reimb_id;
      NEW.reimbursement_status := 'submitted';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
