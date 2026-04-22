-- Coverage ping: add provider Slack IDs + audit log for sent DMs.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS slack_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_slack_user_id
  ON public.profiles(slack_user_id)
  WHERE slack_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.coverage_ping_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by_slack_user_id TEXT NOT NULL,
  sent_by_name TEXT,
  state_abbreviation TEXT NOT NULL,
  target_date DATE NOT NULL,
  provider_profile_ids UUID[] NOT NULL,
  provider_slack_user_ids TEXT[] NOT NULL,
  skipped_provider_profile_ids UUID[] NOT NULL DEFAULT '{}',
  channel TEXT NOT NULL DEFAULT 'slack_dm',
  message_text TEXT NOT NULL,
  source_channel_id TEXT,
  source_message_ts TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_details JSONB
);

CREATE INDEX IF NOT EXISTS idx_coverage_ping_log_sent_at
  ON public.coverage_ping_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_coverage_ping_log_state_date
  ON public.coverage_ping_log(state_abbreviation, target_date);

ALTER TABLE public.coverage_ping_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read coverage_ping_log"
  ON public.coverage_ping_log
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Writes only via service role (edge functions); no insert policy for normal users.
