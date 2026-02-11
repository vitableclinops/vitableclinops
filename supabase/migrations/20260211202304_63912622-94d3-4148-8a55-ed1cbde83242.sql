
-- 1. Extend agreement_workflow_status enum with new states
ALTER TYPE agreement_workflow_status ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE agreement_workflow_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE agreement_workflow_status ADD VALUE IF NOT EXISTS 'archived';

-- 2. Add provider_message columns to agreements and transfers
ALTER TABLE collaborative_agreements 
  ADD COLUMN IF NOT EXISTS provider_message text,
  ADD COLUMN IF NOT EXISTS provider_message_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_sent_by uuid;

ALTER TABLE agreement_transfers
  ADD COLUMN IF NOT EXISTS provider_message text,
  ADD COLUMN IF NOT EXISTS provider_message_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_sent_by uuid;

-- 3. Create workflow message templates table
CREATE TABLE IF NOT EXISTS workflow_message_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_type text NOT NULL, -- 'initiation', 'transfer', 'annual_renewal', 'cancellation', 'termination'
  template_name text NOT NULL,
  subject_template text NOT NULL DEFAULT '',
  body_template text NOT NULL,
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflow_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage message templates"
  ON workflow_message_templates FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view message templates"
  ON workflow_message_templates FOR SELECT
  USING (true);

-- Seed default templates
INSERT INTO workflow_message_templates (workflow_type, template_name, subject_template, body_template, is_default) VALUES
('initiation', 'Default Initiation Notice', 'New Collaborative Agreement – {{state_name}}', 'Hi {{provider_name}},

We are setting up a new collaborative agreement for {{state_name}} with Dr. {{physician_name}} as your supervising physician.

You will be notified once the agreement is fully executed and active. In the meantime, please review any tasks assigned to you.

Thank you,
{{admin_name}}', true),

('transfer', 'Default Transfer Notice', 'Physician Transfer – {{state_name}}', 'Hi {{provider_name}},

We are transitioning your collaborative agreement for {{state_name}} from Dr. {{source_physician_name}} to Dr. {{target_physician_name}}.

Effective Date: {{effective_date}}

No action is needed on your end at this time. We will notify you once the new agreement is active.

Thank you,
{{admin_name}}', true),

('annual_renewal', 'Default Renewal Notice', 'Agreement Renewal – {{state_name}}', 'Hi {{provider_name}},

Your collaborative agreement for {{state_name}} with Dr. {{physician_name}} is due for renewal.

Renewal Date: {{renewal_date}}

Please ensure any required documentation or attestations are completed promptly.

Thank you,
{{admin_name}}', true),

('cancellation', 'Default Cancellation Notice', 'Agreement Cancellation – {{state_name}}', 'Hi {{provider_name}},

Your collaborative agreement for {{state_name}} with Dr. {{physician_name}} has been cancelled.

If you have questions about this change or your practice status in {{state_name}}, please reach out to your admin contact.

Thank you,
{{admin_name}}', true),

('termination', 'Default Termination Notice', 'Agreement Termination – {{state_name}}', 'Hi {{provider_name}},

Your collaborative agreement for {{state_name}} with Dr. {{physician_name}} is being terminated.

Effective Date: {{effective_date}}
Reason: {{termination_reason}}

Please ensure you do not continue practicing under this agreement after the effective date.

Thank you,
{{admin_name}}', true);

-- 4. Add state requirements review cadence fields
ALTER TABLE state_compliance_requirements
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS review_sources text,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS review_cadence_days integer DEFAULT 365;

-- 5. Add provider-level renewal handling setting
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS renewal_handling text DEFAULT 'internal_admin',
  ADD COLUMN IF NOT EXISTS reimbursement_config jsonb DEFAULT '{"license_fee": true, "management_fee": false}'::jsonb;

-- Trigger for updated_at on workflow_message_templates
CREATE TRIGGER update_workflow_message_templates_updated_at
  BEFORE UPDATE ON workflow_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
