
CREATE TABLE public.provider_utilization (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_name TEXT NOT NULL,
  profile_id UUID,
  match_confidence TEXT,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  total_timeslots INTEGER NOT NULL,
  avg_utilization_pct NUMERIC(6,2),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_utilization ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view provider utilization"
  ON public.provider_utilization FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can insert provider utilization"
  ON public.provider_utilization FOR INSERT TO service_role WITH CHECK (true);
