create extension if not exists supabase_vault with schema vault;

create or replace function public.get_slack_oauth_credentials()
returns table (
  access_token text,
  refresh_token text,
  client_id text,
  client_secret text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;

  return query
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'slack_access_token') as access_token,
    (select decrypted_secret from vault.decrypted_secrets where name = 'slack_refresh_token') as refresh_token,
    (select decrypted_secret from vault.decrypted_secrets where name = 'slack_client_id') as client_id,
    (select decrypted_secret from vault.decrypted_secrets where name = 'slack_client_secret') as client_secret,
    nullif((select decrypted_secret from vault.decrypted_secrets where name = 'slack_access_token_expires_at'), '')::timestamptz as expires_at;
end;
$$;

create or replace function public.update_slack_oauth_credentials(
  new_access_token text,
  new_refresh_token text,
  new_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_secret_id uuid;
  refresh_secret_id uuid;
  expires_secret_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select id into access_secret_id from vault.decrypted_secrets where name = 'slack_access_token';
  if access_secret_id is null then
    perform vault.create_secret(
      new_access_token,
      'slack_access_token',
      'Rotating Slack OAuth access token for same-next-day coverage alerts'
    );
  else
    perform vault.update_secret(
      access_secret_id,
      new_access_token,
      'slack_access_token',
      'Rotating Slack OAuth access token for same-next-day coverage alerts'
    );
  end if;

  select id into refresh_secret_id from vault.decrypted_secrets where name = 'slack_refresh_token';
  if refresh_secret_id is null then
    perform vault.create_secret(
      new_refresh_token,
      'slack_refresh_token',
      'Rotating Slack OAuth refresh token for same-next-day coverage alerts'
    );
  else
    perform vault.update_secret(
      refresh_secret_id,
      new_refresh_token,
      'slack_refresh_token',
      'Rotating Slack OAuth refresh token for same-next-day coverage alerts'
    );
  end if;

  select id into expires_secret_id from vault.decrypted_secrets where name = 'slack_access_token_expires_at';
  if expires_secret_id is null then
    perform vault.create_secret(
      new_expires_at::text,
      'slack_access_token_expires_at',
      'Expiration timestamp for the rotating Slack OAuth access token'
    );
  else
    perform vault.update_secret(
      expires_secret_id,
      new_expires_at::text,
      'slack_access_token_expires_at',
      'Expiration timestamp for the rotating Slack OAuth access token'
    );
  end if;
end;
$$;

revoke all on function public.get_slack_oauth_credentials() from public, anon, authenticated;
grant execute on function public.get_slack_oauth_credentials() to service_role;

revoke all on function public.update_slack_oauth_credentials(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_slack_oauth_credentials(text, text, timestamptz) to service_role;
