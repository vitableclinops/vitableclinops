CREATE TABLE public.provider_requirement_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 state_abbreviation text NOT NULL,
 requirement_key text NOT NULL CHECK (requirement_key IN ('active_license','rx_authority','board_registration','furnishing_license','c_rxn_license','practice_without_collab','autonomous_status')),
 verified_source text NOT NULL,
 verified_on date NOT NULL,
 verified_link text,
 verified_attachment_path text,
 verified_attachment_name text,
 expiration_date date,
 verified_by uuid REFERENCES public.profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(profile_id,state_abbreviation,requirement_key),
 CHECK (length(trim(verified_source)) > 0),
 CHECK (coalesce(length(trim(verified_link)),0) > 0 OR coalesce(length(trim(verified_attachment_path)),0) > 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_requirement_verifications TO authenticated;
GRANT ALL ON public.provider_requirement_verifications TO service_role;
ALTER TABLE public.provider_requirement_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view requirement proof" ON public.provider_requirement_verifications FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage requirement proof" ON public.provider_requirement_verifications FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));