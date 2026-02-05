import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Calendar,
  Clock,
  Sun,
  Moon,
  Check,
  AlertCircle,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';

interface UpcomingMeeting {
  meetingMonth: string;
  amMeetingId: string;
  pmMeetingId: string;
  scheduledDate: Date;
  hasRsvped: boolean;
  selectedSlot: 'am' | 'pm' | null;
}

export function ProviderMeetingRSVP() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [upcomingMeetings, setUpcomingMeetings] = useState<UpcomingMeeting[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<Record<string, 'am' | 'pm'>>({});

  useEffect(() => {
    if (profile?.email) {
      loadMeetings();
    }
  }, [profile?.email]);

  const loadMeetings = async () => {
    if (!profile?.email) return;
    
    setLoading(true);
    try {
      // Get company-wide meetings that the provider is invited to
      const { data: attendeeData, error: attendeeError } = await supabase
        .from('meeting_attendees')
        .select(`
          id,
          meeting_id,
          has_rsvped,
          rsvp_slot,
          assigned_slot,
          attendance_status
        `)
        .eq('provider_email', profile.email);

      if (attendeeError) throw attendeeError;

      if (!attendeeData || attendeeData.length === 0) {
        setUpcomingMeetings([]);
        return;
      }

      // Get the meeting details
      const meetingIds = attendeeData.map(a => a.meeting_id);
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('supervision_meetings')
        .select('*')
        .in('id', meetingIds)
        .eq('is_company_wide', true)
        .eq('status', 'scheduled')
        .gte('scheduled_date', new Date().toISOString())
        .order('scheduled_date', { ascending: true });

      if (meetingsError) throw meetingsError;

      // Group meetings by month
      const meetingsByMonth = new Map<string, {
        am: { id: string; date: Date } | null;
        pm: { id: string; date: Date } | null;
        hasRsvped: boolean;
        selectedSlot: 'am' | 'pm' | null;
      }>();

      meetingsData?.forEach(meeting => {
        const monthKey = meeting.meeting_month || format(new Date(meeting.scheduled_date), 'yyyy-MM');
        const attendee = attendeeData.find(a => a.meeting_id === meeting.id);
        
        const existing = meetingsByMonth.get(monthKey) || {
          am: null,
          pm: null,
          hasRsvped: false,
          selectedSlot: null,
        };

        if (meeting.time_slot === 'am') {
          existing.am = { id: meeting.id, date: new Date(meeting.scheduled_date) };
        } else if (meeting.time_slot === 'pm') {
          existing.pm = { id: meeting.id, date: new Date(meeting.scheduled_date) };
        }

        if (attendee?.has_rsvped) {
          existing.hasRsvped = true;
          existing.selectedSlot = attendee.rsvp_slot as 'am' | 'pm' | null;
        }

        meetingsByMonth.set(monthKey, existing);
      });

      // Convert to array
      const meetings: UpcomingMeeting[] = [];
      meetingsByMonth.forEach((value, monthKey) => {
        if (value.am || value.pm) {
          meetings.push({
            meetingMonth: monthKey,
            amMeetingId: value.am?.id || '',
            pmMeetingId: value.pm?.id || '',
            scheduledDate: value.am?.date || value.pm?.date || new Date(),
            hasRsvped: value.hasRsvped,
            selectedSlot: value.selectedSlot,
          });
        }
      });

      setUpcomingMeetings(meetings);

      // Pre-populate selected slots for already RSVPed meetings
      const preSelectedSlots: Record<string, 'am' | 'pm'> = {};
      meetings.forEach(m => {
        if (m.selectedSlot) {
          preSelectedSlots[m.meetingMonth] = m.selectedSlot;
        }
      });
      setSelectedSlots(preSelectedSlots);
    } catch (err) {
      console.error('Error loading meetings:', err);
      toast({
        title: 'Error',
        description: 'Failed to load upcoming meetings.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRSVP = async (meeting: UpcomingMeeting) => {
    const selectedSlot = selectedSlots[meeting.meetingMonth];
    if (!selectedSlot || !profile?.email) return;

    setSubmitting(true);
    try {
      // Update the attendee record for the selected slot
      const meetingId = selectedSlot === 'am' ? meeting.amMeetingId : meeting.pmMeetingId;
      
      const { error } = await supabase
        .from('meeting_attendees')
        .update({
          has_rsvped: true,
          rsvp_slot: selectedSlot,
          rsvp_at: new Date().toISOString(),
        })
        .eq('meeting_id', meetingId)
        .eq('provider_email', profile.email);

      if (error) throw error;

      toast({
        title: 'RSVP Confirmed',
        description: `You've selected the ${selectedSlot.toUpperCase()} slot for ${format(meeting.scheduledDate, 'MMMM yyyy')}.`,
      });

      // Reload to get updated data
      loadMeetings();
    } catch (err) {
      console.error('Error submitting RSVP:', err);
      toast({
        title: 'Error',
        description: 'Failed to submit RSVP. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (upcomingMeetings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Upcoming Collaborative Meetings
          </CardTitle>
          <CardDescription>
            No upcoming meetings scheduled
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              There are no collaborative meetings scheduled at this time. 
              Check back later or contact your administrator.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Upcoming Collaborative Meetings
          </CardTitle>
          <CardDescription>
            Select your preferred time slot for each meeting. You only need to attend one meeting per month.
          </CardDescription>
        </CardHeader>
      </Card>

      {upcomingMeetings.map(meeting => (
        <Card key={meeting.meetingMonth}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg">
                    {format(meeting.scheduledDate, 'MMMM yyyy')} Meeting
                  </h3>
                  {meeting.hasRsvped && (
                    <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                      <Check className="h-3 w-3 mr-1" />
                      RSVP Confirmed
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {format(meeting.scheduledDate, 'EEEE, MMMM d, yyyy')}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <Label className="text-sm font-medium mb-3 block">
                Select your preferred time slot:
              </Label>
              <RadioGroup
                value={selectedSlots[meeting.meetingMonth] || ''}
                onValueChange={(value) => {
                  setSelectedSlots(prev => ({
                    ...prev,
                    [meeting.meetingMonth]: value as 'am' | 'pm',
                  }));
                }}
                className="grid grid-cols-2 gap-4"
                disabled={meeting.hasRsvped}
              >
                <Label
                  htmlFor={`${meeting.meetingMonth}-am`}
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedSlots[meeting.meetingMonth] === 'am'
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-muted-foreground/40'
                  } ${meeting.hasRsvped ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <RadioGroupItem value="am" id={`${meeting.meetingMonth}-am`} />
                  <div className="flex items-center gap-2">
                    <Sun className="h-5 w-5 text-amber-500" />
                    <div>
                      <p className="font-medium">Morning Session</p>
                      <p className="text-sm text-muted-foreground">10:00 AM</p>
                    </div>
                  </div>
                </Label>

                <Label
                  htmlFor={`${meeting.meetingMonth}-pm`}
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedSlots[meeting.meetingMonth] === 'pm'
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-muted-foreground/40'
                  } ${meeting.hasRsvped ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <RadioGroupItem value="pm" id={`${meeting.meetingMonth}-pm`} />
                  <div className="flex items-center gap-2">
                    <Moon className="h-5 w-5 text-indigo-500" />
                    <div>
                      <p className="font-medium">Afternoon Session</p>
                      <p className="text-sm text-muted-foreground">2:00 PM</p>
                    </div>
                  </div>
                </Label>
              </RadioGroup>
            </div>

            {!meeting.hasRsvped && (
              <div className="mt-6 flex justify-end">
                <Button
                  onClick={() => handleRSVP(meeting)}
                  disabled={!selectedSlots[meeting.meetingMonth] || submitting}
                >
                  {submitting ? 'Submitting...' : 'Confirm RSVP'}
                </Button>
              </div>
            )}

            {meeting.hasRsvped && meeting.selectedSlot && (
              <Alert className="mt-4 bg-green-50 border-green-200">
                <Check className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  You're confirmed for the {meeting.selectedSlot.toUpperCase()} session 
                  ({meeting.selectedSlot === 'am' ? '10:00 AM' : '2:00 PM'}).
                  This attendance will count for all your state agreements.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
