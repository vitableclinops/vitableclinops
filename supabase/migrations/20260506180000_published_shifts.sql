-- Per-shift publishing tracker. Sarabjeet's Schedule Builder workflow needs
-- to mark each shift "posted to Homebase" / "posted to EHR" individually so
-- she can resume mid-task. The existing publish_status table is per-(provider,
-- month) and was too coarse — providers with 47 shifts had no resumption point.
--
-- Linear status flow per shift: not_started → posted_homebase → posted_ehr.
-- We track timestamps + actor for both steps so the UI can show who published
-- what when (and let any scheduling/admin user act).

CREATE TABLE IF NOT EXISTS public.published_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.schedule_submissions(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  target_month date NOT NULL,
  shift_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  hours numeric(6,2),
  state text,
  shift_type text,
  homebase_posted_at timestamptz,
  homebase_posted_by uuid,
  ehr_posted_at timestamptz,
  ehr_posted_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, shift_date, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_published_shifts_provider_month
  ON public.published_shifts(provider_id, target_month);
CREATE INDEX IF NOT EXISTS idx_published_shifts_submission
  ON public.published_shifts(submission_id);
CREATE INDEX IF NOT EXISTS idx_published_shifts_date
  ON public.published_shifts(shift_date);

ALTER TABLE public.published_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Scheduling staff can view published shifts" ON public.published_shifts;
CREATE POLICY "Scheduling staff can view published shifts"
  ON public.published_shifts FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

DROP POLICY IF EXISTS "Scheduling staff can insert published shifts" ON public.published_shifts;
CREATE POLICY "Scheduling staff can insert published shifts"
  ON public.published_shifts FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

DROP POLICY IF EXISTS "Scheduling staff can update published shifts" ON public.published_shifts;
CREATE POLICY "Scheduling staff can update published shifts"
  ON public.published_shifts FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

DROP POLICY IF EXISTS "Scheduling staff can delete published shifts" ON public.published_shifts;
CREATE POLICY "Scheduling staff can delete published shifts"
  ON public.published_shifts FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

CREATE TRIGGER update_published_shifts_updated_at
  BEFORE UPDATE ON public.published_shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Audit log for manual decision overrides on needs_review submissions.
-- Anyone with scheduling/admin/pod_lead role can resolve a flagged submission,
-- but every override is recorded with actor + timestamp + reason so it's
-- always clear who unblocked the schedule.
CREATE TABLE IF NOT EXISTS public.submission_override_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.schedule_submissions(id) ON DELETE CASCADE,
  prior_status text,
  new_status text NOT NULL,
  hours_basis numeric(8,2),
  reason text,
  actor_id uuid,
  actor_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submission_override_log_submission
  ON public.submission_override_log(submission_id);

ALTER TABLE public.submission_override_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Scheduling staff read override log" ON public.submission_override_log;
CREATE POLICY "Scheduling staff read override log"
  ON public.submission_override_log FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );

DROP POLICY IF EXISTS "Scheduling staff write override log" ON public.submission_override_log;
CREATE POLICY "Scheduling staff write override log"
  ON public.submission_override_log FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'pod_lead'::app_role)
    OR public.has_role(auth.uid(), 'scheduling'::app_role)
  );
