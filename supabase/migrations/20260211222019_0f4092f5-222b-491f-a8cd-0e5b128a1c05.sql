-- Add new values to collab_requirement_type enum
ALTER TYPE collab_requirement_type ADD VALUE IF NOT EXISTS 'md_only';
ALTER TYPE collab_requirement_type ADD VALUE IF NOT EXISTS 'ttp';