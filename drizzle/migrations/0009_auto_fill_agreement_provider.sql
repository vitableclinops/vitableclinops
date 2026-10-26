CREATE OR REPLACE FUNCTION public.fill_agreement_provider_details()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM false THEN
    UPDATE public.collaborative_agreements
       SET provider_name = NEW.provider_name,
           provider_email = NEW.provider_email,
           provider_id = COALESCE(provider_id, NEW.provider_id)
     WHERE id = NEW.agreement_id
       AND (provider_name IS NULL OR provider_name = '')
       AND (provider_email IS NULL OR provider_email = '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_agreement_provider_details ON public.agreement_providers;
CREATE TRIGGER trg_fill_agreement_provider_details
AFTER INSERT OR UPDATE OF is_active, provider_name, provider_email ON public.agreement_providers
FOR EACH ROW EXECUTE FUNCTION public.fill_agreement_provider_details();

UPDATE public.collaborative_agreements ca
   SET provider_name = ap.provider_name,
       provider_email = ap.provider_email,
       provider_id = COALESCE(ca.provider_id, ap.provider_id)
  FROM (SELECT DISTINCT ON (agreement_id) agreement_id, provider_name, provider_email, provider_id
          FROM public.agreement_providers WHERE is_active IS DISTINCT FROM false
         ORDER BY agreement_id, created_at) ap
 WHERE ap.agreement_id = ca.id
   AND (ca.provider_name IS NULL OR ca.provider_name = '')
   AND (ca.provider_email IS NULL OR ca.provider_email = '');