import { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { CheckCircle2, UserPlus, AlertTriangle, Clock, Flag } from 'lucide-react';

interface Notification {
  id: string;
  type: 'assigned' | 'overdue' | 'escalated' | 'blocked';
  title: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Tasks assigned to me recently
    const { data: assigned } = await supabase
      .from('agreement_tasks')
      .select('id, title, assigned_at')
      .eq('assigned_to', user.id)
      .not('assigned_at', 'is', null)
      .gte('assigned_at', since24h)
      .in('status', ['pending', 'in_progress', 'blocked', 'waiting_on_signature'])
      .order('assigned_at', { ascending: false })
      .limit(10);

    // My overdue tasks
    const { data: overdue } = await supabase
      .from('agreement_tasks')
      .select('id, title, due_date')
      .eq('assigned_to', user.id)
      .in('status', ['pending', 'in_progress'])
      .not('due_date', 'is', null)
      .lt('due_date', now.toISOString())
      .order('due_date', { ascending: true })
      .limit(10);

    // My escalated tasks
    const { data: escalated } = await supabase
      .from('agreement_tasks')
      .select('id, title, escalated_at')
      .eq('assigned_to', user.id)
      .eq('escalated', true)
      .in('status', ['pending', 'in_progress', 'blocked', 'waiting_on_signature'])
      .order('escalated_at', { ascending: false })
      .limit(5);

    // Read state from localStorage
    const readIds = JSON.parse(localStorage.getItem('notification_read_ids') || '[]') as string[];
    const readSet = new Set(readIds);

    const items: Notification[] = [
      ...(assigned || []).map(t => ({
        id: `assigned-${t.id}`,
        type: 'assigned' as const,
        title: t.title,
        detail: 'Assigned to you',
        timestamp: t.assigned_at!,
        read: readSet.has(`assigned-${t.id}`),
      })),
      ...(overdue || []).map(t => ({
        id: `overdue-${t.id}`,
        type: 'overdue' as const,
        title: t.title,
        detail: `Due ${new Date(t.due_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        timestamp: t.due_date!,
        read: readSet.has(`overdue-${t.id}`),
      })),
      ...(escalated || []).map(t => ({
        id: `escalated-${t.id}`,
        type: 'escalated' as const,
        title: t.title,
        detail: 'Escalated — needs attention',
        timestamp: t.escalated_at || new Date().toISOString(),
        read: readSet.has(`escalated-${t.id}`),
      })),
    ];

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setNotifications(items);
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    const allIds = notifications.map(n => n.id);
    localStorage.setItem('notification_read_ids', JSON.stringify(allIds));
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    assigned: UserPlus,
    overdue: Clock,
    escalated: Flag,
    blocked: AlertTriangle,
  };

  const COLOR_MAP: Record<string, string> = {
    assigned: 'text-primary',
    overdue: 'text-destructive',
    escalated: 'text-destructive',
    blocked: 'text-warning',
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-sidebar-foreground hover:bg-sidebar-accent">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1 animate-in zoom-in-50">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" side="right">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="text-sm font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[360px]">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No notifications</p>
          ) : (
            <div className="divide-y">
              {notifications.map(notification => {
                const Icon = ICON_MAP[notification.type] || Bell;
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors",
                      !notification.read && "bg-primary/5"
                    )}
                  >
                    <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', COLOR_MAP[notification.type])} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm truncate", !notification.read && "font-medium")}>
                        {notification.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{notification.detail}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}
                      </p>
                    </div>
                    {!notification.read && (
                      <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
