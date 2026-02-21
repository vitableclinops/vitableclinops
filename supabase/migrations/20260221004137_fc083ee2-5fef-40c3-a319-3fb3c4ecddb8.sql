
-- ============================================================
-- TRIGGER 2: licensure_applications.status → approved
-- Creates provider_licenses row + re-evaluates readiness
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_licensure_application_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_license_id uuid;
  v_ca_required boolean;
  v_has_active_ca boolean;
  v_has_active_license boolean;
  v_new_readiness readiness_status;
BEGIN
  -- Only fire when status changes TO 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    -- Set approved_at timestamp
    NEW.approved_at := now();

    -- Create provider_licenses row
    INSERT INTO public.provider_licenses (
      profile_id, state_abbreviation, status, issue_date, license_type
    ) VALUES (
      NEW.provider_id, NEW.state_abbreviation, 'active', CURRENT_DATE, NEW.designation_type
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_license_id;

    -- Link license back to application if created
    IF v_license_id IS NOT NULL THEN
      NEW.license_id := v_license_id;
    END IF;

    -- Re-evaluate provider_state_status readiness
    SELECT ca_required INTO v_ca_required
    FROM public.state_compliance_requirements
    WHERE state_abbreviation = NEW.state_abbreviation
    LIMIT 1;

    v_has_active_license := TRUE; -- We just created/confirmed one

    IF COALESCE(v_ca_required, FALSE) THEN
      SELECT EXISTS(
        SELECT 1 FROM public.collaborative_agreements ca
        JOIN public.agreement_providers ap ON ap.agreement_id = ca.id
        WHERE ca.state_abbreviation = NEW.state_abbreviation
          AND ap.provider_id = NEW.provider_id
          AND ap.is_active = TRUE
          AND ca.workflow_status = 'active'
      ) INTO v_has_active_ca;

      IF v_has_active_ca THEN
        v_new_readiness := 'ready';
      ELSE
        v_new_readiness := 'not_ready';
      END IF;
    ELSE
      v_new_readiness := 'ready';
    END IF;

    INSERT INTO public.provider_state_status (provider_id, state_abbreviation, readiness_status, readiness_reason, readiness_last_evaluated_at)
    VALUES (NEW.provider_id, NEW.state_abbreviation, v_new_readiness,
      CASE WHEN v_new_readiness = 'ready' THEN 'License approved' ELSE 'License approved but CPA required' END,
      now())
    ON CONFLICT (provider_id, state_abbreviation)
    DO UPDATE SET
      readiness_status = EXCLUDED.readiness_status,
      readiness_reason = EXCLUDED.readiness_reason,
      readiness_last_evaluated_at = now(),
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_licensure_application_approved
  BEFORE UPDATE ON public.licensure_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.on_licensure_application_approved();

-- ============================================================
-- TRIGGER 3: licensure_application_steps completed with fee
-- Creates reimbursement_requests row
-- ============================================================
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
  -- Only fire when status changes TO 'completed' AND fee_amount is set
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
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

CREATE TRIGGER trg_licensure_step_completed_fee
  BEFORE UPDATE ON public.licensure_application_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.on_licensure_step_completed_with_fee();

-- ============================================================
-- TRIGGER 4: reimbursement_requests.status → approved/processed
-- Syncs back to licensure_application_steps
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_reimbursement_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('approved', 'processed') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.licensure_application_steps
    SET reimbursement_status = NEW.status,
        updated_at = now()
    WHERE reimbursement_request_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_reimbursement_status_sync
  AFTER UPDATE ON public.reimbursement_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.on_reimbursement_status_change();

-- ============================================================
-- TRIGGER 5: collaborative_agreements.workflow_status → active
-- Updates provider_state_status for all linked providers + marks final workflow step
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_agreement_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_provider record;
BEGIN
  IF NEW.workflow_status = 'active' AND (OLD.workflow_status IS DISTINCT FROM 'active') THEN
    -- Update provider_state_status for all active providers on this agreement
    FOR v_provider IN
      SELECT provider_id FROM public.agreement_providers
      WHERE agreement_id = NEW.id AND is_active = TRUE AND provider_id IS NOT NULL
    LOOP
      INSERT INTO public.provider_state_status (provider_id, state_abbreviation, readiness_status, readiness_reason, readiness_last_evaluated_at)
      VALUES (v_provider.provider_id, NEW.state_abbreviation, 'ready', 'Collaborative agreement activated', now())
      ON CONFLICT (provider_id, state_abbreviation)
      DO UPDATE SET
        readiness_status = 'ready',
        readiness_reason = 'Collaborative agreement activated',
        readiness_last_evaluated_at = now(),
        updated_at = now();
    END LOOP;

    -- Mark the final workflow step as completed
    UPDATE public.agreement_workflow_steps
    SET status = 'completed',
        completed_at = now()
    WHERE agreement_id = NEW.id
      AND step_number = (
        SELECT MAX(step_number) FROM public.agreement_workflow_steps WHERE agreement_id = NEW.id
      )
      AND status != 'completed';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_agreement_activated
  AFTER UPDATE ON public.collaborative_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.on_agreement_activated();

-- ============================================================
-- TRIGGER 6: provider_licenses.status → active
-- Re-evaluates readiness + checks if CPA needed
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_license_activated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ca_required boolean;
  v_has_active_ca boolean;
  v_new_readiness readiness_status;
  v_provider_id uuid;
BEGIN
  IF NEW.status = 'active' AND (OLD.status IS DISTINCT FROM 'active') THEN
    v_provider_id := NEW.profile_id;

    -- Check state CA requirement
    SELECT ca_required INTO v_ca_required
    FROM public.state_compliance_requirements
    WHERE state_abbreviation = NEW.state_abbreviation
    LIMIT 1;

    IF COALESCE(v_ca_required, FALSE) THEN
      -- Check for active collaborative agreement
      SELECT EXISTS(
        SELECT 1 FROM public.collaborative_agreements ca
        JOIN public.agreement_providers ap ON ap.agreement_id = ca.id
        WHERE ca.state_abbreviation = NEW.state_abbreviation
          AND ap.provider_id = v_provider_id
          AND ap.is_active = TRUE
          AND ca.workflow_status = 'active'
      ) INTO v_has_active_ca;

      IF v_has_active_ca THEN
        v_new_readiness := 'ready';
      ELSE
        v_new_readiness := 'not_ready';
        
        -- Create a notification task for ops team that CPA is needed
        INSERT INTO public.agreement_tasks (
          title, description, category, status, priority,
          provider_id, state_abbreviation, state_name,
          is_auto_generated, auto_trigger, compliance_risk
        ) VALUES (
          'CPA Required: ' || NEW.state_abbreviation || ' license activated',
          'Provider license activated in ' || NEW.state_abbreviation || ' which requires a collaborative practice agreement. No active CPA exists for this provider-state combination.',
          'compliance', 'pending', 'high',
          v_provider_id, NEW.state_abbreviation,
          (SELECT state_name FROM public.state_compliance_requirements WHERE state_abbreviation = NEW.state_abbreviation LIMIT 1),
          TRUE, 'license_activated_no_cpa', 'high'
        );
      END IF;
    ELSE
      v_new_readiness := 'ready';
    END IF;

    -- Upsert provider_state_status
    INSERT INTO public.provider_state_status (provider_id, state_abbreviation, readiness_status, readiness_reason, readiness_last_evaluated_at)
    VALUES (v_provider_id, NEW.state_abbreviation, v_new_readiness,
      CASE WHEN v_new_readiness = 'ready' THEN 'License active' ELSE 'License active but CPA required' END,
      now())
    ON CONFLICT (provider_id, state_abbreviation)
    DO UPDATE SET
      readiness_status = EXCLUDED.readiness_status,
      readiness_reason = EXCLUDED.readiness_reason,
      readiness_last_evaluated_at = now(),
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_license_activated
  AFTER UPDATE ON public.provider_licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.on_license_activated();
