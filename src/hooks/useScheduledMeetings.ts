import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MeetingAttendee {
  id: string;
  meeting_id: string;
  provider_id: string;
  provider_name: string;
  provider_email: string;
  attendance_status: string | null;
  has_rsvped: boolean | null;
  rsvp_slot: string | null;
  assigned_slot: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface ScheduledMeeting {
  id: string;
  agreement_id: string;
  scheduled_date: string;
  duration_minutes: number | null;
  meeting_type: string | null;
  status: string | null;
  location: string | null;
  video_link: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  // State-based fields
  state_abbreviation: string | null;
  state_name: string | null;
  time_slot: string | null;
  // Company-wide meeting fields
  is_company_wide: boolean | null;
  meeting_month: string | null;
  // Attendees (loaded separately)
  attendees?: MeetingAttendee[];
}

export const useScheduledMeetings = () => {
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMeetings = useCallback(async () => {
    try {
      setLoading(true);
      
      const [meetingsRes, attendeesRes] = await Promise.all([
        supabase
          .from('supervision_meetings')
          .select('*')
          .order('scheduled_date', { ascending: true }),
        supabase
          .from('meeting_attendees')
          .select('*')
      ]);

      if (meetingsRes.error) throw meetingsRes.error;
      
      // Cast the data to include new columns (they may be null for older records)
      const meetingsData = (meetingsRes.data || []).map(m => ({
        ...m,
        state_abbreviation: (m as any).state_abbreviation || null,
        state_name: (m as any).state_name || null,
        time_slot: (m as any).time_slot || null,
        is_company_wide: (m as any).is_company_wide || null,
        meeting_month: (m as any).meeting_month || null,
      })) as ScheduledMeeting[];
      
      setMeetings(meetingsData);
      setAttendees(attendeesRes.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch scheduled meetings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // Get the next upcoming meeting for a specific agreement
  const getNextMeetingForAgreement = useCallback((agreementId: string): ScheduledMeeting | null => {
    const now = new Date();
    const upcomingMeetings = meetings
      .filter(m => 
        m.agreement_id === agreementId && 
        new Date(m.scheduled_date) > now &&
        m.status !== 'cancelled'
      )
      .sort((a, b) => 
        new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
      );
    
    return upcomingMeetings[0] || null;
  }, [meetings]);

  // Get the next upcoming meeting for a specific state
  const getNextMeetingForState = useCallback((stateAbbr: string): ScheduledMeeting | null => {
    const now = new Date();
    const upcomingMeetings = meetings
      .filter(m => 
        m.state_abbreviation === stateAbbr && 
        new Date(m.scheduled_date) > now &&
        m.status !== 'cancelled'
      )
      .sort((a, b) => 
        new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
      );
    
    return upcomingMeetings[0] || null;
  }, [meetings]);

  // Get all upcoming meetings for an agreement
  const getUpcomingMeetingsForAgreement = useCallback((agreementId: string): ScheduledMeeting[] => {
    const now = new Date();
    return meetings
      .filter(m => 
        m.agreement_id === agreementId && 
        new Date(m.scheduled_date) > now &&
        m.status !== 'cancelled'
      )
      .sort((a, b) => 
        new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
      );
  }, [meetings]);

  // Get all upcoming meetings for a state
  const getUpcomingMeetingsForState = useCallback((stateAbbr: string): ScheduledMeeting[] => {
    const now = new Date();
    return meetings
      .filter(m => 
        m.state_abbreviation === stateAbbr && 
        new Date(m.scheduled_date) > now &&
        m.status !== 'cancelled'
      )
      .sort((a, b) => 
        new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
      );
  }, [meetings]);

  // Get meetings in a date range (for calendar display)
  const getMeetingsInRange = useCallback((startDate: Date, endDate: Date): ScheduledMeeting[] => {
    return meetings.filter(m => {
      const date = new Date(m.scheduled_date);
      return date >= startDate && date <= endDate;
    });
  }, [meetings]);

  // Check if any meeting is scheduled for an agreement
  const hasMeetingScheduled = useCallback((agreementId: string): boolean => {
    const now = new Date();
    return meetings.some(m => 
      m.agreement_id === agreementId && 
      new Date(m.scheduled_date) > now &&
      m.status !== 'cancelled'
    );
  }, [meetings]);

  // Check if any meeting is scheduled for a state
  const hasMeetingScheduledForState = useCallback((stateAbbr: string): boolean => {
    const now = new Date();
    return meetings.some(m => 
      m.state_abbreviation === stateAbbr && 
      new Date(m.scheduled_date) > now &&
      m.status !== 'cancelled'
    );
  }, [meetings]);

  // Get attendees for a meeting
  const getAttendeesForMeeting = useCallback((meetingId: string): MeetingAttendee[] => {
    return attendees.filter(a => a.meeting_id === meetingId);
  }, [attendees]);

  // Get meetings with attendees attached
  const getMeetingsWithAttendees = useCallback((): ScheduledMeeting[] => {
    return meetings.map(m => ({
      ...m,
      attendees: attendees.filter(a => a.meeting_id === m.id),
    }));
  }, [meetings, attendees]);

  return {
    meetings,
    attendees,
    loading,
    error,
    refetch: fetchMeetings,
    getNextMeetingForAgreement,
    getNextMeetingForState,
    getUpcomingMeetingsForAgreement,
    getUpcomingMeetingsForState,
    getMeetingsInRange,
    hasMeetingScheduled,
    hasMeetingScheduledForState,
    getAttendeesForMeeting,
    getMeetingsWithAttendees,
  };
};
