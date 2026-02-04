import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { 
  Mail, 
  Send, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

type Notification = Tables<'agreement_notifications'>;

interface NotificationQueueProps {
  agreementId?: string;
  className?: string;
}

export function NotificationQueue({ agreementId, className }: NotificationQueueProps) {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    setLoading(true);
    
    let query = supabase
      .from('agreement_notifications')
      .select('*')
      .order('created_at', { ascending: false });

    if (agreementId) {
      query = query.eq('agreement_id', agreementId);
    }

    const { data, error } = await query.limit(50);

    if (error) {
      console.error('Error fetching notifications:', error);
    } else {
      setNotifications(data || []);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    fetchNotifications();
  }, [agreementId]);

  const markAsDelivered = async (notificationId: string) => {
    const { error } = await supabase
      .from('agreement_notifications')
      .update({ 
        delivered: true, 
        sent_at: new Date().toISOString() 
      })
      .eq('id', notificationId);

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to update notification status.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Marked as delivered',
        description: 'Notification has been marked as sent.',
      });
      fetchNotifications();
    }
  };

  const getNotificationTypeLabel = (type: Notification['notification_type']) => {
    const labels: Record<typeof type, string> = {
      agreement_initiated: 'Agreement Initiated',
      signature_requested: 'Signature Requested',
      signature_reminder: 'Signature Reminder',
      agreement_executed: 'Agreement Executed',
      meeting_scheduled: 'Meeting Scheduled',
      termination_initiated: 'Termination Notice',
      termination_complete: 'Termination Complete',
    };
    return labels[type];
  };

  const getStatusBadge = (notification: Notification) => {
    if (notification.delivered) {
      return (
        <Badge variant="outline" className="text-primary border-primary">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Delivered
        </Badge>
      );
    }
    if (notification.error_message) {
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  const pendingCount = notifications.filter(n => !n.delivered && !n.error_message).length;

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base">Notification Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-10 bg-muted rounded" />
            <div className="h-10 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Notification Queue
          </CardTitle>
          {pendingCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {pendingCount} pending notification{pendingCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={fetchNotifications}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No notifications in queue</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notifications.map(notification => (
                  <TableRow key={notification.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{notification.recipient_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {notification.recipient_email}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {getNotificationTypeLabel(notification.notification_type)}
                      </span>
                    </TableCell>
                    <TableCell>{getStatusBadge(notification)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(notification.created_at), 'MMM d, h:mm a')}
                    </TableCell>
                    <TableCell>
                      {!notification.delivered && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markAsDelivered(notification.id)}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
