import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { format, isPast, isFuture, isToday } from 'date-fns';
import {
  Calendar,
  Video,
  Users,
  Edit,
  ExternalLink,
  CheckCircle2,
  Clock,
  FileText,
} from 'lucide-react';
import { AllHandsEventForm } from './AllHandsEventForm';
import { AttestationReportCard } from './AttestationReportCard';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';
import { cn } from '@/lib/utils';

interface CalendarEventCardProps {
  event: CalendarEvent;
  showDetails?: boolean;
  isAdmin?: boolean;
}

export function CalendarEventCard({ event, showDetails = false, isAdmin = false }: CalendarEventCardProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const eventDate = new Date(event.starts_at);
  const isPastEvent = isPast(eventDate);
  const isUpcoming = isFuture(eventDate);
  const isTodayEvent = isToday(eventDate);

  const progressPercent = event.total_providers > 0
    ? Math.round((event.completed_attestations / event.total_providers) * 100)
    : 0;

  const getStatusBadge = () => {
    if (event.status === 'cancelled') {
      return <Badge variant="destructive">Cancelled</Badge>;
    }
    if (event.status === 'completed') {
      return <Badge className="bg-success/20 text-success">Completed</Badge>;
    }
    if (isTodayEvent) {
      return <Badge className="bg-primary/20 text-primary animate-pulse">Today</Badge>;
    }
    if (isPastEvent) {
      return <Badge variant="secondary">Past</Badge>;
    }
    return <Badge variant="outline">Scheduled</Badge>;
  };

  const getEventTypeLabel = () => {
    switch (event.event_type) {
      case 'provider_all_hands':
        return 'All-Hands';
      case 'training':
        return 'Training';
      case 'town_hall':
        return 'Town Hall';
      default:
        return event.event_type;
    }
  };

  return (
    <>
      <Card className={cn(
        'transition-all',
        isTodayEvent && 'ring-2 ring-primary/50',
        isPastEvent && event.status !== 'completed' && 'opacity-75'
      )}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">{event.title}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {format(eventDate, 'EEEE, MMMM d, yyyy')} at {format(eventDate, 'h:mm a')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{getEventTypeLabel()}</Badge>
              {getStatusBadge()}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Description */}
          {event.description && (
            <p className="text-sm text-muted-foreground">{event.description}</p>
          )}

          {/* Links */}
          <div className="flex flex-wrap items-center gap-2">
            {isUpcoming && event.meeting_link && (
              <a href={event.meeting_link} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <Video className="h-4 w-4 mr-1" />
                  Join Meeting
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </a>
            )}
            {isPastEvent && event.recording_link && (
              <a href={event.recording_link} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <Video className="h-4 w-4 mr-1" />
                  Recording
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </a>
            )}
            {event.newsletter_article_id && (
              <Button variant="outline" size="sm">
                <FileText className="h-4 w-4 mr-1" />
                Newsletter
              </Button>
            )}
          </div>

          {/* Attestation Progress (Admin view) */}
          {isAdmin && event.attestation_required && event.total_providers > 0 && (
            <div className="p-3 bg-muted/30 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  Attestations
                </span>
                <span className="font-medium">
                  {event.completed_attestations}/{event.total_providers}
                  <span className="text-muted-foreground ml-1">({progressPercent}%)</span>
                </span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setShowReport(!showReport)}
              >
                {showReport ? 'Hide Report' : 'View Full Report'}
              </Button>
            </div>
          )}

          {/* Admin Actions */}
          {isAdmin && (
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={() => setEditDialogOpen(true)}>
                <Edit className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </div>
          )}

          {/* Full Report */}
          {showReport && isAdmin && (
            <AttestationReportCard event={event} />
          )}
        </CardContent>
      </Card>

      <AllHandsEventForm
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        event={event}
      />
    </>
  );
}
