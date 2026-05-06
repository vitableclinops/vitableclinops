-- Scheduling Workbench core schema (Step 2)
-- Adds normalized scheduling tables while preserving existing tables.

-- Enums
DO $$ BEGIN
  CREATE TYPE public.provider_classification AS ENUM ('telehealth_1099', 'salaried', 'salaried_supervisor', 'agency');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.provider_status AS ENUM ('active', 'onboarding', 'paused', 'terminated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.shift_type AS ENUM ('NP_Telemedicine', 'NP_InHome', 'MH_LPC', 'MH_Coach', 'Health_Coaching');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.proposed_shift_status AS ENUM ('proposed', 'accepted', 'edited', 'rejected', 'gap');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.activation_recommendation_status AS ENUM ('suggested', 'approved', 'dismissed', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.outreach_channel AS ENUM ('slack', 'gmail');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.outreach_context AS ENUM ('gap_fill', 'overdue_reminder', 'edit_followup', 'activation_request');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.publish_step_status AS ENUM ('pending', 'completed', 'needs_republish');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend providers table with required columns when missing
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS vitable_email text,
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS npi text,
  ADD COLUMN IF NOT EXISTS status public.provider_status,
  ADD COLUMN IF NOT EXISTS cohort text,
  ADD COLUMN IF NOT EXISTS classification public.provider_classification,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS minimum_age integer,
  ADD COLUMN IF NOT EXISTS hire_date date,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_schedule jsonb;

-- Provider state status extensions
ALTER TABLE public.provider_state_status
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS license_expires date,
  ADD COLUMN IF NOT EXISTS collab_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS collab_status text,
  ADD COLUMN IF NOT EXISTS collab_physician_id uuid,
  ADD COLUMN IF NOT EXISTS collab_signed_date date,
  ADD COLUMN IF NOT EXISTS rxa_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ehr_active boolean DEFAULT false;

-- Cohorts
CREATE TABLE IF NOT EXISTS public.cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  states text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Forecast overrides
CREATE TABLE IF NOT EXISTS public.forecast_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL,
  state text NOT NULL,
  cohort text NOT NULL,
  weekday_target_hours numeric(8,2) NOT NULL,
  weekend_target_hours numeric(8,2) NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(month, state, cohort)
);

-- Unmatched jotform submissions
CREATE TABLE IF NOT EXISTS public.unmatched_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jotform_submission_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  attempted_email text,
  resolved_to_provider_id uuid REFERENCES public.providers(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(jotform_submission_id)
);

-- Ensure schedule_submissions has v2 fields
ALTER TABLE public.schedule_submissions
  ADD COLUMN IF NOT EXISTS month date,
  ADD COLUMN IF NOT EXISTS is_edit_of_id uuid REFERENCES public.schedule_submissions(id),
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

-- Shift submissions (v2 normalized)
CREATE TABLE IF NOT EXISTS public.shift_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_submission_id uuid NOT NULL REFERENCES public.schedule_submissions(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  shift_type public.shift_type NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Proposed shifts
CREATE TABLE IF NOT EXISTS public.proposed_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.providers(id),
  date date NOT NULL,
  start_time time,
  end_time time,
  shift_type public.shift_type,
  cohort text,
  state text,
  status public.proposed_shift_status NOT NULL DEFAULT 'proposed',
  source_submission_id uuid REFERENCES public.schedule_submissions(id),
  recommendation_score numeric(8,4),
  conflict_flags text[] NOT NULL DEFAULT '{}',
  requires_activation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Activation recommendations
CREATE TABLE IF NOT EXISTS public.activation_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL,
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  state text NOT NULL,
  hours_unlockable numeric(8,2) NOT NULL DEFAULT 0,
  related_gap_dates date[] NOT NULL DEFAULT '{}',
  status public.activation_recommendation_status NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(month, provider_id, state)
);

-- Publish checklist
CREATE TABLE IF NOT EXISTS public.publish_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date date NOT NULL UNIQUE,
  homebase_status public.publish_step_status NOT NULL DEFAULT 'pending',
  homebase_completed_by uuid,
  homebase_completed_at timestamptz,
  ehr_status public.publish_step_status NOT NULL DEFAULT 'pending',
  ehr_completed_by uuid,
  ehr_completed_at timestamptz,
  qa_status public.publish_step_status NOT NULL DEFAULT 'pending',
  qa_completed_by uuid,
  qa_completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Coverage snapshots
CREATE TABLE IF NOT EXISTS public.coverage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  state text NOT NULL,
  target_slots integer NOT NULL DEFAULT 0,
  actual_slots integer NOT NULL DEFAULT 0,
  sla_pct numeric(5,2),
  zero_critical_low_ok text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(snapshot_date, state)
);

-- Outreach log
CREATE TABLE IF NOT EXISTS public.outreach_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.providers(id),
  channel public.outreach_channel NOT NULL,
  context public.outreach_context NOT NULL,
  message_preview text,
  drafted_at timestamptz NOT NULL DEFAULT now(),
  drafted_by uuid,
  sent_confirmed_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schedule_submissions_provider_month ON public.schedule_submissions(provider_id, month);
CREATE INDEX IF NOT EXISTS idx_shift_submissions_submission_date ON public.shift_submissions(schedule_submission_id, date);
CREATE INDEX IF NOT EXISTS idx_proposed_shifts_date_state_cohort ON public.proposed_shifts(date, state, cohort);
CREATE INDEX IF NOT EXISTS idx_activation_reco_month_state ON public.activation_recommendations(month, state);
CREATE INDEX IF NOT EXISTS idx_coverage_snapshots_date ON public.coverage_snapshots(snapshot_date);

-- Enable RLS
ALTER TABLE public.cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unmatched_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposed_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publish_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_log ENABLE ROW LEVEL SECURITY;

-- Policies (idempotent)
DROP POLICY IF EXISTS "ClinOps manage schedule submissions" ON public.schedule_submissions;
CREATE POLICY "ClinOps manage schedule submissions" ON public.schedule_submissions
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "ClinOps manage shift submissions" ON public.shift_submissions;
CREATE POLICY "ClinOps manage shift submissions" ON public.shift_submissions
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "ClinOps manage proposed shifts" ON public.proposed_shifts;
CREATE POLICY "ClinOps manage proposed shifts" ON public.proposed_shifts
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "ClinOps manage publish checklist" ON public.publish_checklist;
CREATE POLICY "ClinOps manage publish checklist" ON public.publish_checklist
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "ClinOps manage activation recommendations" ON public.activation_recommendations;
CREATE POLICY "ClinOps manage activation recommendations" ON public.activation_recommendations
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read coverage snapshots" ON public.coverage_snapshots;
CREATE POLICY "Authenticated read coverage snapshots" ON public.coverage_snapshots
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated read forecast overrides" ON public.forecast_overrides;
CREATE POLICY "Authenticated read forecast overrides" ON public.forecast_overrides
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins manage forecast overrides" ON public.forecast_overrides;
CREATE POLICY "Admins manage forecast overrides" ON public.forecast_overrides
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "ClinOps manage outreach log" ON public.outreach_log;
CREATE POLICY "ClinOps manage outreach log" ON public.outreach_log
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "ClinOps manage unmatched submissions" ON public.unmatched_submissions;
CREATE POLICY "ClinOps manage unmatched submissions" ON public.unmatched_submissions
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);
