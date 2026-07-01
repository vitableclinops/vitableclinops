alter table public.coverage_alerts
  add column if not exists slack_parent_ts text,
  add column if not exists slack_thread_ts text,
  add column if not exists slack_channel_id text;

comment on column public.coverage_alerts.slack_parent_ts is
  'Slack message timestamp for the top-level same-day / next-day coverage alert.';

comment on column public.coverage_alerts.slack_thread_ts is
  'Slack message timestamp for the VA handoff thread reply containing emails and draft copy.';

comment on column public.coverage_alerts.slack_channel_id is
  'Slack channel where the coverage alert was posted.';
