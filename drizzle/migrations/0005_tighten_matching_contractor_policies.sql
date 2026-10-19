DROP POLICY IF EXISTS "Authenticated users can insert matching_engine_runs" ON public.matching_engine_runs;
CREATE POLICY "Admins can insert matching_engine_runs" ON public.matching_engine_runs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Authenticated users can insert matching_assignments" ON public.matching_assignments;
CREATE POLICY "Admins can insert matching_assignments" ON public.matching_assignments FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Authenticated users can manage contractor_compliance_docs" ON public.contractor_compliance_docs;
CREATE POLICY "Admins can manage contractor_compliance_docs" ON public.contractor_compliance_docs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));