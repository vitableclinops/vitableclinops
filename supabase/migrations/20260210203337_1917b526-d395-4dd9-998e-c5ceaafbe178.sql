
-- Agency contacts table (multiple contacts per agency)
CREATE TABLE public.agency_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL,
  role_title TEXT,
  email TEXT,
  phone TEXT,
  preferred_contact_method TEXT DEFAULT 'email',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage agency contacts"
  ON public.agency_contacts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view agency contacts"
  ON public.agency_contacts FOR SELECT
  USING (true);

-- Agency documents table
CREATE TABLE public.agency_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'contract',
  storage_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  effective_date DATE,
  expiration_date DATE,
  uploaded_by UUID REFERENCES public.profiles(id),
  uploaded_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage agency documents"
  ON public.agency_documents FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view agency documents"
  ON public.agency_documents FOR SELECT
  USING (true);

-- Storage bucket for agency documents
INSERT INTO storage.buckets (id, name, public) 
VALUES ('agency-documents', 'agency-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins can upload agency documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'agency-documents' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update agency documents"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'agency-documents' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete agency documents"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'agency-documents' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view agency documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'agency-documents');

-- Prevent agency deletion when providers are linked
CREATE OR REPLACE FUNCTION public.prevent_agency_delete_with_providers()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE agency_id = OLD.id AND employment_type = 'agency') THEN
    RAISE EXCEPTION 'Cannot delete agency with linked providers. Reassign providers first.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER prevent_agency_delete
  BEFORE DELETE ON public.agencies
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_agency_delete_with_providers();

-- Audit log for provider-agency linkage changes
CREATE OR REPLACE FUNCTION public.log_provider_agency_change()
RETURNS TRIGGER AS $$
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
      auth.uid()
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER log_provider_agency_changes
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_provider_agency_change();
