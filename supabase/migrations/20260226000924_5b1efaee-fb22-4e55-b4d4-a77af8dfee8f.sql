
-- Create a SECURITY DEFINER helper to check agreement participation without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_agreement_participant(_user_id uuid, _agreement_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM collaborative_agreements
    WHERE id = _agreement_id
    AND (
      physician_id IN (SELECT id FROM profiles WHERE user_id = _user_id)
      OR provider_id IN (SELECT id FROM profiles WHERE user_id = _user_id)
    )
  )
  OR EXISTS (
    SELECT 1 FROM agreement_providers
    WHERE agreement_id = _agreement_id
    AND is_active = true
    AND provider_id IN (SELECT id FROM profiles WHERE user_id = _user_id)
  )
$$;

-- Fix collaborative_agreements: remove the recursive policy and replace with one using the helper
DROP POLICY IF EXISTS "Scoped agreement read access" ON collaborative_agreements;
CREATE POLICY "Scoped agreement read access" ON collaborative_agreements
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR id IN (
    SELECT ap.agreement_id FROM agreement_providers ap
    JOIN profiles p ON p.id = ap.provider_id
    WHERE p.user_id = auth.uid() AND ap.is_active = true
  )
);

-- Fix agreement_providers: remove the recursive policy, drop old permissive ones too
DROP POLICY IF EXISTS "Scoped agreement_providers read access" ON agreement_providers;
DROP POLICY IF EXISTS "Authenticated can view agreement_providers" ON agreement_providers;
DROP POLICY IF EXISTS "Authenticated users can manage agreement providers" ON agreement_providers;

-- Non-recursive policy: check provider_id or physician relationship via helper
CREATE POLICY "Scoped agreement_providers read" ON agreement_providers
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR is_agreement_participant(auth.uid(), agreement_id)
);

-- Admin-only write for agreement_providers
CREATE POLICY "Admin manage agreement_providers" ON agreement_providers
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Fix supervision_meetings: remove recursive policies
DROP POLICY IF EXISTS "Scoped meetings read" ON supervision_meetings;
DROP POLICY IF EXISTS "Authenticated can view supervision_meetings" ON supervision_meetings;
DROP POLICY IF EXISTS "Authenticated users can manage meetings" ON supervision_meetings;

CREATE POLICY "Scoped meetings read" ON supervision_meetings
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR is_agreement_participant(auth.uid(), agreement_id)
);

CREATE POLICY "Admin manage meetings" ON supervision_meetings
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Fix meeting_attendees: remove recursive policy
DROP POLICY IF EXISTS "Scoped meeting_attendees read" ON meeting_attendees;
DROP POLICY IF EXISTS "Authenticated users can manage meeting attendees" ON meeting_attendees;

CREATE POLICY "Scoped meeting_attendees read" ON meeting_attendees
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Admin manage meeting_attendees" ON meeting_attendees
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
