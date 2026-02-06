import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useMyEventAttestations, useCompleteAttestation } from '@/hooks/useCalendarEvents';
import { format, formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Video,
  FileText,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface ProviderAttestationCardProps {
  className?: string;
}

export function ProviderAttestationCard({ className }: ProviderAttestationCardProps) {
  const { data: attestations, isLoading } = useMyEventAttestations();
  const completeMutation = useCompleteAttestation();

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!attestations || attestations.length === 0) {
    return null;
  }

  return (
    <Card className={cn('border-primary/20', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />
          All-Hands Attestations
          <Badge variant="secondary">{attestations.length} pending</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {attestations.map((attestation) => {
          const event = attestation.event as any;
          const isOverdue = new Date(attestation.due_at) < new Date();
          
          return (
            <div
              key={attestation.id}
              className={cn(
                'p-4 rounded-lg border',
                isOverdue && 'border-destructive/30 bg-destructive/5'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h4 className="font-medium">{event?.title || 'Provider All-Hands'}</h4>
                  <p className="text-sm text-muted-foreground">
                    {event?.starts_at && format(new Date(event.starts_at), 'MMMM d, yyyy')}
                  </p>
                  
                  <div className="flex items-center gap-2 mt-2">
                    {isOverdue ? (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Overdue
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <Clock className="h-3 w-3" />
                        Due {formatDistanceToNow(new Date(attestation.due_at), { addSuffix: true })}
                      </Badge>
                    )}
                  </div>
                </div>

                <Button
                  onClick={() => completeMutation.mutate(attestation.id)}
                  disabled={completeMutation.isPending}
                  size="sm"
                >
                  {completeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                  )}
                  Mark Attested
                </Button>
              </div>

              <Separator className="my-3" />

              <div className="flex flex-wrap items-center gap-2">
                {event?.recording_link && (
                  <a
                    href={event.recording_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Video className="h-4 w-4" />
                    Watch Recording
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {event?.newsletter_article_id && (
                  <Link
                    to={`/knowledge?article=${event.newsletter_article_id}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    Read Newsletter
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Please review the recording and newsletter, then click "Mark Attested" to complete.
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
