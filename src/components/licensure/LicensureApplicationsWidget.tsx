import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useProviderLicensureApplications, type LicensureApplication } from '@/hooks/useLicensureApplications';
import { FileText, ChevronRight, MapPin, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LicensureApplicationsWidgetProps {
  providerId: string;
}

const statusColors: Record<string, string> = {
  not_started: '',
  in_progress: 'bg-warning/10 text-warning',
  submitted: 'bg-primary/10 text-primary',
  approved: 'bg-success/10 text-success',
  blocked: 'bg-destructive/10 text-destructive',
  withdrawn: 'text-muted-foreground',
};

export function LicensureApplicationsWidget({ providerId }: LicensureApplicationsWidgetProps) {
  const { applications, loading } = useProviderLicensureApplications(providerId);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Licensure Applications
          </CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const active = applications.filter(a => a.status !== 'approved' && a.status !== 'withdrawn');
  const completed = applications.filter(a => a.status === 'approved');

  if (applications.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Licensure Applications
          {active.length > 0 && (
            <Badge variant="secondary" className="ml-auto">{active.length} active</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {active.map(app => (
          <Link
            key={app.id}
            to={`/licensure/${app.id}`}
            className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors group"
          >
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium group-hover:text-primary transition-colors">
                {app.state_name} — {app.designation_label}
              </p>
              <p className="text-xs text-muted-foreground">
                {{ not_started: 'Never Started', in_progress: 'In Progress', submitted: 'Submitted to State', approved: 'Approved', blocked: 'Blocked', withdrawn: 'Withdrawn' }[app.status] || app.status.replace(/_/g, ' ')}
              </p>
            </div>
            <Badge variant="secondary" className={cn('text-xs', statusColors[app.status])}>
              {{ not_started: 'Never Started', in_progress: 'In Progress', submitted: 'Submitted to State', approved: 'Approved', blocked: 'Blocked', withdrawn: 'Withdrawn' }[app.status] || app.status.replace(/_/g, ' ')}
            </Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </Link>
        ))}
        {completed.length > 0 && (
          <p className="text-xs text-muted-foreground pt-1">
            {completed.length} completed application{completed.length !== 1 ? 's' : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
