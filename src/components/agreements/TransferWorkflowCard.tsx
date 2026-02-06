import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { 
  ArrowRightLeft, 
  CheckCircle2, 
  Clock, 
  XCircle,
  ChevronDown,
  ChevronUp,
  Users,
  FileText,
  Calendar,
  Bell,
  ClipboardCheck
} from 'lucide-react';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type Transfer = Tables<'agreement_transfers'>;
type Task = Tables<'agreement_tasks'>;

interface TransferWorkflowCardProps {
  transfer: Transfer;
  onUpdate?: () => void;
}

export function TransferWorkflowCard({ transfer, onUpdate }: TransferWorkflowCardProps) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchTasks = async () => {
      const { data, error } = await supabase
        .from('agreement_tasks')
        .select('*')
        .eq('transfer_id', transfer.id)
        .order('auto_trigger', { ascending: true })
        .order('created_at', { ascending: true });

      if (!error && data) {
        setTasks(data);
      }
      setLoading(false);
    };

    fetchTasks();
  }, [transfer.id]);

  const terminationTasks = tasks.filter(t => t.auto_trigger === 'transfer_termination');
  const initiationTasks = tasks.filter(t => t.auto_trigger === 'transfer_initiation');

  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const allTerminationComplete = terminationTasks.every(t => t.status === 'completed');
  const allInitiationComplete = initiationTasks.every(t => t.status === 'completed');

  const handleTaskToggle = async (task: Task) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('agreement_tasks')
      .update({
        status: newStatus,
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
        completed_by: newStatus === 'completed' ? user?.id : null,
      })
      .eq('id', task.id);

    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to update task.',
        variant: 'destructive',
      });
      return;
    }

    setTasks(prev => prev.map(t => 
      t.id === task.id 
        ? { ...t, status: newStatus, completed_at: newStatus === 'completed' ? new Date().toISOString() : null }
        : t
    ));

    // Check if transfer should be marked complete
    const updatedTasks = tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t);
    const allComplete = updatedTasks.every(t => t.status === 'completed');
    
    if (allComplete && transfer.status !== 'completed') {
      await supabase
        .from('agreement_transfers')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user?.id,
        })
        .eq('id', transfer.id);

      toast({
        title: 'Transfer complete',
        description: 'All workflow tasks have been completed.',
      });
      onUpdate?.();
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-success/10 text-success border-success/20">Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-primary/10 text-primary border-primary/20">In Progress</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'document':
        return <FileText className="h-4 w-4" />;
      case 'supervision_meeting':
        return <Calendar className="h-4 w-4" />;
      case 'notification':
        return <Bell className="h-4 w-4" />;
      case 'chart_review':
        return <ClipboardCheck className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const TaskList = ({ taskList, title, phase }: { taskList: Task[]; title: string; phase: 'termination' | 'initiation' }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <Badge variant="outline" className="text-xs">
          {taskList.filter(t => t.status === 'completed').length}/{taskList.length}
        </Badge>
        {(phase === 'termination' ? allTerminationComplete : allInitiationComplete) && (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
      </div>
      <div className="space-y-1">
        {taskList.map(task => (
          <div
            key={task.id}
            className={cn(
              "flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors",
              task.status === 'completed' && 'opacity-60'
            )}
          >
            <Checkbox
              checked={task.status === 'completed'}
              onCheckedChange={() => handleTaskToggle(task)}
            />
            <div className="text-muted-foreground">
              {getCategoryIcon(task.category)}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-sm",
                task.status === 'completed' && 'line-through'
              )}>
                {task.title}
              </p>
            </div>
            {task.status === 'completed' && task.completed_at && (
              <span className="text-xs text-muted-foreground">
                {format(new Date(task.completed_at), 'MMM d')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader 
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {transfer.state_name} Transfer
                {getStatusBadge(transfer.status)}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <span>{transfer.source_physician_name || 'Unassigned'}</span>
                <ArrowRightLeft className="h-3 w-3" />
                <span>{transfer.target_physician_name}</span>
                <span className="text-muted-foreground">•</span>
                <Users className="h-3 w-3" />
                <span>{transfer.affected_provider_count} provider(s)</span>
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">{completedTasks}/{totalTasks} tasks</p>
              <Progress value={progress} className="w-24 h-2" />
            </div>
            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <Separator className="mb-4" />
          
          {loading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-8 bg-muted rounded" />
              <div className="h-8 bg-muted rounded" />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <TaskList 
                taskList={terminationTasks} 
                title="1. Termination Tasks" 
                phase="termination"
              />
              <TaskList 
                taskList={initiationTasks} 
                title="2. Initiation Tasks" 
                phase="initiation"
              />
            </div>
          )}

          {transfer.effective_date && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Effective Date: <span className="font-medium text-foreground">{format(new Date(transfer.effective_date), 'MMMM d, yyyy')}</span>
              </p>
            </div>
          )}

          {transfer.notes && (
            <div className="mt-4 p-3 bg-muted/50 rounded-md">
              <p className="text-sm text-muted-foreground">{transfer.notes}</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}