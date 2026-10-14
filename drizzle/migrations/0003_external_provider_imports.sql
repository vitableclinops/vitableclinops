CREATE TABLE public.external_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id),
  external_provider_id text NOT NULL,
  profile_id uuid REFERENCES public.profiles(id),
  npi text, first_name text, last_name text, preferred_name text, email text, phone_number text,
  profession text, credentials text, agency_reported_status text, agency_classification text,
  employment_start_date date, employment_end_date date,
  primary_specialty text, secondary_specialty text, primary_taxonomy text, secondary_taxonomy text,
  languages text[], practice_restrictions text,
  license_inventory_status text, agreement_inventory_status text,
  verified_as_of date, verified_by text,
  last_import_run_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, external_provider_id)
);
CREATE TABLE public.external_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id),
  external_license_id text NOT NULL,
  external_provider_id text NOT NULL,
  state text, license_number text, certificate_type text, registration text, status text,
  issue_date date, expiration_date date, expiration_basis text, using_compact text, rx_authority text,
  verification_status text, verification_source text, document_reference text, verified_as_of date, verified_by text,
  last_import_run_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, external_license_id)
);
CREATE TABLE public.external_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id),
  external_agreement_id text NOT NULL,
  external_provider_id text NOT NULL,
  supervisor_external_id text, supervisor_name text, supervisor_npi text, supervisor_profession text,
  supervision_state text, supervisor_license_number text, collaborative_agreement_status text, collaborative_agreement_type text,
  supervision_start_date date, supervision_end_date date, contact_email text, contact_phone text,
  document_title text, document_reference text, notes text, verified_as_of date, verified_by text,
  last_import_run_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, external_agreement_id)
);
CREATE TABLE public.external_provider_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id),
  external_provider_id text NOT NULL,
  address_type text NOT NULL CHECK (address_type IN ('practice','mailing','home')),
  address_line_1 text, address_line_2 text, address_city text, address_state text, postal_code text, country text,
  last_import_run_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, external_provider_id, address_type)
);
CREATE TABLE public.external_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES public.agencies(id),
  file_name text, dry_run boolean NOT NULL DEFAULT true,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb, diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_providers, public.external_licenses, public.external_agreements, public.external_provider_addresses, public.external_import_runs TO authenticated;
GRANT ALL ON public.external_providers, public.external_licenses, public.external_agreements, public.external_provider_addresses, public.external_import_runs TO service_role;
ALTER TABLE public.external_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_provider_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage external providers" ON public.external_providers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Pod leads view external providers" ON public.external_providers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Admins manage external licenses" ON public.external_licenses FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Pod leads view external licenses" ON public.external_licenses FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Admins manage external agreements" ON public.external_agreements FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Pod leads view external agreements" ON public.external_agreements FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Admins manage external addresses" ON public.external_provider_addresses FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Pod leads view practice addresses" ON public.external_provider_addresses FOR SELECT TO authenticated USING (address_type = 'practice' AND public.has_role(auth.uid(),'pod_lead'));
CREATE POLICY "Admins manage import runs" ON public.external_import_runs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));