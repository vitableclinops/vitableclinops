import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Calendar, 
  Clock, 
  Video, 
  FileText, 
  Users,
  ChevronRight,
  Plus,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SupervisionMeeting } from '@/types';
import { collaborativeAgreements, collaboratingPhysicians, providers, states } from '@/data/mockData';

interface SupervisionCalendarProps {
  meetings: SupervisionMeeting[];
  showAddButton?: boolean;
  className?: string;
}

const meetingTypeConfig = {
  collaborative_meeting: { label: 'Collaborative Meeting', icon: Users, className: 'bg-primary/10 text-primary' },
  chart_review: { label: 'Chart Review', icon: FileText, className: 'bg-info/10 text-info' },
  case_discussion: { label: 'Case Discussion', icon: Video, className: 'bg-accent/10 text-accent-foreground' },
};

const statusConfig = {
  scheduled: { label: 'Scheduled', className: 'bg-muted text-muted-foreground' },
  completed: { label: 'Completed', className: 'bg-success/10 text-success' },
  cancelled: { label: 'Cancelled', className: 'bg-destructive/10 text-destructive' },
  missed: { label: 'Missed', className: 'bg-warning/10 text-warning' },
};

export function SupervisionCalendar({ meetings, showAddButton = true, className }: SupervisionCalendarProps) {
  const sortedMeetings = [...meetings].sort((a, b) => 
    new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
  );

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Supervision Calendar
        </CardTitle>
        {showAddButton && (
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Schedule
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {sortedMeetings.length > 0 ? (
          <div className="space-y-3">
            {sortedMeetings.map(meeting => {
              const agreement = collaborativeAgreements.find(a => a.id === meeting.agreementId);
              const state = states.find(s => s.id === agreement?.stateId);
              const physician = collaboratingPhysicians.find(p => p.id === meeting.attendees.physicianId);
              const meetingProviders = providers.filter(p => meeting.attendees.providerIds.includes(p.id));
              const typeConfig = meetingTypeConfig[meeting.type];
              const TypeIcon = typeConfig.icon;
              const meetingDate = new Date(meeting.scheduledDate);
              const isToday = new Date().toDateString() === meetingDate.toDateString();
              const isPast = meetingDate < new Date() && meeting.status === 'scheduled';
              
              return (
                <div 
                  key={meeting.id}
                  className={cn(
                    'flex items-start gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer group',
                    isToday && 'border-primary/30 bg-primary/5',
                    isPast && 'border-warning/30 bg-warning/5'
                  )}
                >
                  {/* Date column */}
                  <div className="flex flex-col items-center min-w-[50px] text-center">
                    <span className="text-xs text-muted-foreground uppercase">
                      {meetingDate.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className="text-2xl font-bold text-foreground">
                      {meetingDate.getDate()}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {meetingDate.toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                  </div>
                  
                  {/* Meeting details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={cn('text-xs', typeConfig.className)}>
                        <TypeIcon className="h-3 w-3 mr-1" />
                        {typeConfig.label}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {state?.abbreviation}
                      </Badge>
                      {meeting.status !== 'scheduled' && (
                        <Badge className={cn('text-xs', statusConfig[meeting.status].className)}>
                          {meeting.status === 'completed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {statusConfig[meeting.status].label}
                        </Badge>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          {meetingDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </span>
                        <span>({meeting.duration} min)</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <span className="text-muted-foreground">With:</span>
                      <span className="font-medium">Dr. {physician?.lastName}</span>
                      {meetingProviders.length > 0 && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <span>
                            {meetingProviders.map(p => p.firstName).join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                    
                    {meeting.type === 'chart_review' && meeting.chartCount && (
                      <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                        <FileText className="h-3.5 w-3.5" />
                        <span>{meeting.chartCount} charts reviewed</span>
                      </div>
                    )}
                    
                    {meeting.notes && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {meeting.notes}
                      </p>
                    )}
                  </div>
                  
                  <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No meetings scheduled</p>
            <Button variant="outline" className="mt-4" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Schedule Meeting
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
