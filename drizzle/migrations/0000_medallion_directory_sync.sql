ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS directory_visibility text NOT NULL DEFAULT 'visible',
  ADD COLUMN IF NOT EXISTS directory_visibility_reason text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_directory_visibility_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_directory_visibility_check CHECK (directory_visibility IN ('visible','excluded','review'));

CREATE TABLE public.medallion_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL CHECK (entity IN ('providers','licenses','agreements')),
  scope text NOT NULL DEFAULT 'full' CHECK (scope IN ('full','provider')),
  medallion_provider_id text,
  mode text NOT NULL DEFAULT 'apply' CHECK (mode IN ('dry_run','apply')),
  trigger_source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rows_returned integer NOT NULL DEFAULT 0,
  rows_written integer NOT NULL DEFAULT 0,
  rows_failed integer NOT NULL DEFAULT 0,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid
);
CREATE INDEX medallion_sync_runs_entity_idx ON public.medallion_sync_runs (entity, started_at DESC);

CREATE TABLE public.medallion_providers (
  medallion_id text PRIMARY KEY,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  match_method text NOT NULL DEFAULT 'unmatched',
  match_notes text,
  full_name text, first_name text, last_name text, preferred_name text,
  email text, npi text, profession text,
  medallion_employment_status text, medallion_employment_type text,
  start_date date, termination_date date,
  primary_specialty text, secondary_specialty text,
  primary_taxonomy text, secondary_taxonomy text,
  languages text[],
  detail_state text NOT NULL DEFAULT 'not_fetched',
  is_prescribing boolean, is_nlc_active boolean, has_collab_flag boolean,
  medallion_last_updated timestamptz,
  last_returned_at timestamptz,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medallion_providers_profile_idx ON public.medallion_providers (profile_id);

CREATE TABLE public.medallion_licenses (
  medallion_license_id text PRIMARY KEY,
  medallion_provider_id text,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  state text NOT NULL,
  status text,
  license_number text, certificate_type text,
  issue_date date, expiration_date date,
  verified boolean, rx_authority text, using_compact boolean,
  medallion_modified timestamptz,
  last_returned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medallion_licenses_profile_idx ON public.medallion_licenses (profile_id);

CREATE TABLE public.medallion_collab_agreements (
  medallion_agreement_id text PRIMARY KEY,
  medallion_provider_id text NOT NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  supervisor_name text, supervisor_medallion_id text, supervisor_npi text,
  supervisor_profession text, supervisor_license_number text,
  supervisor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  state text,
  source_status text, agreement_type text,
  start_date date, end_date date,
  document_id text, document_title text,
  local_agreement_id uuid,
  local_match_notes text,
  last_returned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medallion_collab_profile_idx ON public.medallion_collab_agreements (profile_id);

GRANT SELECT ON public.medallion_sync_runs, public.medallion_providers, public.medallion_licenses, public.medallion_collab_agreements TO authenticated;
GRANT ALL ON public.medallion_sync_runs, public.medallion_providers, public.medallion_licenses, public.medallion_collab_agreements TO service_role;

ALTER TABLE public.medallion_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medallion_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medallion_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medallion_collab_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and pod leads read medallion sync runs" ON public.medallion_sync_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Admins and pod leads read medallion providers" ON public.medallion_providers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Admins and pod leads read medallion licenses" ON public.medallion_licenses FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Admins and pod leads read medallion agreements" ON public.medallion_collab_agreements FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'pod_lead'));