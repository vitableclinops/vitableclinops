-- Update supervision_meetings for company-wide meetings (not per-state)
-- Add company_wide flag and remove state requirement for company meetings
ALTER TABLE public.supervision_meetings
ADD COLUMN IF NOT EXISTS is_company_wide BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS meeting_month DATE;

-- Update meeting_attendees to support RSVP workflow
ALTER TABLE public.meeting_attendees
ADD COLUMN IF NOT EXISTS rsvp_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS rsvp_slot TEXT CHECK (rsvp_slot IN ('am', 'pm')),
ADD COLUMN IF NOT EXISTS assigned_slot TEXT CHECK (assigned_slot IN ('am', 'pm')),
ADD COLUMN IF NOT EXISTS has_rsvped BOOLEAN DEFAULT false;

-- Create a view for email contact list
CREATE OR REPLACE VIEW public.meeting_notification_emails AS
SELECT 
  sm.id as meeting_id,
  sm.scheduled_date,
  sm.time_slot,
  sm.is_company_wide,
  sm.meeting_month,
  ma.provider_id,
  ma.provider_name,
  ma.provider_email,
  ma.attendance_status,
  ma.has_rsvped,
  ma.rsvp_slot,
  ma.assigned_slot
FROM public.supervision_meetings sm
LEFT JOIN public.meeting_attendees ma ON ma.meeting_id = sm.id
WHERE sm.status = 'scheduled';

-- Grant select on view to authenticated users
GRANT SELECT ON public.meeting_notification_emails TO authenticated;