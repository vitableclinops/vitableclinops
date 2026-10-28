ALTER TABLE public.profiles ADD COLUMN admin_no_npi boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.profiles.admin_no_npi IS 'Admin-reviewed missing NPI exception; does not bypass identity conflicts or clinical compliance.';
CREATE FUNCTION public.protect_admin_no_npi() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.admin_no_npi) OR (TG_OP = 'UPDATE' AND NEW.admin_no_npi IS DISTINCT FROM OLD.admin_no_npi) THEN
    IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) AND current_user NOT IN ('postgres', 'service_role') AND COALESCE(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Only admins can change the no NPI exception' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_admin_no_npi BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_admin_no_npi();