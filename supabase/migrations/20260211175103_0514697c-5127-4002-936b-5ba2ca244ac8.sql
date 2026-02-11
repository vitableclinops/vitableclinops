
-- Junction table: link tasks to multiple provider profiles
CREATE TABLE public.task_linked_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.agreement_tasks(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL,
  role_label TEXT NOT NULL DEFAULT 'Provider',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, provider_id)
);

-- Index for fast lookups by provider (My Dashboard) and by task
CREATE INDEX idx_task_linked_providers_provider ON public.task_linked_providers(provider_id);
CREATE INDEX idx_task_linked_providers_task ON public.task_linked_providers(task_id);

-- Enable RLS
ALTER TABLE public.task_linked_providers ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins full access on task_linked_providers"
  ON public.task_linked_providers
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Providers can view their own links (for My Dashboard)
CREATE POLICY "Providers can view own linked tasks"
  ON public.task_linked_providers
  FOR SELECT
  USING (provider_id = auth.uid());

-- Physicians can view links where they are the provider
CREATE POLICY "Physicians can view own linked tasks"
  ON public.task_linked_providers
  FOR SELECT
  USING (public.has_role(auth.uid(), 'physician') AND provider_id = auth.uid());
