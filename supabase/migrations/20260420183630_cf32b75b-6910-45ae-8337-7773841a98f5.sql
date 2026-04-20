-- Create metabase_raw_exports for reports without dedicated tables
CREATE TABLE IF NOT EXISTS public.metabase_raw_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key TEXT NOT NULL,
  pulled_date DATE NOT NULL,
  rows JSONB NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  pulled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (report_key, pulled_date)
);

CREATE INDEX IF NOT EXISTS idx_metabase_raw_exports_key_date
  ON public.metabase_raw_exports (report_key, pulled_date DESC);

ALTER TABLE public.metabase_raw_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view raw exports"
  ON public.metabase_raw_exports
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
