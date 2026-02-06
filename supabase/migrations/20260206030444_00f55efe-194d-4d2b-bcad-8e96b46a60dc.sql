-- ================================================================
-- ALL-HANDS ATTESTATION SYSTEM + CALENDAR ENHANCEMENTS
-- ================================================================

-- 1) Create calendar_events table for company-wide events
-- We keep supervision_meetings for agreement-specific meetings, but add calendar_events for All-Hands
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  event_type text NOT NULL DEFAULT 'provider_all_hands', -- provider_all_hands, training, town_hall, etc.
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text DEFAULT 'America/Chicago',
  recurrence_rule text, -- iCal RRULE format
  parent_event_id uuid REFERENCES public.calendar_events(id) ON DELETE CASCADE, -- for recurring instances
  meeting_link text,
  recording_link text,
  newsletter_article_id uuid REFERENCES public.kb_articles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled', -- scheduled, completed, cancelled
  attestation_required boolean DEFAULT false,
  attestation_due_days integer DEFAULT 7, -- days after event to complete attestation
  total_providers integer DEFAULT 0, -- snapshot at task generation time
  completed_attestations integer DEFAULT 0, -- cached count
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Create attestation status enum
DO $$ BEGIN
  CREATE TYPE public.attestation_status AS ENUM ('pending', 'completed', 'overdue', 'excused');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3) Create event_attestations table
CREATE TABLE IF NOT EXISTS public.event_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  provider_email text,
  task_id uuid REFERENCES public.agreement_tasks(id) ON DELETE SET NULL,
  status attestation_status NOT NULL DEFAULT 'pending',
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  completed_by_user_id uuid,
  completion_source text DEFAULT 'provider_task', -- provider_task, admin_override, bulk_complete
  is_active_at_creation boolean DEFAULT true, -- snapshot of provider status
  pod_id uuid REFERENCES public.pods(id) ON DELETE SET NULL,
  reminder_count integer DEFAULT 0,
  last_reminder_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, provider_id)
);

-- 4) Add all_hands_attestation to agreement_task_category enum
-- First check if it exists, then add if not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'all_hands_attestation' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'agreement_task_category')
  ) THEN
    ALTER TYPE public.agreement_task_category ADD VALUE 'all_hands_attestation';
  END IF;
END $$;

-- 5) Add related_event_id and links_json to agreement_tasks
ALTER TABLE public.agreement_tasks
  ADD COLUMN IF NOT EXISTS related_event_id uuid REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS links_json jsonb;

-- 6) Create event_activity_log for audit trail
CREATE TABLE IF NOT EXISTS public.event_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  activity_type text NOT NULL, -- event_created, event_updated, tasks_generated, attestation_completed, follow_up_created
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name text,
  actor_role text,
  description text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7) Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_calendar_events_type ON public.calendar_events(event_type);
CREATE INDEX IF NOT EXISTS idx_calendar_events_starts_at ON public.calendar_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON public.calendar_events(status);
CREATE INDEX IF NOT EXISTS idx_event_attestations_event ON public.event_attestations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_attestations_provider ON public.event_attestations(provider_id);
CREATE INDEX IF NOT EXISTS idx_event_attestations_status ON public.event_attestations(status);
CREATE INDEX IF NOT EXISTS idx_event_attestations_due ON public.event_attestations(due_at);
CREATE INDEX IF NOT EXISTS idx_agreement_tasks_event ON public.agreement_tasks(related_event_id);
CREATE INDEX IF NOT EXISTS idx_event_activity_log_event ON public.event_activity_log(event_id);

-- 8) Enable RLS
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_activity_log ENABLE ROW LEVEL SECURITY;

-- 9) RLS Policies for calendar_events
-- Everyone can view scheduled events
CREATE POLICY "Everyone can view calendar events"
  ON public.calendar_events FOR SELECT
  TO authenticated
  USING (true);

-- Admins can manage events
CREATE POLICY "Admins can insert calendar events"
  ON public.calendar_events FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update calendar events"
  ON public.calendar_events FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete calendar events"
  ON public.calendar_events FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 10) RLS Policies for event_attestations
-- Providers can view their own attestations
CREATE POLICY "Providers can view own attestations"
  ON public.event_attestations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = event_attestations.provider_id
      AND p.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'leadership')
  );

-- Providers can update their own attestations (to complete)
CREATE POLICY "Providers can update own attestations"
  ON public.event_attestations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = event_attestations.provider_id
      AND p.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- Admins can insert attestations
CREATE POLICY "Admins can insert attestations"
  ON public.event_attestations FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 11) RLS Policies for event_activity_log
CREATE POLICY "Admins can view event activity"
  ON public.event_activity_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'leadership'));

CREATE POLICY "Admins can insert event activity"
  ON public.event_activity_log FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 12) Trigger for updated_at
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_event_attestations_updated_at
  BEFORE UPDATE ON public.event_attestations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 13) Function to update attestation counts on calendar_events
CREATE OR REPLACE FUNCTION public.update_attestation_counts()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.calendar_events
  SET completed_attestations = (
    SELECT COUNT(*) FROM public.event_attestations
    WHERE event_id = COALESCE(NEW.event_id, OLD.event_id)
    AND status = 'completed'
  )
  WHERE id = COALESCE(NEW.event_id, OLD.event_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_attestation_counts_trigger
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.event_attestations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_attestation_counts();