import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Clock, FileText, Calendar, ShieldCheck, Cake, ArrowRightLeft,
  Flag, Lock, ListChecks, UserPlus, MapPin, MoreVertical,
  Archive, UserCog, User, Plus, ChevronDown, RefreshCw, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';

type TaskFilter = 'all' | 'unassigned' | 'mine' | 'blocked' | 'escalated' | 'archived';

interface AdminTaskQueueProps {
  actionableTasks: DashboardTaskItem[];
  archivedTasks: DashboardTaskItem[];
  loading: boolean;
  userId?: string;
  refetch: () => void;
  onEditTask: (task: DashboardTaskItem) => void;
  onArchiveTask: (task: { id: string; title: string }) => void;
  onReassignTask: (task: { id: string; title: string; assignee: string | null }) => void;
  onAddTask: () => void;
}

const GROUP_MAP: Record<string, string> = {
  document: 'documents',
  signature: 'documents',
  supervision_meeting: 'clinical',
  chart_review: 'clinical',
  compliance: 'clinical',
  transfer: 'workflows',
  onboarding: 'workflows',
  milestone: 'milestones',
  outreach: 'outreach',
  communication: 'outreach',
};

const GROUP_LABELS: Record<string, string> = {
  documents: 'Documents & Signatures',
  clinical: 'Clinical Oversight',
  workflows: 'Workflows & Transfers',
  milestones: 'Milestones',
  outreach: 'Outreach & Communication',
  general: 'General',
};

function getCategoryIcon(category: string) {
  switch (category) {
    case 'documents': case 'document': case 'signature': return <FileText className="h-3.5 w-3.5" />;
    case 'clinical': case 'supervision_meeting': case 'chart_review': case 'compliance': return <ShieldCheck className="h-3.5 w-3.5" />;
    case 'workflows': return <ArrowRightLeft className="h-3.5 w-3.5" />;
    case 'outreach': case 'communication': return <Users className="h-3.5 w-3.5" />;
    case 'milestones': case 'milestone': return <Cake className="h-3.5 w-3.5" />;
    default: return <ListChecks className="h-3.5 w-3.5" />;
  }
}

function getPriorityColor(priority: string | null) {
  switch (priority) {
    case 'critical': return 'text-destructive';
    case 'high': return 'text-warning';
    default: return 'text-muted-foreground';
  }
}

export function AdminTaskQueue({
  actionableTasks, archivedTasks, loading, userId, refetch,
  onEditTask, onArchiveTask, onReassignTask, onAddTask,
}: AdminTaskQueueProps) {
  const { toast } = useToast();
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');

  const unassignedCount = actionableTasks.filter(t => !t.assigned_to).length;
  const myTaskCount = actionableTasks.filter(t => t.assigned_to === userId).length;
  const blockedCount = actionableTasks.filter(t => t.status === 'blocked' || t.status === 'waiting_on_signature').length;
  const escalatedCount = actionableTasks.filter(t => t.escalated).length;

  const filteredTasks = taskFilter === 'archived'
    ? archivedTasks
    : actionableTasks.filter(task => {
        switch (taskFilter) {
          case 'unassigned': return !task.assigned_to;
          case 'mine': return task.assigned_to === userId;
          case 'blocked': return task.status === 'blocked' || task.status === 'waiting_on_signature';
          case 'escalated': return task.escalated;
          default: return true;
        }
      });

  const handleSelfAssign = async (taskId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: prof } = await supabase.from('profiles').select('full_name, email').eq('user_id', user.id).maybeSingle();
      const displayName = prof?.full_name || prof?.email || user.email || 'Unknown';
      await supabase.from('agreement_tasks').update({
        assigned_to: user.id,
        assigned_to_name: displayName,
        assigned_at: new Date().toISOString(),
      }).eq('id', taskId);
      toast({ title: 'Task claimed', description: `Assigned to ${displayName}` });
      refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const grouped = filteredTasks.reduce<Record<string, DashboardTaskItem[]>>((acc, task) => {
    const cat = GROUP_MAP[task.category] || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(task);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Actionable Tasks</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={onAddTask}>
              <Plus className="h-3.5 w-3.5" /> Add Task
            </Button>
            <Button variant="ghost" size="sm" onClick={refetch}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {([
            { key: 'all' as const, label: 'All', count: actionableTasks.length },
            { key: 'unassigned' as const, label: 'Unassigned', count: unassignedCount },
            { key: 'mine' as const, label: 'My Tasks', count: myTaskCount },
            { key: 'blocked' as const, label: 'Blocked', count: blockedCount },
            { key: 'escalated' as const, label: 'Escalated', count: escalatedCount },
            { key: 'archived' as const, label: 'Archived', count: archivedTasks.length },
          ]).map(f => (
            <Button
              key={f.key}
              variant={taskFilter === f.key ? 'secondary' : 'ghost'}
              size="sm"
              className="text-xs h-7"
              onClick={() => setTaskFilter(f.key)}
            >
              {f.label}
              {f.count > 0 && <Badge variant="outline" className="ml-1 text-[10px] px-1">{f.count}</Badge>}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-20 rounded-lg" />
              </div>
            ))}
          </div>
        ) : filteredTasks.length > 0 ? (
          <div className="space-y-4">
            {Object.entries(grouped).map(([category, tasks]) => (
              <Collapsible key={category} defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-2 mb-2 w-full group/collapse hover:bg-muted/30 rounded px-1 py-1 transition-colors">
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]/collapse:-rotate-90" />
                  <span className="text-muted-foreground">{getCategoryIcon(category)}</span>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {GROUP_LABELS[category] || category.replace(/_/g, ' ')}
                  </h4>
                  <Badge variant="outline" className="text-[10px] px-1">{tasks.length}</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1.5">
                    {tasks.map(task => (
                      <div
                        key={task.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors group cursor-pointer",
                          task.escalated && "border-destructive/30 bg-destructive/5",
                          (task.status === 'blocked' || task.status === 'waiting_on_signature') && "border-warning/30 bg-warning/5",
                          task.status === 'archived' && "opacity-60"
                        )}
                        onClick={() => onEditTask(task)}
                      >
                        <div className={cn("text-muted-foreground", getPriorityColor(task.priority))}>
                          {task.priority === 'critical' ? <Flag className="h-3.5 w-3.5" /> : getCategoryIcon(task.category)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{task.title}</p>
                            {task.escalated && (
                              <Badge variant="destructive" className="text-[10px] gap-0.5 px-1">
                                <Flag className="h-2.5 w-2.5" /> Escalated
                              </Badge>
                            )}
                            {(task.status === 'blocked' || task.status === 'waiting_on_signature') && (
                              <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px] gap-0.5 px-1">
                                <Lock className="h-2.5 w-2.5" /> {task.status === 'waiting_on_signature' ? 'Waiting Signature' : 'Blocked'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                            {task.state_name && (
                              <span className="flex items-center gap-0.5">
                                <MapPin className="h-3 w-3" />
                                {task.state_abbreviation || task.state_name}
                              </span>
                            )}
                            {task.linked_providers && task.linked_providers.length > 0 ? (
                              task.linked_providers.map((lp, i) => (
                                <Badge key={i} variant="outline" className="text-[10px] px-1.5 gap-0.5 font-normal">
                                  <User className="h-2.5 w-2.5" />
                                  {lp.full_name || 'Unknown'}
                                  <span className="text-muted-foreground">({lp.role_label})</span>
                                </Badge>
                              ))
                            ) : task.provider_name ? (
                              <span>• {task.provider_name}</span>
                            ) : null}
                            {task.transfer_id && <Badge variant="outline" className="text-[10px] px-1">Transfer</Badge>}
                            {task.due_date && (
                              <span className={cn(
                                "flex items-center gap-0.5",
                                new Date(task.due_date) < new Date() && "text-destructive"
                              )}>
                                <Clock className="h-3 w-3" />
                                Due {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                          {task.blocked_reason && (
                            <p className="text-xs text-warning mt-0.5 truncate">{task.blocked_reason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {task.assigned_to_name ? (
                            <Badge variant="outline" className="text-xs">{task.assigned_to_name}</Badge>
                          ) : (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 text-xs text-muted-foreground hover:text-primary gap-1"
                              onClick={() => handleSelfAssign(task.id)}
                            >
                              <UserPlus className="h-3 w-3" /> Claim
                            </Button>
                          )}
                          {task.status !== 'archived' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => onReassignTask({ id: task.id, title: task.title, assignee: task.assigned_to })}>
                                  <UserCog className="h-3.5 w-3.5 mr-2" /> Reassign
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onArchiveTask({ id: task.id, title: task.title })} className="text-destructive focus:text-destructive">
                                  <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ListChecks className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No tasks found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {taskFilter === 'all'
                ? 'All tasks are completed — great work!'
                : `No ${taskFilter} tasks at this time`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
