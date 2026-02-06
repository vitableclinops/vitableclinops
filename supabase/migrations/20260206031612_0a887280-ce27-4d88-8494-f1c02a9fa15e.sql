-- Add physician_id to supervision_meetings for direct querying
ALTER TABLE public.supervision_meetings
ADD COLUMN IF NOT EXISTS physician_id uuid REFERENCES public.profiles(id);

-- Create index for faster physician lookups
CREATE INDEX IF NOT EXISTS idx_supervision_meetings_physician_id 
ON public.supervision_meetings(physician_id);

-- Backfill physician_id from the linked agreement
UPDATE public.supervision_meetings sm
SET physician_id = ca.physician_id
FROM public.collaborative_agreements ca
WHERE sm.agreement_id = ca.id
AND sm.physician_id IS NULL
AND ca.physician_id IS NOT NULL;

-- Create RLS policies for physician portal access
-- Physicians can view meetings for their agreements
DROP POLICY IF EXISTS "Physicians can view their meetings" ON public.supervision_meetings;
CREATE POLICY "Physicians can view their meetings" ON public.supervision_meetings
FOR SELECT TO authenticated
USING (
  physician_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.collaborative_agreements ca
    WHERE ca.id = supervision_meetings.agreement_id
    AND ca.physician_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin')
);

-- Physicians can view their supervised providers via agreement_providers
DROP POLICY IF EXISTS "Physicians can view supervised providers" ON public.agreement_providers;
CREATE POLICY "Physicians can view supervised providers" ON public.agreement_providers
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.collaborative_agreements ca
    WHERE ca.id = agreement_providers.agreement_id
    AND ca.physician_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'provider')
);

-- Physicians can view their own agreements
DROP POLICY IF EXISTS "Physicians can view their agreements" ON public.collaborative_agreements;
CREATE POLICY "Physicians can view their agreements" ON public.collaborative_agreements
FOR SELECT TO authenticated
USING (
  physician_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'leadership')
  OR EXISTS (
    SELECT 1 FROM public.agreement_providers ap
    WHERE ap.agreement_id = collaborative_agreements.id
    AND ap.provider_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
);

-- Physicians can view tasks assigned to them or for their agreements
DROP POLICY IF EXISTS "Physicians can view their tasks" ON public.agreement_tasks;
CREATE POLICY "Physicians can view their tasks" ON public.agreement_tasks
FOR SELECT TO authenticated
USING (
  physician_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR assigned_to = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR provider_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.collaborative_agreements ca
    WHERE ca.id = agreement_tasks.agreement_id
    AND ca.physician_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin')
);