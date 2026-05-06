DROP TABLE IF EXISTS public.publish_status;

CREATE TABLE public.publish_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  target_month date NOT NULL,
  homebase_posted_at timestamptz,
  homebase_posted_by uuid,
  ehr_posted_at timestamptz,
  ehr_posted_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, target_month)
);

ALTER TABLE public.publish_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scheduling staff can view publish status"
  ON public.publish_status FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

CREATE POLICY "Scheduling staff can insert publish status"
  ON public.publish_status FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

CREATE POLICY "Scheduling staff can update publish status"
  ON public.publish_status FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

CREATE TRIGGER update_publish_status_updated_at
  BEFORE UPDATE ON public.publish_status
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_publish_status_month ON public.publish_status(target_month);
CREATE INDEX idx_publish_status_provider ON public.publish_status(provider_id);