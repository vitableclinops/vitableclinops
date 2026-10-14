CREATE TABLE IF NOT EXISTS public.internal_cron_tokens (
  name text PRIMARY KEY,
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.internal_cron_tokens FROM anon, authenticated;
GRANT ALL ON public.internal_cron_tokens TO service_role;
ALTER TABLE public.internal_cron_tokens ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.internal_cron_tokens IS 'Shared tokens for pg_cron -> edge function calls. No policies: only service_role / postgres can read.';
INSERT INTO public.internal_cron_tokens (name) VALUES ('medallion_directory') ON CONFLICT DO NOTHING;