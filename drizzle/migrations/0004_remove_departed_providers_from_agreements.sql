CREATE OR REPLACE FUNCTION public.remove_departed_provider_from_agreements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.employment_status IN ('inactive','termed')
     AND COALESCE(OLD.employment_status,'') IS DISTINCT FROM NEW.employment_status THEN
    INSERT INTO public.agreement_audit_log(entity_type, entity_id, action, changes, performed_by_name, performed_by_role)
    SELECT 'agreement', ap.agreement_id, 'provider_removed',
      jsonb_build_object('provider_id', NEW.id, 'provider_name', ap.provider_name,
        'reason', 'Provider status set to ' || NEW.employment_status),
      'System', 'system'
    FROM public.agreement_providers ap
    WHERE ap.provider_id = NEW.id AND ap.is_active;

    UPDATE public.agreement_providers
       SET is_active = false, removed_at = now(),
           removed_reason = 'Provider status set to ' || NEW.employment_status
     WHERE provider_id = NEW.id AND is_active;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_remove_departed_provider_from_agreements
AFTER UPDATE OF employment_status ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.remove_departed_provider_from_agreements();

-- Backfill: providers already inactive/termed
INSERT INTO public.agreement_audit_log(entity_type, entity_id, action, changes, performed_by_name, performed_by_role)
SELECT 'agreement', ap.agreement_id, 'provider_removed',
  jsonb_build_object('provider_id', p.id, 'provider_name', ap.provider_name, 'reason', 'Provider status is ' || p.employment_status),
  'System', 'system'
FROM public.agreement_providers ap JOIN public.profiles p ON p.id = ap.provider_id
WHERE ap.is_active AND p.employment_status IN ('inactive','termed');

UPDATE public.agreement_providers ap
   SET is_active = false, removed_at = now(), removed_reason = 'Provider status is ' || p.employment_status
  FROM public.profiles p
 WHERE p.id = ap.provider_id AND ap.is_active AND p.employment_status IN ('inactive','termed');