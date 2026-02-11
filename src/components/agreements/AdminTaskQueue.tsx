import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow, isAfter, isBefore, addDays } from 'date-fns';
import {
  ClipboardList,
  Clock,
  AlertTriangle,
  Flag,
  Calendar,
  User,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ArrowRightLeft
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Task = Tables<'agreement_tasks'>;

interface AdminTaskQueueProps {
  className?: string;
  compact?: boolean;
}

export function AdminTaskQueue({ className, compact = false }: AdminTaskQueueProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'assigned' | 'overdue' | 'blocked' | 'thisWeek'>('assigned');

  useEffect(() => {
    fetchTasks();
  }, [profile?.id]);

  const fetchTasks = async () => {
    if (!profile?.id) return;
    
    setLoading(true);
    try {
      // Fetch all incomplete tasks
      const { data, error } = await supabase
        .from('agreement_tasks')
        .select('*')
        .not('status', 'in', '("completed","archived")')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('priority', { ascending: false });

      if (!error && data) {
        setTasks(data);
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleComplete = async (task: Task) => {
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase
      .from('agreement_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: user?.id,
      })
      .eq('id', task.id);

    // Log if it's a transfer task
    if (task.transfer_id) {
      await supabase.from('transfer_activity_log').insert({
        transfer_id: task.transfer_id,
        task_id: task.id,
        activity_type: 'task_completed',
        actor_id: user?.id,
        actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
        actor_role: 'admin',
        description: `Completed: ${task.title}`,
      });
    }

    fetchTasks();
  };

  const now = new Date();
  const weekFromNow = addDays(now, 7);

  // Filter tasks by category
  const assignedToMe = tasks.filter(t => t.assigned_to === profile?.id);
  const overdueTasks = tasks.filter(t => t.due_date && isBefore(new Date(t.due_date), now));
  const blockedTasks = tasks.filter(t => t.status === 'blocked' || t.escalated);
  const thisWeekTasks = tasks.filter(t => 
    t.due_date && 
    isAfter(new Date(t.due_date), now) && 
    isBefore(new Date(t.due_date), weekFromNow)
  );

  const tabCounts = {
    assigned: assignedToMe.length,
    overdue: overdueTasks.length,
    blocked: blockedTasks.length,
    thisWeek: thisWeekTasks.length,
  };

  const getFilteredTasks = () => {
    switch (activeTab) {
      case 'assigned': return assignedToMe;
      case 'overdue': return overdueTasks;
      case 'blocked': return blockedTasks;
      case 'thisWeek': return thisWeekTasks;
      default: return [];
    }
  };

  const getPriorityBadge = (priority: string | null) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive" className="text-[10px]">High</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="text-[10px]">Med</Badge>;
      default:
        return null;
    }
  };

  const TaskRow = ({ task }: { task: Task }) => {
    const isOverdue = task.due_date && isBefore(new Date(task.due_date), now);
    
    return (
      <div 
        className={cn(
          "flex items-center gap-3 p-3 border-b last:border-0 hover:bg-muted/30 transition-colors group cursor-pointer",
          isOverdue && "bg-destructive/5"
        )}
        onClick={() => {
          if (task.agreement_id) {
            navigate(`/admin/agreements/${task.agreement_id}`);
          }
        }}
      >
        <Checkbox
          checked={task.status === 'completed'}
          onCheckedChange={(e) => {
            e && handleToggleComplete(task);
          }}
          onClick={(e) => e.stopPropagation()}
        />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{task.title}</span>
            {getPriorityBadge(task.priority)}
            {task.escalated && (
              <Flag className="h-3 w-3 text-destructive" />
            )}
            {task.is_required && (
              <Badge variant="outline" className="text-[10px]">Required</Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            {task.state_abbreviation && (
              <Badge variant="outline" className="text-[10px]">{task.state_abbreviation}</Badge>
            )}
            {task.transfer_id && (
              <span className="flex items-center gap-1">
                <ArrowRightLeft className="h-3 w-3" />
                Transfer
              </span>
            )}
            {task.assigned_to_name && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {task.assigned_to_name}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {task.due_date && (
            <span className={cn(
              "text-xs flex items-center gap-1",
              isOverdue ? "text-destructive" : "text-muted-foreground"
            )}>
              <Calendar className="h-3 w-3" />
              {isOverdue 
                ? `${formatDistanceToNow(new Date(task.due_date))} overdue`
                : format(new Date(task.due_date), 'MMM d')
              }
            </span>
          )}
          {task.agreement_id && (
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            My Task Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-3 flex-wrap">
            <Badge 
              variant={overdueTasks.length > 0 ? 'destructive' : 'secondary'} 
              className="gap-1"
            >
              <AlertTriangle className="h-3 w-3" />
              {overdueTasks.length} overdue
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <User className="h-3 w-3" />
              {assignedToMe.length} assigned
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Flag className="h-3 w-3" />
              {blockedTasks.length} blocked
            </Badge>
          </div>
          
          <ScrollArea className="h-[200px]">
            {assignedToMe.slice(0, 5).map(task => (
              <TaskRow key={task.id} task={task} />
            ))}
            {assignedToMe.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No tasks assigned to you
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Task Queue
        </CardTitle>
        <CardDescription>
          {tasks.length} open tasks • {overdueTasks.length} overdue
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="grid grid-cols-4 mb-4">
            <TabsTrigger value="assigned" className="gap-1">
              <User className="h-3 w-3" />
              Mine
              {tabCounts.assigned > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px]">
                  {tabCounts.assigned}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="overdue" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Overdue
              {tabCounts.overdue > 0 && (
                <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px]">
                  {tabCounts.overdue}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="blocked" className="gap-1">
              <Flag className="h-3 w-3" />
              Blocked
              {tabCounts.blocked > 0 && (
                <Badge className="h-5 min-w-5 px-1 text-[10px] bg-warning/20 text-warning">
                  {tabCounts.blocked}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="thisWeek" className="gap-1">
              <Calendar className="h-3 w-3" />
              This Week
              {tabCounts.thisWeek > 0 && (
                <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px]">
                  {tabCounts.thisWeek}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[400px]">
            {getFilteredTasks().length > 0 ? (
              getFilteredTasks().map(task => (
                <TaskRow key={task.id} task={task} />
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No tasks in this category</p>
              </div>
            )}
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}
