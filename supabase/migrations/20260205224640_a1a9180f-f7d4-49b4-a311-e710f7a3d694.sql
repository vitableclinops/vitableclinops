-- Add state-based meeting support to supervision_meetings table
-- Meetings are now scheduled per state, not per individual agreement

-- Add state columns to supervision_meetings
ALTER TABLE public.supervision_meetings
ADD COLUMN IF NOT EXISTS state_abbreviation text,
ADD COLUMN IF NOT EXISTS state_name text,
ADD COLUMN IF NOT EXISTS time_slot text DEFAULT 'am'; -- 'am' or 'pm'

-- Create index for efficient state-based queries
CREATE INDEX IF NOT EXISTS idx_supervision_meetings_state 
ON public.supervision_meetings(state_abbreviation, scheduled_date);

-- Create index for time slots
CREATE INDEX IF NOT EXISTS idx_supervision_meetings_time_slot 
ON public.supervision_meetings(scheduled_date, time_slot);

-- Add a junction table to track which providers are invited to each meeting
CREATE TABLE IF NOT EXISTS public.meeting_attendees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id uuid NOT NULL REFERENCES public.supervision_meetings(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  provider_name text NOT NULL,
  provider_email text NOT NULL,
  attendance_status text DEFAULT 'invited', -- invited, confirmed, declined, attended, no_show
  confirmed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on meeting_attendees
ALTER TABLE public.meeting_attendees ENABLE ROW LEVEL SECURITY;

-- Create policies for meeting_attendees
CREATE POLICY "Authenticated users can manage meeting attendees"
ON public.meeting_attendees
FOR ALL
USING (true);

CREATE POLICY "Authenticated users can view meeting attendees"
ON public.meeting_attendees
FOR SELECT
USING (true);

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting 
ON public.meeting_attendees(meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_attendees_provider 
ON public.meeting_attendees(provider_id);