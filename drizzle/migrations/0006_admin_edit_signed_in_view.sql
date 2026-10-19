DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('provider_appointment_count','Authenticated read provider_appointment_count'),
    ('provider_ops_info','Authenticated users can read provider_ops_info'),
    ('demand_forecast','Authenticated users can read demand_forecast'),
    ('state_activation','Authenticated read state activation'),
    ('provider_state_collab_decisions','Anyone can read collab decisions'),
    ('system_config','Anyone authenticated can read config'),
    ('collab_email_log','Authenticated users can read collab email log'),
    ('provider_utilization','Authenticated users can view provider utilization'),
    ('calendar_events','Everyone can view calendar events'),
    ('utilization_daily','Authenticated users can read utilization_daily'),
    ('coverage_bridge_snapshots','Authenticated read coverage_bridge_snapshots'),
    ('workflow_message_templates','Authenticated users can view message templates'),
    ('pods','Users can view pods'),
    ('pcp_state_coverage','Authenticated read pcp_state_coverage'),
    ('telemedicine_availability','Authenticated read telemedicine_availability'),
    ('kb_categories','Anyone can view KB categories'),
    ('collab_email_state_requirements','Anyone authenticated can read state requirements'),
    ('state_compliance_requirements','Anyone can view state compliance requirements'),
    ('transfer_task_templates','Authenticated users can view templates'),
    ('sla_attainment_aggregate','Authenticated read sla_attainment_aggregate')
  ) AS v(t,p) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.p, r.t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)', 'Signed-in users can view', r.t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Admins can manage state requirements" ON public.collab_email_state_requirements;
CREATE POLICY "Admins can manage state requirements" ON public.collab_email_state_requirements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "System can insert compliance log" ON public.compliance_status_log;
CREATE POLICY "Admins can insert compliance log" ON public.compliance_status_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "System can insert sensitive data log" ON public.sensitive_data_log;
CREATE POLICY "Users can log their own sensitive data events" ON public.sensitive_data_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "System can insert audit logs" ON public.agreement_audit_log;
CREATE POLICY "Signed-in users can add history as themselves" ON public.agreement_audit_log FOR INSERT TO authenticated
  WITH CHECK (performed_by IS NULL OR performed_by = auth.uid() OR performed_by IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));