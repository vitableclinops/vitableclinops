import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { 
  ArrowRightLeft, 
  CheckCircle2, 
  Clock,
  Users,
  Calendar,
  ChevronRight
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Transfer = Tables<'agreement_transfers'>;
type Task = Tables<'agreement_tasks'>;

interface TransferWithProgress extends Transfer {
  tasks: Task[];
  completedCount: number;
  totalCount: number;
}

interface MyTransfersWidgetProps {
  className?: string;
}

export function MyTransfersWidget({ className }: MyTransfersWidgetProps) {
  const { profile, hasRole } = useAuth();
  const [transfers, setTransfers] = useState<TransferWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMyTransfers = async () => {
      if (!profile?.id) return;

      let query = supabase.from('agreement_transfers').select('*');

      // Different queries based on role
      if (hasRole('provider')) {
        // Providers see transfers that affect them
        query = query.contains('affected_provider_ids', [profile.id]);
      } else if (hasRole('physician')) {
        // Physicians see transfers involving them as source or target
        query = query.or(`source_physician_id.eq.${profile.id},target_physician_id.eq.${profile.id}`);
      }

      // Only show pending or in_progress transfers
      query = query.in('status', ['pending', 'in_progress']);

      const { data: transferData, error } = await query.order('created_at', { ascending: false });

      if (error || !transferData) {
        setLoading(false);
        return;
      }

      // Fetch tasks for each transfer
      const transfersWithProgress: TransferWithProgress[] = [];
      
      for (const transfer of transferData) {
        const { data: tasks } = await supabase
          .from('agreement_tasks')
          .select('*')
          .eq('transfer_id', transfer.id);

        const taskList = tasks || [];
        transfersWithProgress.push({
          ...transfer,
          tasks: taskList,
          completedCount: taskList.filter(t => t.status === 'completed').length,
          totalCount: taskList.length,
        });
      }

      setTransfers(transfersWithProgress);
      setLoading(false);
    };

    fetchMyTransfers();
  }, [profile?.id, hasRole]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-success/10 text-success border-success/20">Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-primary/10 text-primary border-primary/20">In Progress</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-16 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (transfers.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-primary" />
          Active Transfers
        </CardTitle>
        <CardDescription>
          {hasRole('provider') 
            ? 'Your collaborative agreements being transferred to a new physician'
            : 'Transfers involving you as a supervising physician'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-3">
            {transfers.map(transfer => {
              const progress = transfer.totalCount > 0 
                ? (transfer.completedCount / transfer.totalCount) * 100 
                : 0;

              return (
                <div 
                  key={transfer.id}
                  className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{transfer.state_abbreviation}</Badge>
                      {getStatusBadge(transfer.status)}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm mb-3">
                    <span className="text-muted-foreground">
                      {transfer.source_physician_name || 'Unassigned'}
                    </span>
                    <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">
                      {transfer.target_physician_name}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium">
                      {transfer.completedCount}/{transfer.totalCount} tasks
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />

                  {transfer.effective_date && (
                    <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>Effective: {format(new Date(transfer.effective_date), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
