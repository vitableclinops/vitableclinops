
CREATE TABLE public.hiring_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_name text NOT NULL,
  role text,
  covered_states text[],
  stage text NOT NULL DEFAULT 'request_to_ds',
  status text NOT NULL DEFAULT 'active',
  source text DEFAULT 'slack',
  source_context jsonb DEFAULT '[]'::jsonb,
  ds_request_date date,
  candidates_provided_date date,
  interview_date date,
  interview_completed boolean DEFAULT false,
  hiring_decision text,
  hiring_decision_date date,
  onboarding_start_date date,
  first_shift_date date,
  notes text,
  slack_thread_url text,
  notion_page_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hiring_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage hiring candidates" ON public.hiring_candidates
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Pod leads can view hiring candidates" ON public.hiring_candidates
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'pod_lead'::app_role));

CREATE TRIGGER update_hiring_candidates_updated_at
  BEFORE UPDATE ON public.hiring_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
