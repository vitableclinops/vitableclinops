import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
}

export const useScheduledMeetings = () => {
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMeetings = useCallback(async () => {
    try {
      setLoading(true);
      
      const { data, error: err } = await supabase
        .from('supervision_meetings')
        .select('*')
        .order('scheduled_date', { ascending: true });

      if (err) throw err;
      setMeetings(data || []);
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

  return {
    meetings,
    loading,
    error,
    refetch: fetchMeetings,
    getNextMeetingForAgreement,
    getUpcomingMeetingsForAgreement,
    getMeetingsInRange,
    hasMeetingScheduled,
  };
};
