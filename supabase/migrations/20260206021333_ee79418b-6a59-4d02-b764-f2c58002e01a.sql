-- Enable pg_cron and pg_net extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Note: The cron jobs will be configured separately via SQL insert
-- to avoid including project-specific URLs in migrations