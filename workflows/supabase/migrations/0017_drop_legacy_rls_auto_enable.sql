-- Drops a SECURITY DEFINER function left over from the prior project setup.
-- The function was callable by anon/authenticated, which the security advisor
-- flagged. Workflows don't use it; service_role + RLS handle access posture.

drop function if exists public.rls_auto_enable() cascade;
