-- Contractor compliance doc tracking for DirectShifts intake workflow

CREATE TABLE public.contractor_compliance_docs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state_abbreviation  text        NOT NULL,
  doc_type            text        NOT NULL,
  -- doc_type values: 'state_license' | 'malpractice' | 'dea' | 'caqh' | 'cv' |
  --   'collab_agreement' | 'board_certification' | 'background_check' | 'drug_screen' |
  --   'cms_opt_out' | 'prescriptive_authority' | 'counseling_license'
  status              text        NOT NULL DEFAULT 'pending',
  -- status values: 'pending' | 'submitted' | 'verified' | 'rejected' | 'expired'
  submitted_at        timestamptz,
  verified_at         timestamptz,
  verified_by_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  expiry_date         date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, state_abbreviation, doc_type)
);

CREATE INDEX idx_ccd_profile ON public.contractor_compliance_docs(profile_id);
CREATE INDEX idx_ccd_state   ON public.contractor_compliance_docs(state_abbreviation);
CREATE INDEX idx_ccd_status  ON public.contractor_compliance_docs(status);

ALTER TABLE public.contractor_compliance_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage contractor_compliance_docs" ON public.contractor_compliance_docs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view contractor_compliance_docs" ON public.contractor_compliance_docs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

CREATE TRIGGER update_contractor_compliance_docs_updated_at
  BEFORE UPDATE ON public.contractor_compliance_docs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
