-- =============================================
-- PROVIDER MILESTONES SYSTEM
-- =============================================

-- Add milestone fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS date_of_birth date,
ADD COLUMN IF NOT EXISTS start_date_on_network date,
ADD COLUMN IF NOT EXISTS milestone_visibility text DEFAULT 'private' CHECK (milestone_visibility IN ('private', 'pod_only', 'public'));

-- Create pods table for pod lead assignments
CREATE TABLE IF NOT EXISTS public.pods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  pod_lead_id uuid REFERENCES public.profiles(id),
  pod_lead_name text,
  pod_lead_email text,
  slack_channel text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add pod assignment to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS pod_id uuid REFERENCES public.pods(id);

-- Create milestone tasks table with deduplication
CREATE TABLE IF NOT EXISTS public.milestone_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  provider_email text,
  milestone_type text NOT NULL CHECK (milestone_type IN ('birthday', 'anniversary')),
  milestone_date date NOT NULL,
  milestone_year integer NOT NULL,
  assigned_to uuid REFERENCES public.profiles(id),
  assigned_to_name text,
  pod_id uuid REFERENCES public.pods(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  title text NOT NULL,
  description text,
  slack_template text,
  due_date date NOT NULL,
  completed_at timestamp with time zone,
  completed_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Unique constraint for deduplication
  UNIQUE (provider_id, milestone_type, milestone_year)
);

-- Create milestone audit log
CREATE TABLE IF NOT EXISTS public.milestone_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  milestone_task_id uuid REFERENCES public.milestone_tasks(id),
  provider_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  actor_id uuid,
  actor_name text,
  details jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- =============================================
-- KNOWLEDGE BASE / PROVIDER RESOURCES HUB
-- =============================================

-- Create knowledge base articles table
CREATE TABLE IF NOT EXISTS public.kb_articles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  slug text UNIQUE,
  summary text,
  content text,
  content_type text NOT NULL DEFAULT 'rich_text' CHECK (content_type IN ('rich_text', 'markdown', 'notion_link')),
  notion_url text,
  category text NOT NULL DEFAULT 'General',
  tags text[] DEFAULT '{}',
  visibility_roles text[] DEFAULT '{provider}',
  is_featured boolean DEFAULT false,
  featured_order integer,
  owner_id uuid REFERENCES public.profiles(id),
  owner_name text,
  review_cycle_days integer DEFAULT 90,
  last_reviewed_at timestamp with time zone,
  last_reviewed_by uuid,
  view_count integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  published boolean DEFAULT true
);

-- Create KB categories for organization
CREATE TABLE IF NOT EXISTS public.kb_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  icon text,
  color text,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Insert default categories
INSERT INTO public.kb_categories (name, description, icon, sort_order) VALUES
  ('Getting Started', 'Essential onboarding resources for new providers', 'rocket', 1),
  ('State Guides', 'State-specific licensing and compliance information', 'map-pin', 2),
  ('Clinical Resources', 'Clinical protocols, guidelines, and best practices', 'stethoscope', 3),
  ('Compliance & Training', 'Required training modules and compliance documentation', 'shield', 4),
  ('HR & Benefits', 'Employment policies, benefits, and HR resources', 'users', 5),
  ('Technology', 'EHR guides, tech support, and system documentation', 'laptop', 6),
  ('Templates & Forms', 'Downloadable templates and form documents', 'file-text', 7),
  ('FAQs', 'Frequently asked questions and troubleshooting', 'help-circle', 8)
ON CONFLICT (name) DO NOTHING;

-- =============================================
-- RLS POLICIES
-- =============================================

-- Pods RLS
ALTER TABLE public.pods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage pods" ON public.pods
FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view pods" ON public.pods
FOR SELECT USING (true);

-- Milestone tasks RLS
ALTER TABLE public.milestone_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all milestone tasks" ON public.milestone_tasks
FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Pod leads can view their assigned milestone tasks" ON public.milestone_tasks
FOR SELECT USING (
  assigned_to IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Pod leads can update their assigned milestone tasks" ON public.milestone_tasks
FOR UPDATE USING (
  assigned_to IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- Milestone audit log RLS
ALTER TABLE public.milestone_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage milestone audit log" ON public.milestone_audit_log
FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their related milestone audits" ON public.milestone_audit_log
FOR SELECT USING (
  actor_id = auth.uid() OR 
  provider_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
);

-- KB Articles RLS
ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all KB articles" ON public.kb_articles
FOR ALL USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view published articles matching their roles" ON public.kb_articles
FOR SELECT USING (
  published = true AND (
    'provider' = ANY(visibility_roles) OR
    (has_role(auth.uid(), 'admin') AND 'admin' = ANY(visibility_roles)) OR
    (has_role(auth.uid(), 'leadership') AND 'leadership' = ANY(visibility_roles)) OR
    (has_role(auth.uid(), 'physician') AND 'physician' = ANY(visibility_roles))
  )
);

-- KB Categories RLS
ALTER TABLE public.kb_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view KB categories" ON public.kb_categories
FOR SELECT USING (true);

CREATE POLICY "Admins can manage KB categories" ON public.kb_categories
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Add updated_at triggers
CREATE TRIGGER update_pods_updated_at
BEFORE UPDATE ON public.pods
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_milestone_tasks_updated_at
BEFORE UPDATE ON public.milestone_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_kb_articles_updated_at
BEFORE UPDATE ON public.kb_articles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();