-- ─────────────────────────────────────────────────────────────────────────────
-- Reconcile provider_utilization schema
--
-- The original CREATE TABLE in 20260414190000_homebase_and_license_optimizer.sql
-- omitted `created_at` and used admin-only RLS that blocks the service role
-- (used by sync-metabase). This migration adds the missing column, drops the
-- over-restrictive policies, and replaces them with service-role-compatible ones.
--
-- Uses ALTER TABLE / IF NOT EXISTS / IF EXISTS throughout so it is safe to
-- run whether or not the original migration applied cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.provider_utilization
  add column if not exists created_at timestamptz not null default now();

-- Drop the original admin-only policies and replace with ones that let the
-- service role (used by sync-metabase) write, and authenticated users read.
drop policy if exists "Admins can manage provider_utilization" on public.provider_utilization;
drop policy if exists "Pod leads can view provider_utilization" on public.provider_utilization;
drop policy if exists "Authenticated users can view provider utilization" on public.provider_utilization;
drop policy if exists "Service role can insert provider utilization" on public.provider_utilization;

create policy "Authenticated users can view provider utilization"
  on public.provider_utilization for select
  to authenticated using (true);

create policy "Service role can manage provider utilization"
  on public.provider_utilization for all
  to service_role using (true) with check (true);
