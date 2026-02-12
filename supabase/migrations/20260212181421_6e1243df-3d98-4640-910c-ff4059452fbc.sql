
-- Add pod_lead_id to profiles, referencing another profile (the pod lead)
ALTER TABLE public.profiles
ADD COLUMN pod_lead_id uuid REFERENCES public.profiles(id);

-- Index for lookups
CREATE INDEX idx_profiles_pod_lead_id ON public.profiles(pod_lead_id);
