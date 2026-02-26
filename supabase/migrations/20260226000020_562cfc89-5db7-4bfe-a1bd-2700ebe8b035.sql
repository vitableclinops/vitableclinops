
-- 1. collaborative_agreements: restrict to admins, linked physicians, and linked providers
DROP POLICY IF EXISTS "Authenticated users can view agreements" ON collaborative_agreements;
CREATE POLICY "Scoped agreement read access" ON collaborative_agreements FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR id IN (
    SELECT agreement_id FROM agreement_providers
    WHERE provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      AND is_active = true
  )
);

-- 2. agreement_providers: restrict to admins, linked physicians (via agreement), and the provider themselves
DROP POLICY IF EXISTS "Authenticated users can view agreement providers" ON agreement_providers;
CREATE POLICY "Scoped agreement_providers read access" ON agreement_providers FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR agreement_id IN (
    SELECT id FROM collaborative_agreements
    WHERE physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
);

-- 3. agreement_workflow_steps: restrict to admins and agreement participants
DROP POLICY IF EXISTS "Authenticated users can view workflow steps" ON agreement_workflow_steps;
DROP POLICY IF EXISTS "Authenticated users can manage workflow steps" ON agreement_workflow_steps;
CREATE POLICY "Scoped workflow steps read" ON agreement_workflow_steps FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR agreement_id IN (
    SELECT id FROM collaborative_agreements
    WHERE physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
       OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
  OR agreement_id IN (
    SELECT agreement_id FROM agreement_providers
    WHERE provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) AND is_active = true
  )
);
CREATE POLICY "Admin manage workflow steps" ON agreement_workflow_steps FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. agreement_notifications: restrict to admins only
DROP POLICY IF EXISTS "Authenticated users can view notifications" ON agreement_notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON agreement_notifications;
CREATE POLICY "Admin view notifications" ON agreement_notifications FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin create notifications" ON agreement_notifications FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 5. agency_contacts: restrict to admins and providers linked to that agency
DROP POLICY IF EXISTS "Authenticated users can view agency contacts" ON agency_contacts;
CREATE POLICY "Scoped agency contacts read" ON agency_contacts FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR agency_id IN (SELECT agency_id FROM profiles WHERE user_id = auth.uid() AND agency_id IS NOT NULL)
);

-- 6. agency_documents: restrict to admins and providers linked to that agency
DROP POLICY IF EXISTS "Authenticated users can view agency documents" ON agency_documents;
CREATE POLICY "Scoped agency documents read" ON agency_documents FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR agency_id IN (SELECT agency_id FROM profiles WHERE user_id = auth.uid() AND agency_id IS NOT NULL)
);

-- 7. supervision_meetings: restrict to admins, linked physicians, and providers on the agreement
DROP POLICY IF EXISTS "Authenticated users can view meetings" ON supervision_meetings;
CREATE POLICY "Scoped meetings read" ON supervision_meetings FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR agreement_id IN (
    SELECT id FROM collaborative_agreements
    WHERE physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
  OR agreement_id IN (
    SELECT agreement_id FROM agreement_providers
    WHERE provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) AND is_active = true
  )
);

-- 8. meeting_attendees: restrict to admins, the attendee themselves, and the meeting physician
DROP POLICY IF EXISTS "Authenticated users can view meeting attendees" ON meeting_attendees;
CREATE POLICY "Scoped meeting_attendees read" ON meeting_attendees FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  OR meeting_id IN (
    SELECT sm.id FROM supervision_meetings sm
    JOIN collaborative_agreements ca ON ca.id = sm.agreement_id
    WHERE ca.physician_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  )
);

-- 9. agencies: restrict to admins and providers linked to agency
DROP POLICY IF EXISTS "Authenticated users can view agencies" ON agencies;
CREATE POLICY "Scoped agencies read" ON agencies FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR id IN (SELECT agency_id FROM profiles WHERE user_id = auth.uid() AND agency_id IS NOT NULL)
);

-- 10. collaborative_agreements UPDATE/INSERT: restrict to admins only
DROP POLICY IF EXISTS "Authenticated users can update agreements" ON collaborative_agreements;
DROP POLICY IF EXISTS "Authenticated users can create agreements" ON collaborative_agreements;
CREATE POLICY "Admin update agreements" ON collaborative_agreements FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admin create agreements" ON collaborative_agreements FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
