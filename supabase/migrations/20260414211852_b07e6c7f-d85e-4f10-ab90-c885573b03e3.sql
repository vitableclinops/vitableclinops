
-- Homebase sync runs
CREATE TABLE public.homebase_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  locations_synced integer DEFAULT 0,
  employees_synced integer DEFAULT 0,
  shifts_synced integer DEFAULT 0,
  employees_matched integer DEFAULT 0,
  employees_unmatched integer DEFAULT 0,
  unmatched_sample jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.homebase_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage sync runs" ON public.homebase_sync_runs FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access sync runs" ON public.homebase_sync_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Homebase locations
CREATE TABLE public.homebase_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_uuid text NOT NULL UNIQUE,
  name text,
  address_1 text,
  address_2 text,
  city text,
  state text,
  zip text,
  time_zone text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.homebase_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage locations" ON public.homebase_locations FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access locations" ON public.homebase_locations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Homebase employees
CREATE TABLE public.homebase_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_id integer NOT NULL UNIQUE,
  location_homebase_uuid text,
  email text,
  first_name text,
  last_name text,
  normalized_name text,
  profile_id uuid,
  match_confidence text DEFAULT 'unmatched',
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.homebase_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage employees" ON public.homebase_employees FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access employees" ON public.homebase_employees FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Homebase shifts
CREATE TABLE public.homebase_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_id integer NOT NULL UNIQUE,
  homebase_user_id integer,
  homebase_employee_id uuid,
  location_homebase_uuid text,
  role text,
  department text,
  start_at timestamptz,
  end_at timestamptz,
  scheduled_hours numeric,
  published boolean DEFAULT false,
  scheduled boolean DEFAULT true,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.homebase_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage shifts" ON public.homebase_shifts FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access shifts" ON public.homebase_shifts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Provider name mappings (manual overrides)
CREATE TABLE public.provider_name_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homebase_name text NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(homebase_name)
);
ALTER TABLE public.provider_name_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage name mappings" ON public.provider_name_mappings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role full access mappings" ON public.provider_name_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);
