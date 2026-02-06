import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useEventAttestations,
  useGenerateAttestationTasks,
  useGenerateFollowUpTasks,
  type CalendarEvent,
} from '@/hooks/useCalendarEvents';
import { format } from 'date-fns';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  Download,
  RefreshCw,
  Loader2,
  PlayCircle,
  Video,
  FileText,
  Link,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttestationReportCardProps {
  event: CalendarEvent;
  compact?: boolean;
}

export function AttestationReportCard({ event, compact = false }: AttestationReportCardProps) {
  const { data: attestations, isLoading } = useEventAttestations(event.id);
  const generateTasksMutation = useGenerateAttestationTasks();
  const generateFollowUpsMutation = useGenerateFollowUpTasks();

  const completedCount = attestations?.filter(a => a.status === 'completed').length || 0;
  const pendingCount = attestations?.filter(a => a.status === 'pending').length || 0;
  const overdueCount = attestations?.filter(a => a.status === 'overdue').length || 0;
  const totalCount = attestations?.length || event.total_providers || 0;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const canGenerateTasks = event.status === 'scheduled' || 
    (event.status === 'completed' && totalCount === 0);
  const missingRecording = !event.recording_link;
  const missingNewsletter = !event.newsletter_article_id;
  const hasBlockers = missingRecording || missingNewsletter;

  const handleExportCSV = () => {
    if (!attestations) return;

    const headers = ['Provider Name', 'Email', 'Status', 'Due Date', 'Completed At', 'Reminders'];
    const rows = attestations.map(a => [
      a.provider_name,
      a.provider_email || '',
      a.status,
      format(new Date(a.due_at), 'yyyy-MM-dd'),
      a.completed_at ? format(new Date(a.completed_at), 'yyyy-MM-dd HH:mm') : '',
      a.reminder_count.toString(),
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attestation-report-${format(new Date(event.starts_at), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-success/20 text-success gap-1"><CheckCircle2 className="h-3 w-3" />Completed</Badge>;
      case 'overdue':
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Overdue</Badge>;
      default:
        return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">Attestations</span>
            <Badge variant={progressPercent === 100 ? 'default' : 'secondary'}>
              {progressPercent}%
            </Badge>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>
        <div className="text-sm text-muted-foreground">
          {completedCount}/{totalCount}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />
              Attestation Report
            </CardTitle>
            <CardDescription>
              {format(new Date(event.starts_at), 'MMMM d, yyyy')}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {event.recording_link && (
              <a href={event.recording_link} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <Video className="h-4 w-4 mr-1" />
                  Recording
                </Button>
              </a>
            )}
            {attestations && attestations.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-1" />
                Export CSV
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Overview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Completion Progress</span>
            <span className="font-medium">{completedCount} of {totalCount}</span>
          </div>
          <Progress value={progressPercent} className="h-3" />
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-4 w-4" />
              {completedCount} completed
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
              {pendingCount} pending
            </span>
            {overdueCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {overdueCount} overdue
              </span>
            )}
          </div>
        </div>

        <Separator />

        {/* Admin Actions */}
        {canGenerateTasks && (
          <div className="space-y-3">
            {hasBlockers && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Before generating tasks:</strong>
                  <ul className="list-disc list-inside mt-1 text-sm">
                    {missingRecording && <li>Add the recording link</li>}
                    {missingNewsletter && <li>Link the newsletter article</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Button
              onClick={() => generateTasksMutation.mutate(event.id)}
              disabled={hasBlockers || generateTasksMutation.isPending}
              className="w-full"
            >
              {generateTasksMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4 mr-2" />
              )}
              Generate Attestation Tasks
            </Button>
          </div>
        )}

        {/* Follow-up Actions */}
        {totalCount > 0 && (pendingCount > 0 || overdueCount > 0) && (
          <Button
            variant="outline"
            onClick={() => generateFollowUpsMutation.mutate(event.id)}
            disabled={generateFollowUpsMutation.isPending}
            className="w-full"
          >
            {generateFollowUpsMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Generate Follow-up Reminders ({pendingCount + overdueCount})
          </Button>
        )}

        {/* Attestation Table */}
        {attestations && attestations.length > 0 && (
          <>
            <Separator />
            <ScrollArea className="h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead className="text-right">Reminders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attestations.map((att) => (
                    <TableRow key={att.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{att.provider_name}</span>
                          {att.provider_email && (
                            <p className="text-xs text-muted-foreground">{att.provider_email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(att.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(att.due_at), 'MMM d')}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {att.completed_at 
                          ? format(new Date(att.completed_at), 'MMM d, h:mm a')
                          : '-'
                        }
                      </TableCell>
                      <TableCell className="text-right">
                        {att.reminder_count > 0 ? (
                          <Badge variant="outline">{att.reminder_count}</Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
