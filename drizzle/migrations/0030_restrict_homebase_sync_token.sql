REVOKE ALL ON public.homebase_rate_sync_state FROM anon, authenticated;
GRANT SELECT (key, value, updated_at) ON public.homebase_rate_sync_state TO authenticated;
GRANT ALL ON public.homebase_rate_sync_state TO service_role;