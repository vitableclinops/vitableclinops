import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { 
  UserPlus, 
  CheckCircle2, 
  ArrowRightLeft, 
  MessageSquare, 
  Clock,
  Activity
} from 'lucide-react';

interface ActivityEntry {
  id: string;
  activity_type: string;
  actor_name: string | null;
  actor_role: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface TransferActivityLogProps {
  transferId: string;
}

export function TransferActivityLog({ transferId }: TransferActivityLogProps) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivities = async () => {
      const { data, error } = await supabase
        .from('transfer_activity_log')
        .select('*')
        .eq('transfer_id', transferId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setActivities(data as ActivityEntry[]);
      }
      setLoading(false);
    };

    fetchActivities();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`transfer-activity-${transferId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transfer_activity_log',
          filter: `transfer_id=eq.${transferId}`,
        },
        (payload) => {
          setActivities(prev => [payload.new as ActivityEntry, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [transferId]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'task_assigned':
      case 'task_reassigned':
        return <UserPlus className="h-4 w-4 text-primary" />;
      case 'task_completed':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'status_changed':
        return <ArrowRightLeft className="h-4 w-4 text-warning" />;
      case 'note_added':
        return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-2 p-2">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
        <Clock className="h-4 w-4" />
        No activity yet
      </div>
    );
  }

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-2 p-2">
        {activities.map(activity => (
          <div 
            key={activity.id} 
            className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
          >
            <div className="mt-0.5">
              {getActivityIcon(activity.activity_type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm">{activity.description}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">
                  {activity.actor_name || 'System'}
                </span>
                {activity.actor_role && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {activity.actor_role}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {format(new Date(activity.created_at), 'MMM d, h:mm a')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
