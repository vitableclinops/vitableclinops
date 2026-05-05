-- RLS posture: lock down to service_role only. The daily report runs server-side
-- with the service_role key. No anon/authenticated access until a frontend exists.

alter table public.providers                  enable row level security;
alter table public.provider_licenses          enable row level security;
alter table public.provider_utilization_daily enable row level security;

-- Service role bypasses RLS automatically; these policies make the deny-by-default
-- explicit and keep the migration idempotent.
drop policy if exists "no anon access" on public.providers;
create policy "no anon access" on public.providers
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "no anon access" on public.provider_licenses;
create policy "no anon access" on public.provider_licenses
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "no anon access" on public.provider_utilization_daily;
create policy "no anon access" on public.provider_utilization_daily
  for all to anon, authenticated using (false) with check (false);

-- The RPC stays callable but returns only what RLS lets the caller see; with
-- service_role, that's everything. Lock down EXECUTE just to be tidy.
revoke all on function public.get_activation_candidates(text[], numeric, integer, text[]) from public;
grant execute on function public.get_activation_candidates(text[], numeric, integer, text[]) to service_role;
