
-- 1. Enhancement Registry (admin-only roadmap tracking)
CREATE TABLE public.enhancement_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'proposed',
  requested_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.enhancement_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage enhancements" ON public.enhancement_registry
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed with known future enhancements
INSERT INTO public.enhancement_registry (title, description, category, priority) VALUES
  ('Onboarding Automation', 'Automated new provider onboarding flow with task generation', 'workflow', 'high'),
  ('Rippling Integration', 'Integration with Rippling for onboarding and payroll sync', 'integration', 'medium'),
  ('AI Q&A Assistant', 'AI chatbot for provider and member support questions', 'ai', 'medium'),
  ('Cohort-Based Staffing', 'Support for cohort-based staffing models', 'workflow', 'low'),
  ('Box Sign Integration', 'Automated agreement signing via Box Sign', 'integration', 'medium');

-- 2. Sensitive Data Access Log
CREATE TABLE public.sensitive_data_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  field_name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'profile',
  entity_id uuid,
  detected_pattern text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sensitive_data_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sensitive data log" ON public.sensitive_data_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert sensitive data log" ON public.sensitive_data_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 3. System Configuration (for MVP mode flag, compliance windows, etc.)
CREATE TABLE public.system_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read config" ON public.system_config
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage config" ON public.system_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed MVP mode and compliance window config
INSERT INTO public.system_config (key, value, description) VALUES
  ('mvp_mode', '{"enabled": true, "message": "This platform is operating in parallel with existing tools. No destructive actions without confirmation."}'::jsonb, 'MVP parallel-system mode indicator'),
  ('compliance_at_risk_days', '{"value": 30}'::jsonb, 'Days before expiration to flag as At Risk'),
  ('prohibited_data_patterns', '{"patterns": ["SSN", "social security", "bank account", "routing number", "tax id", "EIN"]}'::jsonb, 'Patterns to warn about when entering data');

-- 4. Add task_purpose and compliance_risk fields to agreement_tasks
ALTER TABLE public.agreement_tasks
  ADD COLUMN IF NOT EXISTS task_purpose text,
  ADD COLUMN IF NOT EXISTS compliance_risk text,
  ADD COLUMN IF NOT EXISTS expected_outcome text,
  ADD COLUMN IF NOT EXISTS checklist_items jsonb DEFAULT '[]'::jsonb;

-- 5. Compliance Status Log for auditing computed status changes
CREATE TABLE public.compliance_status_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id uuid NOT NULL,
  state_abbreviation text NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  reason text,
  computed_from jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view compliance log" ON public.compliance_status_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert compliance log" ON public.compliance_status_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 6. Add compliance_status to provider_state_status for computed display
ALTER TABLE public.provider_state_status
  ADD COLUMN IF NOT EXISTS compliance_status text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS compliance_reason text;

-- 7. Transfer workflow checklist tracking (extend agreement_transfers)
ALTER TABLE public.agreement_transfers
  ADD COLUMN IF NOT EXISTS checklist_items jsonb DEFAULT '[
    {"key": "termination_notice_sent", "label": "Termination notice sent to current physician", "completed": false, "completed_at": null, "completed_by": null},
    {"key": "termination_agreement_uploaded", "label": "Termination agreement document uploaded", "completed": false, "completed_at": null, "completed_by": null},
    {"key": "np_notified", "label": "NP(s) notified of physician change", "completed": false, "completed_at": null, "completed_by": null},
    {"key": "physician_notified", "label": "New physician notified and accepted", "completed": false, "completed_at": null, "completed_by": null},
    {"key": "new_collaboration_initiated", "label": "New collaborative agreement initiated", "completed": false, "completed_at": null, "completed_by": null},
    {"key": "new_agreement_signed", "label": "New agreement signed by all parties", "completed": false, "completed_at": null, "completed_by": null},
    {"key": "meeting_scheduled", "label": "Required supervision meeting scheduled", "completed": false, "completed_at": null, "completed_by": null},
    {"key": "chart_review_linked", "label": "Chart review folder linked", "completed": false, "completed_at": null, "completed_by": null}
  ]'::jsonb;
