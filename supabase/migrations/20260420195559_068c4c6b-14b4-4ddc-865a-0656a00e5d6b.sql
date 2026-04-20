-- SECURITY DEFINER helper so the service role can update the vault copy of SYNC_SECRET
CREATE OR REPLACE FUNCTION public.sync_vault_metabase_secret(p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_value IS NULL OR length(p_value) = 0 THEN
    RETURN;
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'sync_metabase_secret';

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, 'sync_metabase_secret', 'Shared secret for sync-metabase pg_cron job');
  ELSE
    PERFORM vault.update_secret(v_id, p_value);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_vault_metabase_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_vault_metabase_secret(text) TO service_role;