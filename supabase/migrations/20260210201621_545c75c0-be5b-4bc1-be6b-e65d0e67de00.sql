-- Add new workflow status values to the enum
ALTER TYPE agreement_workflow_status ADD VALUE IF NOT EXISTS 'pending_setup';
ALTER TYPE agreement_workflow_status ADD VALUE IF NOT EXISTS 'pending_verification';
ALTER TYPE agreement_workflow_status ADD VALUE IF NOT EXISTS 'invalid';