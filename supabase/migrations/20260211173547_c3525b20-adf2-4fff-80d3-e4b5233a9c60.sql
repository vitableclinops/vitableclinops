
-- Add 'communication' to agreement_task_category enum
ALTER TYPE public.agreement_task_category ADD VALUE IF NOT EXISTS 'communication';

-- Add 'archived' to agreement_task_status enum
ALTER TYPE public.agreement_task_status ADD VALUE IF NOT EXISTS 'archived';

-- Add archived_reason and archived metadata columns
ALTER TABLE public.agreement_tasks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by text,
  ADD COLUMN IF NOT EXISTS archived_reason text;
