-- State-driven email variables for collab agreement automation
CREATE TABLE public.collab_email_state_requirements (
  state_code TEXT PRIMARY KEY CHECK (length(state_code) = 2),
  state_name TEXT NOT NULL,
  collab_statute TEXT NOT NULL,
  meeting_req TEXT NOT NULL,
  chart_req TEXT NOT NULL,
  ongoing_req TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.collab_email_state_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read state requirements"
  ON public.collab_email_state_requirements FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage state requirements"
  ON public.collab_email_state_requirements FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'pod_lead'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'pod_lead'));

CREATE TRIGGER update_collab_email_state_requirements_updated_at
  BEFORE UPDATE ON public.collab_email_state_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial states (from collab_email_library.json)
INSERT INTO public.collab_email_state_requirements (state_code, state_name, collab_statute, meeting_req, chart_req, ongoing_req) VALUES
('IL', 'Illinois', 'Illinois Nurse Practice Act (225 ILCS 65)', 'monthly meetings (minimum 1 per month, may be conducted via Zoom or phone)', 'chart review of 5–10% of patient charts per quarter', 'Monthly check-ins (Zoom or phone accepted), quarterly chart review of 5–10% of charts, and co-signature on controlled substance prescriptions as required by IL statute.'),
('OH', 'Ohio', 'Ohio Revised Code §4723.431', 'monthly check-ins (may be conducted remotely)', 'chart review per Ohio Board of Nursing requirements', 'Monthly availability for consultation, periodic chart review as required by the Ohio Board of Nursing, and written protocols on file.'),
('NJ', 'New Jersey', 'N.J.A.C. 13:37-7', 'regular collaboration meetings as defined by the collaborative agreement', 'chart review per NJ State Board of Nursing requirements', 'Regular collaboration meetings per the signed agreement, chart review as required, and availability for consultation on complex cases.'),
('IN', 'Indiana', 'Indiana Code §25-23-1-19.4', 'quarterly meetings (may be conducted remotely per Indiana Board of Nursing guidance)', 'chart review per Indiana collaborative agreement requirements', 'Quarterly availability for check-ins, chart review as specified in the collaborative agreement, and documentation on file with the Indiana Board of Nursing.');

-- Audit log for collab agreement email sends
CREATE TABLE public.collab_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID REFERENCES public.collaborative_agreements(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('np','physician')),
  recipient_email TEXT NOT NULL,
  state_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent','blocked','failed')),
  blocked_reason TEXT,
  subject TEXT,
  resend_id TEXT,
  error_message TEXT,
  triggered_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_collab_email_log_agreement ON public.collab_email_log(agreement_id, created_at DESC);
CREATE INDEX idx_collab_email_log_status ON public.collab_email_log(status) WHERE status != 'sent';

ALTER TABLE public.collab_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read collab email log"
  ON public.collab_email_log FOR SELECT
  TO authenticated USING (true);
-- No INSERT/UPDATE policies — writes happen via service role from edge functions.