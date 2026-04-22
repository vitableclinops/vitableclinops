-- Add Slack user ID to profiles for direct messaging
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slack_user_id text;

CREATE INDEX IF NOT EXISTS idx_profiles_slack_user_id
  ON public.profiles(slack_user_id)
  WHERE slack_user_id IS NOT NULL;

-- Audit log for coverage outreach DMs sent via Slack
CREATE TABLE IF NOT EXISTS public.coverage_ping_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbreviation text NOT NULL,
  gap_hours numeric,
  recipient_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_slack_user_id text NOT NULL,
  recipient_name text,
  message_preview text,
  slack_dm_channel_id text,
  slack_dm_message_ts text,
  delivery_status text NOT NULL DEFAULT 'sent',
  error_message text,
  sent_by_slack_user_id text,
  sent_by_name text,
  source text NOT NULL DEFAULT 'ops_dashboard_thread',
  source_message_ts text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coverage_ping_log_state_date
  ON public.coverage_ping_log(state_abbreviation, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coverage_ping_log_recipient
  ON public.coverage_ping_log(recipient_profile_id, created_at DESC);

ALTER TABLE public.coverage_ping_log ENABLE ROW LEVEL SECURITY;

-- Admins and pod leads can view the audit log
CREATE POLICY "Admins and pod leads can view coverage ping log"
  ON public.coverage_ping_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'pod_lead'));

-- Only service role / edge functions write to it (no client insert policy)
