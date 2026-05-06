-- Pivot: drop the parallel `published_shifts` table introduced earlier and
-- reuse `shift_recommendations` as the canonical per-shift source. The
-- evaluator already writes one row per accepted shift to that table with the
-- assigned state, hours, and time — duplicating it was a mistake.
--
-- The existing `publish_status` text column on shift_recommendations already
-- supports the Homebase step ('pending' → 'published_to_homebase'). We add
-- two columns for the EHR step so the linear flow becomes:
--   pending → published_to_homebase → confirmed (with EHR ts/actor recorded)

DROP TABLE IF EXISTS public.published_shifts CASCADE;

ALTER TABLE public.shift_recommendations
  ADD COLUMN IF NOT EXISTS ehr_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ehr_posted_by uuid;

COMMENT ON COLUMN public.shift_recommendations.ehr_posted_at IS
  'When this shift was transferred to the EHR. Set after Homebase posting.';
COMMENT ON COLUMN public.shift_recommendations.ehr_posted_by IS
  'User who confirmed the EHR transfer.';

-- Make sure scheduling staff can update publish state on shift_recommendations.
-- The base table policy is permissive (true), but we add a named scheduling
-- policy so future tightening doesn't accidentally lock these users out.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'shift_recommendations' AND relrowsecurity = true
  ) THEN
    DROP POLICY IF EXISTS "Scheduling staff manage shift recommendations" ON public.shift_recommendations;
    CREATE POLICY "Scheduling staff manage shift recommendations"
      ON public.shift_recommendations FOR ALL
      USING (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'pod_lead'::app_role)
        OR public.has_role(auth.uid(), 'scheduling'::app_role)
      )
      WITH CHECK (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'pod_lead'::app_role)
        OR public.has_role(auth.uid(), 'scheduling'::app_role)
      );
  END IF;
END $$;
