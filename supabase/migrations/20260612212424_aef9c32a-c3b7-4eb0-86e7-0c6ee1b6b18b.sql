CREATE TABLE public.schedule_reconciliation_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_key text NOT NULL UNIQUE,
  issue_type text NOT NULL,
  resolution text NOT NULL CHECK (resolution IN ('ignored','accept_homebase','accept_lovable','acknowledged','pending_admin_approval','mapped_employee')),
  note text,
  date_key date NOT NULL,
  provider_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_shift_id text,
  homebase_shift_id text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_reconciliation_overrides TO authenticated;
GRANT ALL ON public.schedule_reconciliation_overrides TO service_role;

ALTER TABLE public.schedule_reconciliation_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and pod leads can read overrides"
  ON public.schedule_reconciliation_overrides
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'pod_lead'));

CREATE POLICY "Admins and pod leads can insert overrides"
  ON public.schedule_reconciliation_overrides
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'pod_lead'));

CREATE POLICY "Admins and pod leads can update overrides"
  ON public.schedule_reconciliation_overrides
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'pod_lead'));

CREATE POLICY "Admins can delete overrides"
  ON public.schedule_reconciliation_overrides
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_schedule_reconciliation_overrides_updated_at
  BEFORE UPDATE ON public.schedule_reconciliation_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_sro_date_key ON public.schedule_reconciliation_overrides(date_key);
CREATE INDEX idx_sro_provider_id ON public.schedule_reconciliation_overrides(provider_id);