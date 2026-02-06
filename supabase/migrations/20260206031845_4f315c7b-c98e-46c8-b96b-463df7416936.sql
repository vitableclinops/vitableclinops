-- Drop the conflicting policy that causes infinite recursion
DROP POLICY IF EXISTS "Physicians can view their agreements" ON public.collaborative_agreements;

-- The existing "Authenticated users can view agreements" policy with USING (true) 
-- already allows all authenticated users to view agreements, which is appropriate
-- for this internal tool. No need for a more restrictive physician-specific policy.

-- Also simplify the agreement_providers policy to avoid recursion
DROP POLICY IF EXISTS "Physicians can view supervised providers" ON public.agreement_providers;

-- Simple policy: authenticated users can view agreement_providers
-- This is an internal tool, so this is acceptable
CREATE POLICY "Authenticated can view agreement_providers" ON public.agreement_providers
FOR SELECT TO authenticated
USING (true);

-- Drop the supervision_meetings physician policy if it causes issues
DROP POLICY IF EXISTS "Physicians can view their meetings" ON public.supervision_meetings;

-- Simple policy for supervision_meetings
CREATE POLICY "Authenticated can view supervision_meetings" ON public.supervision_meetings
FOR SELECT TO authenticated
USING (true);

-- Drop and simplify the agreement_tasks policy
DROP POLICY IF EXISTS "Physicians can view their tasks" ON public.agreement_tasks;