import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Clock, UserX } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';

interface StaleTaskAlertsProps {
  tasks: DashboardTaskItem[];
}

const UNASSIGNED_WARN_DAYS = 2;
const BLOCKED_WARN_DAYS = 3;

export function StaleTaskAlerts({ tasks }: StaleTaskAlertsProps) {
  const now = new Date();

  const staleUnassigned = tasks.filter(t => {
    if (t.assigned_to) return false;
    if (!t.due_date) return true; // no due date + unassigned = warn
    return differenceInDays(now, new Date(t.due_date)) >= -UNASSIGNED_WARN_DAYS;
  });

  const staleBlocked = tasks.filter(t => {
    if (t.status !== 'blocked' && t.status !== 'waiting_on_signature') return false;
    if (!t.due_date) return false;
    return differenceInDays(now, new Date(t.due_date)) >= -BLOCKED_WARN_DAYS;
  });

  const alerts = [
    ...staleUnassigned.map(t => ({
      id: t.id,
      title: t.title,
      type: 'unassigned' as const,
      message: 'Unassigned',
    })),
    ...staleBlocked.map(t => ({
      id: t.id,
      title: t.title,
      type: 'blocked' as const,
      message: t.blocked_reason || 'Blocked',
    })),
  ].slice(0, 5);

  if (alerts.length === 0) return null;

  return (
    <Card className="border-warning/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Attention Needed
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map(alert => (
          <div
            key={alert.id}
            className="flex items-start gap-2 text-sm p-2 rounded-md bg-warning/5"
          >
            {alert.type === 'unassigned' ? (
              <UserX className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
            ) : (
              <Clock className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-medium truncate">{alert.title}</p>
              <p className="text-xs text-muted-foreground">{alert.message}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
