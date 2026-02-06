-- Add new status values to agreement_task_status enum
ALTER TYPE agreement_task_status ADD VALUE IF NOT EXISTS 'blocked';
ALTER TYPE agreement_task_status ADD VALUE IF NOT EXISTS 'waiting_on_signature';