
CREATE OR REPLACE FUNCTION public.log_provider_agency_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (OLD.agency_id IS DISTINCT FROM NEW.agency_id) OR (OLD.employment_type IS DISTINCT FROM NEW.employment_type) THEN
    INSERT INTO public.agreement_audit_log (
      entity_type, entity_id, action, changes, performed_by
    ) VALUES (
      'provider',
      NEW.id,
      'employment_type_change',
      jsonb_build_object(
        'old_employment_type', OLD.employment_type,
        'new_employment_type', NEW.employment_type,
        'old_agency_id', OLD.agency_id,
        'new_agency_id', NEW.agency_id
      ),
      CASE WHEN auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN auth.uid() ELSE NULL END
    );
  END IF;
  
  -- Enforce: agency providers MUST have agency_id, non-agency MUST NOT
  IF NEW.employment_type = 'agency' AND NEW.agency_id IS NULL THEN
    RAISE EXCEPTION 'Agency-supplied providers must be linked to an agency.';
  END IF;
  IF NEW.employment_type IN ('w2', '1099') AND NEW.agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'W2 and 1099 providers cannot be linked to an agency.';
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Also make performed_by nullable if it isn't already
ALTER TABLE public.agreement_audit_log ALTER COLUMN performed_by DROP NOT NULL;
