import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { EditableTaskItem } from './EditableTaskItem';
import { AddTaskButton } from './AddTaskButton';
import { TransferActivityLog } from './TransferActivityLog';
import { TransferLifecycleEditor } from './TransferLifecycleEditor';
import { TransferProviderSubtable } from './TransferProviderSubtable';
import { TransferEffectiveDatesEditor } from './TransferEffectiveDatesEditor';
import { EffectiveDateWarnings } from './EffectiveDateWarnings';
import { WorkflowReadinessBanner } from '@/components/workflows/WorkflowReadinessBanner';
import { computeTransferReadiness } from '@/hooks/useWorkflowReadiness';
import { 
  ArrowRightLeft, 
  CheckCircle2, 
  Clock, 
  ChevronDown,
  ChevronUp,
  Users,
  Activity,
  ListChecks,
  AlertTriangle,
  Lock,
  Flag,
  Calendar
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
  const { hasRole } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('checklist');

  const isAdmin = hasRole('admin');

  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from('agreement_tasks')
      .select('*')
      .eq('transfer_id', transfer.id)
      .order('sort_order', { ascending: true })
      .order('auto_trigger', { ascending: true })
      .order('created_at', { ascending: true });

    if (!error && data) {
      setTasks(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
  }, [transfer.id]);

  // Separate by phase
  const terminationTasks = tasks.filter(t => t.auto_trigger === 'transfer_termination');
  const initiationTasks = tasks.filter(t => t.auto_trigger === 'transfer_initiation');

  // Progress calculations - REQUIRED tasks only for completion status
  const requiredTasks = tasks.filter(t => t.is_required !== false);
  const completedRequiredTasks = requiredTasks.filter(t => t.status === 'completed');
  const blockedTasks = tasks.filter(t => t.status === 'blocked' || t.status === 'waiting_on_signature');
  const escalatedTasks = tasks.filter(t => t.escalated);
  const allRequiredComplete = requiredTasks.length > 0 && 
    requiredTasks.every(t => t.status === 'completed');

  // Overall progress including optional
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  // Phase-specific progress (required only)
  const terminationRequired = terminationTasks.filter(t => t.is_required !== false);
  const terminationComplete = terminationRequired.every(t => t.status === 'completed');
  const initiationRequired = initiationTasks.filter(t => t.is_required !== false);
  const initiationComplete = initiationRequired.every(t => t.status === 'completed');

  // Check for and handle transfer completion
  useEffect(() => {
    const checkCompletion = async () => {
      if (allRequiredComplete && transfer.status !== 'completed') {
        const { data: { user } } = await supabase.auth.getUser();
        
        await supabase
          .from('agreement_transfers')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            completed_by: user?.id,
          })
          .eq('id', transfer.id);

        // Log completion
        await supabase.from('transfer_activity_log').insert({
          transfer_id: transfer.id,
          activity_type: 'status_changed',
          actor_id: user?.id,
          actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
          actor_role: 'admin',
          description: 'Transfer workflow completed - all required tasks finished',
        });

        toast({
          title: 'Transfer complete',
          description: 'All required workflow tasks have been completed.',
        });
        onUpdate?.();
      } else if (!allRequiredComplete && transfer.status === 'completed') {
        // Reopen if a required task was reopened
        const { data: { user } } = await supabase.auth.getUser();
        
        await supabase
          .from('agreement_transfers')
          .update({
            status: 'in_progress',
            completed_at: null,
            completed_by: null,
          })
          .eq('id', transfer.id);

        // Log reopening
        await supabase.from('transfer_activity_log').insert({
          transfer_id: transfer.id,
          activity_type: 'status_changed',
          actor_id: user?.id,
          actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
          actor_role: 'admin',
          description: 'Transfer workflow reopened - required task was unchecked',
        });

        toast({
          title: 'Transfer reopened',
          description: 'A required task was marked incomplete.',
          variant: 'destructive',
        });
        onUpdate?.();
      }
    };

    if (!loading && tasks.length > 0) {
      checkCompletion();
    }
  }, [tasks, transfer.status, loading]);

  const handleTaskDeleted = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
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

  const TaskPhaseSection = ({ 
    taskList, 
    title, 
    phase,
    isComplete 
  }: { 
    taskList: Task[]; 
    title: string; 
    phase: 'termination' | 'initiation';
    isComplete: boolean;
  }) => {
    const requiredCount = taskList.filter(t => t.is_required !== false).length;
    const completedRequired = taskList.filter(t => t.is_required !== false && t.status === 'completed').length;
    const nextSortOrder = taskList.length > 0 
      ? Math.max(...taskList.map(t => t.sort_order || 0)) + 1 
      : 0;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">{title}</h4>
            <Badge variant="outline" className="text-xs">
              {completedRequired}/{requiredCount} required
            </Badge>
            {isComplete && (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
          </div>
        </div>
        
        <div className="space-y-1">
          {taskList.map(task => (
            <EditableTaskItem
              key={task.id}
              task={task}
              transferId={transfer.id}
              isAdmin={isAdmin}
              onUpdate={fetchTasks}
              onDelete={handleTaskDeleted}
            />
          ))}
          
          {/* Add task button (admin only) */}
          {isAdmin && (
            <AddTaskButton
              transferId={transfer.id}
              agreementId={transfer.source_agreement_id}
              phase={phase}
              stateAbbreviation={transfer.state_abbreviation}
              stateName={transfer.state_name}
              nextSortOrder={nextSortOrder}
              onAdded={fetchTasks}
            />
          )}
        </div>
      </div>
    );
  };

  // Compute workflow readiness
  const readiness = useMemo(
    () => computeTransferReadiness(transfer, tasks),
    [transfer, tasks]
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
                <WorkflowReadinessBanner readiness={readiness} compact />
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1 flex-wrap">
                <span>{transfer.source_physician_name || 'Unassigned'}</span>
                <ArrowRightLeft className="h-3 w-3" />
                <span>{transfer.target_physician_name}</span>
                <span className="text-muted-foreground">•</span>
                <Users className="h-3 w-3" />
                <span>{transfer.affected_provider_count} provider(s)</span>
                {blockedTasks.length > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <Badge className="bg-warning/10 text-warning border-warning/20 text-[10px] gap-1">
                      <Lock className="h-3 w-3" />
                      {blockedTasks.length} blocked
                    </Badge>
                  </>
                )}
                {escalatedTasks.length > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <Badge variant="destructive" className="text-[10px] gap-1">
                      <Flag className="h-3 w-3" />
                      {escalatedTasks.length} escalated
                    </Badge>
                  </>
                )}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">
                {completedRequiredTasks.length}/{requiredTasks.length} required
              </p>
              <Progress value={progress} className="w-24 h-2" />
            </div>
            {transfer.effective_date && (
              <div className="text-right text-xs text-muted-foreground hidden sm:block">
                <Calendar className="h-3 w-3 inline mr-1" />
                {format(new Date(transfer.effective_date), 'MMM d')}
              </div>
            )}
            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <Separator className="mb-4" />
          
          {/* Workflow readiness banner with "What's Missing" */}
          {!readiness.isComplete && (
            <WorkflowReadinessBanner 
              readiness={readiness} 
              entityLabel={`${transfer.state_name} Transfer`}
              className="mb-4"
            />
          )}

          {/* Completion blocking alert */}
          {!allRequiredComplete && transfer.status !== 'completed' && readiness.canExecute && (
            <Alert className="mb-4">
              <Lock className="h-4 w-4" />
              <AlertDescription>
                <span className="font-medium">
                  {requiredTasks.length - completedRequiredTasks.length} required task(s) remaining
                </span>
                {' '}before this transfer can be marked complete.
              </AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-8 bg-muted rounded" />
              <div className="h-8 bg-muted rounded" />
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="checklist" className="gap-2">
                  <ListChecks className="h-4 w-4" />
                  Checklist
                </TabsTrigger>
                <TabsTrigger value="activity" className="gap-2">
                  <Activity className="h-4 w-4" />
                  Activity
                </TabsTrigger>
              </TabsList>

              <TabsContent value="checklist" className="space-y-6">
                {/* Effective Date Warnings */}
                <EffectiveDateWarnings
                  terminationEffectiveDate={transfer.termination_effective_date}
                  initiationEffectiveDate={transfer.initiation_effective_date}
                  terminationComplete={terminationComplete}
                  initiationComplete={initiationComplete}
                  className="space-y-2"
                />

                {/* Effective Dates Editor */}
                <TransferEffectiveDatesEditor
                  transferId={transfer.id}
                  terminationEffectiveDate={transfer.termination_effective_date}
                  initiationEffectiveDate={transfer.initiation_effective_date}
                  effectiveDate={transfer.effective_date}
                  isAdmin={isAdmin}
                  onUpdate={() => { fetchTasks(); onUpdate?.(); }}
                />

                {/* Provider-level tracking */}
                <TransferProviderSubtable
                  transferId={transfer.id}
                  affectedProviderIds={transfer.affected_provider_ids || []}
                  tasks={tasks}
                  isAdmin={isAdmin}
                  onUpdate={() => { fetchTasks(); onUpdate?.(); }}
                />

                <div className="grid gap-6 md:grid-cols-2">
                  <TaskPhaseSection 
                    taskList={terminationTasks} 
                    title="1. Termination Phase" 
                    phase="termination"
                    isComplete={terminationComplete}
                  />
                  <TaskPhaseSection 
                    taskList={initiationTasks} 
                    title="2. Initiation Phase" 
                    phase="initiation"
                    isComplete={initiationComplete}
                  />
                </div>

                {/* Lifecycle Info for completed transfers - editable by admin */}
                <TransferLifecycleEditor
                  transferId={transfer.id}
                  status={transfer.status}
                  completedAt={transfer.completed_at}
                  effectiveDate={transfer.effective_date}
                  renewalDate={transfer.new_agreement_renewal_date}
                  firstMeetingDate={transfer.first_meeting_scheduled_date}
                  meetingCadence={transfer.meeting_cadence}
                  chartReviewFrequency={transfer.chart_review_frequency}
                  targetPhysicianName={transfer.target_physician_name}
                  affectedProviderCount={transfer.affected_provider_count}
                  isAdmin={isAdmin}
                  onUpdate={() => onUpdate?.()}
                />
              </TabsContent>

              <TabsContent value="activity">
                <ScrollArea className="h-[300px]">
                  <TransferActivityLog transferId={transfer.id} />
                </ScrollArea>
              </TabsContent>
            </Tabs>
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