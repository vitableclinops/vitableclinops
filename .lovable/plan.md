

# Document Upload System for Tasks

## Problem
Tasks like "Upload executed termination agreement" can currently be marked complete without any document attached. There's no mechanism to upload files to a task, no enforcement that document-required tasks must have an attachment before completion, and no centralized place where uploaded documents live for future reference and audit.

## Solution Overview

Build a **task document attachment system** with three key capabilities:
1. Upload documents directly to a task
2. Block completion of document-required tasks until a file is uploaded
3. Store documents in a central, auditable location linked to both the task and the parent agreement

---

## Architecture

```text
+------------------+       +---------------------+       +------------------+
| agreement_tasks  | 1---* | task_documents      | ----> | Storage Bucket   |
| (existing)       |       | (new table)         |       | "task-documents" |
+------------------+       +---------------------+       +------------------+
| id               |       | id                  |       |                  |
| requires_upload  |       | task_id (FK)        |       | Files stored at: |
| ...              |       | agreement_id        |       | {agreement_id}/  |
+------------------+       | file_name           |       |   {task_id}/     |
                           | file_path           |       |     {filename}   |
                           | file_size           |       +------------------+
                           | mime_type           |
                           | uploaded_by         |
                           | uploaded_by_name    |
                           | created_at          |
                           +---------------------+
```

---

## Step 1: Database Changes

### New column on `agreement_tasks`
- Add `requires_upload BOOLEAN DEFAULT false` -- flags tasks that cannot be completed without at least one attached document.

### New table: `task_documents`
Stores metadata for every file uploaded to a task:
- `id` (uuid, PK)
- `task_id` (uuid, NOT NULL) -- links to `agreement_tasks.id`
- `agreement_id` (uuid) -- denormalized for fast agreement-level document queries
- `file_name` (text) -- original file name
- `file_path` (text) -- path in the storage bucket
- `file_size` (bigint) -- bytes
- `mime_type` (text)
- `uploaded_by` (uuid) -- user who uploaded
- `uploaded_by_name` (text) -- denormalized name
- `created_at` (timestamptz, DEFAULT now())

RLS policies:
- Admins: full access
- Providers: SELECT on documents linked to tasks they're assigned to

### New storage bucket: `task-documents`
- Private bucket (not public)
- RLS on `storage.objects` for admin insert/select/delete
- File path convention: `{agreement_id}/{task_id}/{filename}` for clean organization

---

## Step 2: Completion Gating Logic

### In `EditableTaskItem.tsx` (transfer workflow tasks)
When a user tries to complete a task that has `requires_upload = true`:
1. Check if any rows exist in `task_documents` for that `task_id`
2. If none exist, show a warning: "This task requires a document upload before it can be completed"
3. Block the completion action until at least one document is uploaded

### In `EditTaskDialog.tsx` (admin dashboard tasks)
Same gating logic when status is changed to "completed":
- If `requires_upload` is true and no documents exist, prevent save and show inline warning

### Auto-flagging
Tasks generated with titles containing keywords like "Upload", "Submit document", or with category `document` or `signature` will have `requires_upload` defaulted to `true` during creation. Admins can also toggle this flag manually in the edit form.

---

## Step 3: Upload UI

### Document Upload Section (reusable component: `TaskDocumentUpload`)
A new component added to both `EditableTaskItem` and `EditTaskDialog`:
- Drag-and-drop zone or file picker button
- Shows list of already-uploaded documents with file name, size, upload date, and uploader
- Each document has a "View" (opens signed URL) and "Delete" action
- Accepted file types: PDF, images, Word docs

### Upload Flow
1. User selects file
2. File uploads to `task-documents` bucket at path `{agreement_id}/{task_id}/{uuid}_{filename}`
3. Row inserted into `task_documents` table with metadata
4. Entry logged in `agreement_audit_log` (action: `document_uploaded`, entity_type: `task`, entity_id: task_id, changes include file_name and agreement_id)
5. UI refreshes to show the new document

---

## Step 4: Document Retrieval and Audit Trail

### On the Agreement Detail Page
- Add a "Documents" tab or section that queries `task_documents WHERE agreement_id = X`
- Shows all documents uploaded across all tasks for that agreement, grouped by task
- Each document is downloadable via signed URL

### In the Audit Report Generator
- The existing `AuditReportGenerator` will be updated to include a "Documents" section
- Lists all `task_documents` for the agreement with file names, upload dates, and who uploaded them
- Provides download links (signed URLs valid for the report viewing session)

### On the Task Itself (everywhere tasks appear)
- A small paperclip icon with a count badge appears on tasks that have documents attached
- Clicking it expands to show the document list inline

---

## Step 5: Transfer Workflow Integration

For transfer tasks specifically (the termination workflow you're working through):
- The auto-generated task "Upload executed termination agreement" will have `requires_upload = true` set automatically
- When the document is uploaded to this task, its path is also written to `collaborative_agreements.termination_document_url` for backward compatibility
- Similar linking for "Upload executed agreement" tasks writing to `agreement_document_url`

---

## Files to Create
- `src/components/tasks/TaskDocumentUpload.tsx` -- reusable upload + document list component

## Files to Modify
- `src/components/agreements/EditableTaskItem.tsx` -- integrate upload component, add completion gating
- `src/components/admin/EditTaskDialog.tsx` -- integrate upload component, add completion gating, add `requires_upload` toggle
- `src/hooks/useAgreementTasks.ts` -- set `requires_upload` on auto-generated document/signature tasks
- `src/pages/AgreementDetailPage.tsx` -- add agreement-level document listing
- `src/components/agreements/AuditReportGenerator.tsx` -- include task documents in report
- `src/pages/TaskRepositoryPage.tsx` -- show paperclip icon for tasks with documents
- `src/components/admin/AdminTaskQueue.tsx` -- show paperclip icon for tasks with documents

## Database Migrations
1. Add `requires_upload` column to `agreement_tasks`
2. Create `task_documents` table with RLS
3. Create `task-documents` storage bucket with RLS policies
4. Backfill: UPDATE existing tasks with document/signature/termination categories to set `requires_upload = true`
