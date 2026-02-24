
-- 1. Add requires_upload column to agreement_tasks
ALTER TABLE public.agreement_tasks
ADD COLUMN requires_upload boolean NOT NULL DEFAULT false;

-- 2. Create task_documents table
CREATE TABLE public.task_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.agreement_tasks(id) ON DELETE CASCADE,
  agreement_id uuid REFERENCES public.collaborative_agreements(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_task_documents_task_id ON public.task_documents(task_id);
CREATE INDEX idx_task_documents_agreement_id ON public.task_documents(agreement_id);

-- Enable RLS
ALTER TABLE public.task_documents ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "Admins can manage all task documents"
ON public.task_documents
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Providers: SELECT on documents linked to tasks they're assigned to
CREATE POLICY "Providers can view their task documents"
ON public.task_documents
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.agreement_tasks t
    WHERE t.id = task_documents.task_id
    AND (
      t.assigned_to IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid())
      OR t.provider_id IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid())
    )
  )
);

-- 3. Create task-documents storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-documents', 'task-documents', false);

-- Storage RLS: Admins can upload
CREATE POLICY "Admins can upload task documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'task-documents'
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Storage RLS: Admins can read
CREATE POLICY "Admins can read task documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'task-documents'
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Storage RLS: Admins can delete
CREATE POLICY "Admins can delete task documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'task-documents'
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- 4. Backfill: set requires_upload on existing document/signature/termination tasks
UPDATE public.agreement_tasks
SET requires_upload = true
WHERE category IN ('document', 'signature')
   OR title ILIKE '%upload%'
   OR title ILIKE '%submit document%'
   OR title ILIKE '%executed%agreement%';
