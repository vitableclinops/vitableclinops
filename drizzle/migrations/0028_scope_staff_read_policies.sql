CREATE OR REPLACE FUNCTION public.is_ops_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','pod_lead','scheduling'))
$$;

CREATE OR REPLACE FUNCTION public.is_own_profile(_user_id uuid, _profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _profile_id AND user_id = _user_id)
$$;

DROP POLICY IF EXISTS "Signed-in users can view" ON public.provider_ops_info;
CREATE POLICY "Staff or owner can view" ON public.provider_ops_info FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()) OR public.is_own_profile(auth.uid(), profile_id));

DROP POLICY IF EXISTS "Signed-in users can view" ON public.provider_state_collab_decisions;
CREATE POLICY "Staff or owner can view" ON public.provider_state_collab_decisions FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()) OR public.is_own_profile(auth.uid(), profile_id));

DROP POLICY IF EXISTS "Signed-in users can view requirement proof" ON public.provider_requirement_verifications;
CREATE POLICY "Staff or owner can view requirement proof" ON public.provider_requirement_verifications FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()) OR public.is_own_profile(auth.uid(), profile_id));

DROP POLICY IF EXISTS "Signed-in users can view" ON public.provider_utilization;
CREATE POLICY "Staff or owner can view" ON public.provider_utilization FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()) OR public.is_own_profile(auth.uid(), profile_id));

DROP POLICY IF EXISTS "Signed-in users can view" ON public.workflow_message_templates;
CREATE POLICY "Staff can view" ON public.workflow_message_templates FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()));

DROP POLICY IF EXISTS "Signed-in users can view" ON public.transfer_task_templates;
CREATE POLICY "Staff can view" ON public.transfer_task_templates FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()));

DROP POLICY IF EXISTS "Signed-in users can view" ON public.calendar_events;
CREATE POLICY "Staff, creators or invitees can view" ON public.calendar_events FOR SELECT TO authenticated
  USING (
    public.is_ops_staff(auth.uid())
    OR public.has_role(auth.uid(), 'physician'::app_role)
    OR created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.meeting_attendees ma JOIN public.profiles p ON p.id = ma.provider_id
               WHERE ma.meeting_id = calendar_events.id AND p.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.event_attestations ea JOIN public.profiles p ON p.id = ea.provider_id
               WHERE ea.event_id = calendar_events.id AND p.user_id = auth.uid())
    OR event_type IN ('all_hands','newsletter')
  );

DROP POLICY IF EXISTS "Authenticated users can read matching_engine_runs" ON public.matching_engine_runs;
CREATE POLICY "Staff can read matching_engine_runs" ON public.matching_engine_runs FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read matching_assignments" ON public.matching_assignments;
CREATE POLICY "Staff can read matching_assignments" ON public.matching_assignments FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read contractor_compliance_docs" ON public.contractor_compliance_docs;
CREATE POLICY "Staff can read contractor_compliance_docs" ON public.contractor_compliance_docs FOR SELECT TO authenticated
  USING (public.is_ops_staff(auth.uid()));

DROP POLICY IF EXISTS "Signed-in users can view agency documents" ON storage.objects;
CREATE POLICY "Staff can view agency documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'agency-documents' AND public.is_ops_staff(auth.uid()));