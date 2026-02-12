import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { Activity, CheckCircle2, UserPlus, AlertTriangle, ArrowRightLeft, FileText, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface ActivityItem {
  id: string;
  type: 'completed' | 'assigned' | 'created' | 'escalated' | 'status_change';
  title: string;
  actor_name: string | null;
  timestamp: string;
  detail?: string;
}

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircle2,
  assigned: UserPlus,
  created: FileText,
  escalated: AlertTriangle,
  status_change: ArrowRightLeft,
};

const ACTIVITY_COLORS: Record<string, string> = {
  completed: 'text-green-500',
  assigned: 'text-primary',
  created: 'text-muted-foreground',
  escalated: 'text-destructive',
  status_change: 'text-warning',
};

export function RecentActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      setLoading(true);
      try {
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // last 48h

        // Fetch recently completed tasks
        const { data: completed } = await supabase
          .from('agreement_tasks')
          .select('id, title, completed_at, assigned_to_name')
          .not('completed_at', 'is', null)
          .gte('completed_at', since)
          .order('completed_at', { ascending: false })
          .limit(10);

        // Fetch recently assigned tasks
        const { data: assigned } = await supabase
          .from('agreement_tasks')
          .select('id, title, assigned_at, assigned_to_name')
          .not('assigned_at', 'is', null)
          .gte('assigned_at', since)
          .order('assigned_at', { ascending: false })
          .limit(10);

        // Fetch recently created tasks
        const { data: created } = await supabase
          .from('agreement_tasks')
          .select('id, title, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(10);

        // Fetch recently escalated tasks
        const { data: escalated } = await supabase
          .from('agreement_tasks')
          .select('id, title, escalated_at, assigned_to_name')
          .eq('escalated', true)
          .not('escalated_at', 'is', null)
          .gte('escalated_at', since)
          .order('escalated_at', { ascending: false })
          .limit(5);

        const items: ActivityItem[] = [
          ...(completed || []).map(t => ({
            id: `completed-${t.id}`,
            type: 'completed' as const,
            title: t.title,
            actor_name: t.assigned_to_name,
            timestamp: t.completed_at!,
            detail: 'Completed',
          })),
          ...(assigned || []).map(t => ({
            id: `assigned-${t.id}`,
            type: 'assigned' as const,
            title: t.title,
            actor_name: t.assigned_to_name,
            timestamp: t.assigned_at!,
            detail: `Assigned to ${t.assigned_to_name || 'someone'}`,
          })),
          ...(created || []).map(t => ({
            id: `created-${t.id}`,
            type: 'created' as const,
            title: t.title,
            actor_name: null,
            timestamp: t.created_at,
            detail: 'Created',
          })),
          ...(escalated || []).map(t => ({
            id: `escalated-${t.id}`,
            type: 'escalated' as const,
            title: t.title,
            actor_name: t.assigned_to_name,
            timestamp: t.escalated_at!,
            detail: 'Escalated',
          })),
        ];

        // Sort by timestamp, deduplicate by task id (keep most recent event)
        items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        
        // Deduplicate: keep only the most recent activity per task
        const seen = new Set<string>();
        const deduplicated = items.filter(item => {
          const taskId = item.id.split('-').slice(1).join('-');
          if (seen.has(taskId)) return false;
          seen.add(taskId);
          return true;
        });

        setActivities(deduplicated.slice(0, 15));
      } catch (err) {
        console.error('Failed to fetch activity feed:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchActivity();
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Recent Activity
          <span className="ml-auto text-xs font-normal text-muted-foreground">Last 48h</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 bg-muted/50 rounded animate-pulse" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
        ) : (
          <ScrollArea className="h-[320px] -mr-3 pr-3">
            <div className="space-y-1">
              {activities.map(activity => {
                const Icon = ACTIVITY_ICONS[activity.type] || Clock;
                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-2.5 py-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                  >
                    <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', ACTIVITY_COLORS[activity.type])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate font-medium">{activity.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant="outline" className="text-[10px] px-1 font-normal">
                          {activity.detail}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
