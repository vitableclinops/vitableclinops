CREATE TABLE public.coverage_outreach_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  state_abbreviation text NOT NULL,
  gap_hours numeric,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'email',
  email_message_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coverage_outreach_log_provider_state_sent
  ON public.coverage_outreach_log (profile_id, state_abbreviation, sent_at DESC);

CREATE INDEX idx_coverage_outreach_log_state_sent
  ON public.coverage_outreach_log (state_abbreviation, sent_at DESC);

ALTER TABLE public.coverage_outreach_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all outreach log"
  ON public.coverage_outreach_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert outreach log"
  ON public.coverage_outreach_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));