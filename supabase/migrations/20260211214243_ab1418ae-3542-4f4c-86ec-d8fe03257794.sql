
-- =============================================
-- LICENSURE APPLICATION WORKFLOW SCHEMA
-- =============================================

-- 1. State licensure templates: admin-managed step templates per state
CREATE TABLE public.state_licensure_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state_abbreviation TEXT NOT NULL,
  designation_type TEXT NOT NULL DEFAULT 'initial_license', -- initial_license, autonomous_practice, telehealth_registration, etc.
  designation_label TEXT NOT NULL DEFAULT 'NP License', -- e.g. "NP License", "Autonomous Practice Designation"
  sort_order INTEGER NOT NULL DEFAULT 0,
  application_url TEXT,
  estimated_fee NUMERIC,
  estimated_timeline TEXT, -- e.g. "4-6 weeks"
  notes TEXT, -- gotchas, tips
  required_documents TEXT[], -- e.g. ['Official transcripts', 'Background check', 'Passport photo']
  steps JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{title, description, is_required, sort_order}]
  kb_article_id UUID REFERENCES public.kb_articles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(state_abbreviation, designation_type)
);

ALTER TABLE public.state_licensure_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage templates" ON public.state_licensure_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Authenticated users can view active templates" ON public.state_licensure_templates
  FOR SELECT USING (is_active = true AND auth.uid() IS NOT NULL);


-- 2. Licensure applications: tracks each provider×state application
CREATE TYPE public.licensure_application_status AS ENUM (
  'not_started', 'in_progress', 'submitted', 'approved', 'blocked', 'withdrawn'
);

CREATE TABLE public.licensure_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id UUID NOT NULL,
  provider_name TEXT NOT NULL,
  provider_email TEXT,
  state_abbreviation TEXT NOT NULL,
  state_name TEXT NOT NULL,
  designation_type TEXT NOT NULL DEFAULT 'initial_license',
  designation_label TEXT NOT NULL DEFAULT 'NP License',
  template_id UUID REFERENCES public.state_licensure_templates(id),
  status public.licensure_application_status NOT NULL DEFAULT 'not_started',
  
  -- Dates
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  initiated_by UUID,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  
  -- Downstream awareness
  ca_requirement_type TEXT, -- 'never', 'always', 'conditional'
  ca_awareness_dismissed BOOLEAN DEFAULT false,
  
  -- Linked entities
  agreement_task_id UUID REFERENCES public.agreement_tasks(id), -- the task assigned to the provider
  license_id UUID REFERENCES public.provider_licenses(id), -- linked once approved
  kb_article_id UUID REFERENCES public.kb_articles(id), -- state-specific KB article
  
  -- Meta
  notes TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(provider_id, state_abbreviation, designation_type)
);

ALTER TABLE public.licensure_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all applications" ON public.licensure_applications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Providers can view own applications" ON public.licensure_applications
  FOR SELECT USING (provider_id = auth.uid());

CREATE POLICY "Providers can update own applications" ON public.licensure_applications
  FOR UPDATE USING (provider_id = auth.uid())
  WITH CHECK (provider_id = auth.uid());


-- 3. Licensure application steps: per-application step tracking
CREATE TYPE public.licensure_step_status AS ENUM (
  'not_started', 'in_progress', 'submitted', 'approved', 'skipped'
);

CREATE TABLE public.licensure_application_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.licensure_applications(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  is_required BOOLEAN NOT NULL DEFAULT true,
  status public.licensure_step_status NOT NULL DEFAULT 'not_started',
  
  -- Tracking
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  submitted_date DATE, -- provider-entered "submitted on" date
  
  -- Uploads
  uploaded_file_url TEXT,
  uploaded_file_name TEXT,
  uploaded_at TIMESTAMPTZ,
  
  -- Notes
  provider_notes TEXT,
  admin_notes TEXT,
  
  -- Fee tracking (for reimbursement)
  fee_amount NUMERIC,
  fee_receipt_url TEXT,
  fee_receipt_uploaded_at TIMESTAMPTZ,
  reimbursement_status TEXT DEFAULT 'none', -- none, ready, submitted, approved, processed
  reimbursement_request_id UUID REFERENCES public.reimbursement_requests(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.licensure_application_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all steps" ON public.licensure_application_steps
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Providers can view own steps" ON public.licensure_application_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.licensure_applications la
      WHERE la.id = application_id AND la.provider_id = auth.uid()
    )
  );

CREATE POLICY "Providers can update own steps" ON public.licensure_application_steps
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.licensure_applications la
      WHERE la.id = application_id AND la.provider_id = auth.uid()
    )
  );


-- 4. Trigger for updated_at
CREATE TRIGGER update_licensure_applications_updated_at
  BEFORE UPDATE ON public.licensure_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_licensure_application_steps_updated_at
  BEFORE UPDATE ON public.licensure_application_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_state_licensure_templates_updated_at
  BEFORE UPDATE ON public.state_licensure_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 5. Indexes
CREATE INDEX idx_licensure_applications_provider ON public.licensure_applications(provider_id);
CREATE INDEX idx_licensure_applications_state ON public.licensure_applications(state_abbreviation);
CREATE INDEX idx_licensure_applications_status ON public.licensure_applications(status);
CREATE INDEX idx_licensure_application_steps_app ON public.licensure_application_steps(application_id);
CREATE INDEX idx_state_licensure_templates_state ON public.state_licensure_templates(state_abbreviation);
