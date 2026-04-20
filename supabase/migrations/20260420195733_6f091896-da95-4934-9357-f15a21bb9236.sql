-- Generic vault upsert for use by seed-vault-secrets edge function
CREATE OR REPLACE FUNCTION public.upsert_vault_secret(p_name text, p_value text, p_description text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_value IS NULL OR length(p_value) = 0 OR p_name IS NULL OR length(p_name) = 0 THEN
    RAISE EXCEPTION 'name and value are required';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name, COALESCE(p_description, 'Managed by edge function'));
  ELSE
    PERFORM vault.update_secret(v_id, p_value);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_vault_secret(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_vault_secret(text, text, text) TO service_role;