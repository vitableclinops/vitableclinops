import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Calendar, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  FileText, 
  ExternalLink,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { format, parseISO, isFuture, isPast, isThisMonth } from 'date-fns';
import { cn } from '@/lib/utils';

interface ProviderAgreement {
  id: string;
  provider_name: string;
  provider_email: string;
  state_abbreviation: string;
  meeting_cadence: string | null;
  chart_review_url: string | null;
}

interface MeetingAttendance {
  id: string;
  meeting_id: string;
  scheduled_date: string;
  meeting_month: string;
  time_slot: string;
  attendance_status: string;
  has_rsvped: boolean;
  rsvp_slot: string | null;
  assigned_slot: string | null;
}

interface ComplianceRecord {
  id: string;
  meeting_id: string;
  state_abbreviation: string;
  meeting_month: string;
  required: boolean;
  attended: boolean;
  attended_at: string | null;
}

interface ProviderComplianceData {
  providerId: string;
  providerName: string;
  providerEmail: string;
  avatarUrl?: string;
  chartReviewFolderUrl?: string;
  agreements: ProviderAgreement[];
  meetings: MeetingAttendance[];
  compliance: ComplianceRecord[];
}

interface ProviderComplianceViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId?: string;
  providerEmail?: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ProviderComplianceView({
  open,
  onOpenChange,
  providerId,
  providerEmail,
}: ProviderComplianceViewProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProviderComplianceData | null>(null);

  useEffect(() => {
    if (open && (providerId || providerEmail)) {
      loadComplianceData();
    }
  }, [open, providerId, providerEmail]);

  const loadComplianceData = async () => {
    setLoading(true);
    try {
      // Get provider profile
      let profileQuery = supabase.from('profiles').select('*');
      
      if (providerId) {
        profileQuery = profileQuery.eq('id', providerId);
      } else if (providerEmail) {
        profileQuery = profileQuery.eq('email', providerEmail);
      }
      
      const { data: profile } = await profileQuery.single();
      
      if (!profile) {
        setData(null);
        return;
      }

      // Get all agreements for this provider
      const { data: agreementProviders } = await supabase
        .from('agreement_providers')
        .select(`
          id,
          provider_name,
          provider_email,
          chart_review_url,
          agreement_id
        `)
        .eq('provider_email', profile.email)
        .eq('is_active', true);

      // Get agreement details
      const agreementIds = agreementProviders?.map(ap => ap.agreement_id) || [];
      const { data: agreements } = await supabase
        .from('collaborative_agreements')
        .select('id, state_abbreviation, meeting_cadence')
        .in('id', agreementIds);

      // Map agreements with state info
      const providerAgreements: ProviderAgreement[] = (agreementProviders || []).map(ap => {
        const agreement = agreements?.find(a => a.id === ap.agreement_id);
        return {
          id: ap.id,
          provider_name: ap.provider_name,
          provider_email: ap.provider_email,
          state_abbreviation: agreement?.state_abbreviation || 'Unknown',
          meeting_cadence: agreement?.meeting_cadence || null,
          chart_review_url: ap.chart_review_url,
        };
      });

      // Get meeting attendance
      const { data: attendees } = await supabase
        .from('meeting_attendees')
        .select(`
          id,
          meeting_id,
          attendance_status,
          has_rsvped,
          rsvp_slot,
          assigned_slot
        `)
        .eq('provider_email', profile.email);

      // Get meeting details
      const meetingIds = attendees?.map(a => a.meeting_id) || [];
      const { data: meetings } = await supabase
        .from('supervision_meetings')
        .select('id, scheduled_date, meeting_month, time_slot, is_company_wide')
        .in('id', meetingIds)
        .eq('is_company_wide', true)
        .order('scheduled_date', { ascending: false });

      const meetingAttendance: MeetingAttendance[] = (attendees || []).map(a => {
        const meeting = meetings?.find(m => m.id === a.meeting_id);
        return {
          id: a.id,
          meeting_id: a.meeting_id,
          scheduled_date: meeting?.scheduled_date || '',
          meeting_month: meeting?.meeting_month || '',
          time_slot: meeting?.time_slot || '',
          attendance_status: a.attendance_status,
          has_rsvped: a.has_rsvped || false,
          rsvp_slot: a.rsvp_slot,
          assigned_slot: a.assigned_slot,
        };
      }).filter(a => a.scheduled_date);

      // Get compliance records
      const { data: compliance } = await supabase
        .from('provider_meeting_compliance')
        .select('*')
        .eq('provider_id', profile.id)
        .order('meeting_month', { ascending: false });

      setData({
        providerId: profile.id,
        providerName: profile.full_name || profile.email,
        providerEmail: profile.email,
        avatarUrl: profile.avatar_url || undefined,
        chartReviewFolderUrl: profile.chart_review_folder_url || undefined,
        agreements: providerAgreements,
        meetings: meetingAttendance,
        compliance: compliance || [],
      });
    } catch (error) {
      console.error('Error loading compliance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  // Calculate compliance summary
  const complianceSummary = useMemo(() => {
    if (!data) return { attended: 0, missed: 0, upcoming: 0, rate: 0 };

    const now = new Date();
    const pastMeetings = data.meetings.filter(m => isPast(parseISO(m.scheduled_date)));
    const futureMeetings = data.meetings.filter(m => isFuture(parseISO(m.scheduled_date)));
    
    const attended = pastMeetings.filter(m => m.attendance_status === 'attended').length;
    const missed = pastMeetings.filter(m => m.attendance_status === 'no_show' || m.attendance_status === 'missed').length;
    const upcoming = futureMeetings.length;
    
    const total = attended + missed;
    const rate = total > 0 ? Math.round((attended / total) * 100) : 100;

    return { attended, missed, upcoming, rate };
  }, [data]);

  const getAttendanceStatusBadge = (status: string) => {
    switch (status) {
      case 'attended':
        return <Badge className="bg-success/10 text-success">Attended</Badge>;
      case 'confirmed':
        return <Badge className="bg-primary/10 text-primary">Confirmed</Badge>;
      case 'rsvped':
        return <Badge className="bg-blue-100 text-blue-700">RSVP'd</Badge>;
      case 'invited':
        return <Badge variant="secondary">Invited</Badge>;
      case 'no_show':
      case 'missed':
        return <Badge variant="destructive">Missed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-primary" />
            Provider Meeting Compliance
          </DialogTitle>
          <DialogDescription>
            View meeting attendance history and compliance status
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !data ? (
          <div className="py-8 text-center text-muted-foreground">
            Provider not found
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6">
              {/* Provider Header */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-14 w-14">
                      <AvatarImage src={data.avatarUrl} />
                      <AvatarFallback className="bg-primary/10 text-primary text-lg">
                        {getInitials(data.providerName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold">{data.providerName}</h3>
                      <p className="text-sm text-muted-foreground">{data.providerEmail}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {data.agreements.map(a => (
                          <Badge key={a.id} variant="secondary" className="text-xs">
                            {a.state_abbreviation}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    
                    {/* Chart Review Link */}
                    {data.chartReviewFolderUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => window.open(data.chartReviewFolderUrl, '_blank')}
                      >
                        <FileText className="h-4 w-4" />
                        Chart Reviews
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        No chart review link
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Compliance Summary */}
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <CheckCircle2 className="h-5 w-5 text-success" />
                      <span className="text-2xl font-bold text-success">{complianceSummary.attended}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Attended</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <XCircle className="h-5 w-5 text-destructive" />
                      <span className="text-2xl font-bold text-destructive">{complianceSummary.missed}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Missed</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Clock className="h-5 w-5 text-primary" />
                      <span className="text-2xl font-bold text-primary">{complianceSummary.upcoming}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Upcoming</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className={cn(
                      "text-2xl font-bold mb-1",
                      complianceSummary.rate >= 80 ? "text-success" : 
                      complianceSummary.rate >= 60 ? "text-amber-500" : "text-destructive"
                    )}>
                      {complianceSummary.rate}%
                    </div>
                    <p className="text-xs text-muted-foreground">Compliance Rate</p>
                  </CardContent>
                </Card>
              </div>

              {/* Meeting History */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Meeting History
                  </CardTitle>
                  <CardDescription>
                    Past and upcoming collaborative meetings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.meetings.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No meetings found</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Time Slot</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>RSVP</TableHead>
                          <TableHead>Assigned</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.meetings.map(meeting => (
                          <TableRow key={meeting.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {isFuture(parseISO(meeting.scheduled_date)) ? (
                                  <Clock className="h-4 w-4 text-primary" />
                                ) : meeting.attendance_status === 'attended' ? (
                                  <CheckCircle2 className="h-4 w-4 text-success" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                                )}
                                {format(parseISO(meeting.scheduled_date), 'MMM d, yyyy')}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="uppercase">
                                {meeting.time_slot}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {getAttendanceStatusBadge(meeting.attendance_status)}
                            </TableCell>
                            <TableCell>
                              {meeting.has_rsvped ? (
                                <Badge className="bg-success/10 text-success uppercase">
                                  {meeting.rsvp_slot || 'Yes'}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {meeting.assigned_slot ? (
                                <Badge variant="secondary" className="uppercase">
                                  {meeting.assigned_slot}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* State-specific compliance (if needed for cadence tracking) */}
              {data.agreements.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">State Agreement Details</CardTitle>
                    <CardDescription>
                      Meeting cadence requirements by state
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {data.agreements.map(agreement => (
                        <div key={agreement.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="w-10 justify-center">
                              {agreement.state_abbreviation}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {agreement.meeting_cadence || 'Monthly'} meetings
                            </span>
                          </div>
                          {agreement.chart_review_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() => window.open(agreement.chart_review_url!, '_blank')}
                            >
                              <FileText className="h-3 w-3" />
                              Chart Review
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}