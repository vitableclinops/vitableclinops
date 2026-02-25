// ============= Full file contents =============

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
import { BulkArchiveDialog } from '@/components/admin/BulkArchiveDialog';
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
  Calendar,
  FilePlus,
  Loader2,
  Archive,
  X
} from 'lucide-react';
import { format } from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
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
  const [creatingAgreement, setCreatingAgreement] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [providerNames, setProviderNames] = useState<string[]>([]);

  const isAdmin = hasRole('admin');

  // Fetch provider names from affected_provider_ids
  useEffect(() => {
    const fetchProviderNames = async () => {
      if (!transfer.affected_provider_ids || transfer.affected_provider_ids.length === 0) return;
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', transfer.affected_provider_ids);
      if (data) {
        setProviderNames(data.map(p => p.full_name || 'Unknown').filter(Boolean));
      }
    };
    fetchProviderNames();
  }, [transfer.affected_provider_ids]);

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
      setSelectedTaskIds(prev => {
        const validTaskIds = new Set(
          data
            .filter((task) => task.status !== 'archived' && task.status !== 'completed')
            .map((task) => task.id)
        );
        return new Set(Array.from(prev).filter((id) => validTaskIds.has(id)));
      });
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

  // Auto-complete workflow logic
  const handleCompleteTransfer = async () => {
    if (!allRequiredComplete) return;
    setCreatingAgreement(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Mark transfer as completed
      const { error: transferError } = await supabase
        .from('agreement_transfers')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user?.id,
        })
        .eq('id', transfer.id);

      if (transferError) throw transferError;

      // 2. Check if target agreement was already auto-created by the trigger
      // Re-fetch transfer to get latest target_agreement_id
      const { data: latestTransfer } = await supabase
        .from('agreement_transfers')
        .select('target_agreement_id')
        .eq('id', transfer.id)
        .single();

      const targetAgreementId = latestTransfer?.target_agreement_id || transfer.target_agreement_id;

      if (targetAgreementId) {
        // Agreement already exists (created by trigger) — advance to active if effective date has passed
        const effectiveDate = transfer.effective_date;
        const today = new Date().toISOString().split('T')[0];
        const shouldActivate = !effectiveDate || effectiveDate <= today;

        if (shouldActivate) {
          await supabase
            .from('collaborative_agreements')
            .update({ workflow_status: 'active' })
            .eq('id', targetAgreementId)
            .in('workflow_status', ['draft', 'in_progress']);
        }

        // Deactivate providers in old agreement
        if (transfer.affected_provider_ids && transfer.affected_provider_ids.length > 0) {
          await supabase
            .from('agreement_providers')
            .update({
              is_active: false,
              removed_at: transfer.effective_date || new Date().toISOString().split('T')[0],
              removed_reason: 'Transferred to new physician',
            })
            .in('provider_id', transfer.affected_provider_ids)
            .eq('agreement_id', transfer.source_agreement_id);
        }

        // Terminate source agreement
        await supabase
          .from('collaborative_agreements')
          .update({
            workflow_status: 'terminated',
            terminated_at: new Date().toISOString(),
            terminated_by: user?.id,
            termination_reason: `Transferred to Dr. ${transfer.target_physician_name}`,
          })
          .eq('id', transfer.source_agreement_id);

        await supabase.from('transfer_activity_log').insert({
          transfer_id: transfer.id,
          activity_type: 'status_changed',
          actor_id: user?.id,
          actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
          actor_role: 'admin',
          description: `Transfer finalized. Agreement ${targetAgreementId} ${shouldActivate ? 'activated' : 'remains in draft (effective date ' + effectiveDate + ' is in the future)'}. Source agreement terminated. ${transfer.affected_provider_count} providers transferred.`,
        });

        toast({
          title: 'Transfer Complete',
          description: shouldActivate 
            ? 'Agreement activated and providers transferred successfully.'
            : `Agreement will auto-activate on ${effectiveDate}. Source agreement terminated.`,
        });
      } else if (transfer.effective_date && transfer.target_physician_id) {
        // Fallback: no trigger-created agreement — create one now (active)
        const { data: sourceAgreement } = await supabase
          .from('collaborative_agreements')
          .select('chart_review_frequency, meeting_cadence, renewal_cadence, state_id')
          .eq('id', transfer.source_agreement_id)
          .single();

        if (!sourceAgreement?.state_id) {
          throw new Error('Could not retrieve state_id from source agreement');
        }

        const { data: newAgreement, error: createError } = await supabase
          .from('collaborative_agreements')
          .insert({
            state_abbreviation: transfer.state_abbreviation,
            state_id: sourceAgreement.state_id,
            state_name: transfer.state_name,
            physician_id: transfer.target_physician_id,
            physician_name: transfer.target_physician_name,
            physician_email: transfer.target_physician_email,
            provider_name: `${transfer.affected_provider_count} Providers`,
            start_date: transfer.effective_date,
            workflow_status: 'active',
            meeting_cadence: transfer.meeting_cadence || sourceAgreement?.meeting_cadence || 'monthly',
            chart_review_frequency: transfer.chart_review_frequency || sourceAgreement?.chart_review_frequency,
            renewal_cadence: sourceAgreement?.renewal_cadence || 'annual',
            source: 'transfer',
          })
          .select()
          .single();

        if (createError) throw createError;

        await supabase
          .from('agreement_transfers')
          .update({ target_agreement_id: newAgreement.id })
          .eq('id', transfer.id);

        await supabase
          .from('agreement_tasks')
          .update({ agreement_id: newAgreement.id })
          .eq('transfer_id', transfer.id)
          .eq('auto_trigger', 'transfer_initiation');

        if (transfer.affected_provider_ids && transfer.affected_provider_ids.length > 0) {
          await supabase
            .from('agreement_providers')
            .update({
              is_active: false,
              removed_at: transfer.effective_date,
              removed_reason: 'Transferred to new physician',
            })
            .in('provider_id', transfer.affected_provider_ids)
            .eq('agreement_id', transfer.source_agreement_id);

          const { data: providers } = await supabase
            .from('profiles')
            .select('id, full_name, email, npi_number')
            .in('id', transfer.affected_provider_ids);

          if (providers) {
            const newLinks = providers.map(p => ({
              agreement_id: newAgreement.id,
              provider_id: p.id,
              provider_name: p.full_name || 'Unknown',
              provider_email: p.email,
              provider_npi: p.npi_number,
              is_active: true,
              start_date: transfer.effective_date,
            }));
            await supabase.from('agreement_providers').insert(newLinks);
          }
        }

        await supabase
          .from('collaborative_agreements')
          .update({
            workflow_status: 'terminated',
            terminated_at: new Date().toISOString(),
            terminated_by: user?.id,
            termination_reason: `Transferred to Dr. ${transfer.target_physician_name}`,
          })
          .eq('id', transfer.source_agreement_id);

        await supabase.from('transfer_activity_log').insert({
          transfer_id: transfer.id,
          activity_type: 'status_changed',
          actor_id: user?.id,
          actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
          actor_role: 'admin',
          description: `Transfer completed. Created new agreement (${newAgreement.id}) and moved ${transfer.affected_provider_count} providers.`,
        });

        toast({
          title: 'Transfer Complete',
          description: 'New agreement created and providers transferred successfully.',
        });
      } else {
        await supabase.from('transfer_activity_log').insert({
          transfer_id: transfer.id,
          activity_type: 'status_changed',
          actor_id: user?.id,
          actor_name: user?.user_metadata?.full_name || user?.email || 'Unknown',
          actor_role: 'admin',
          description: 'Transfer workflow completed manually.',
        });

        toast({ title: 'Transfer Complete', description: 'Workflow marked as completed.' });
      }

      onUpdate?.();
    } catch (error) {
      console.error('Error completing transfer:', error);
      toast({
        title: 'Error',
        description: 'Failed to complete transfer and create agreement.',
        variant: 'destructive',
      });
    } finally {
      setCreatingAgreement(false);
    }
  };

  const handleTaskDeleted = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  const handleTaskSelectionChange = (taskId: string, selected: boolean) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (selected) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
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
    isComplete,
    physicianId,
  }: { 
    taskList: Task[]; 
    title: string; 
    phase: 'termination' | 'initiation';
    isComplete: boolean;
    physicianId?: string | null;
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
              selected={selectedTaskIds.has(task.id)}
              onSelectedChange={handleTaskSelectionChange}
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
              physicianId={physicianId}
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
                <span>{providerNames.length > 0 ? providerNames.join(', ') : `${transfer.affected_provider_count} provider(s)`}</span>
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
                {format(parseLocalDate(transfer.effective_date), 'MMM d')}
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

          {/* Completion blocking alert or Action Button */}
          {transfer.status !== 'completed' && (
            <div className="mb-6">
              {!allRequiredComplete ? (
                <Alert>
                  <Lock className="h-4 w-4" />
                  <AlertDescription>
                    <span className="font-medium">
                      {requiredTasks.length - completedRequiredTasks.length} required task(s) remaining
                    </span>
                    {' '}before this transfer can be finalized.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="p-4 rounded-lg bg-success/5 border border-success/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-success" />
                    <div>
                      <h4 className="font-medium text-success">All Tasks Complete</h4>
                      <p className="text-sm text-muted-foreground">
                        Ready to finalize transfer and create new agreements.
                      </p>
                    </div>
                  </div>
                  <Button 
                    onClick={handleCompleteTransfer} 
                    disabled={creatingAgreement}
                    className="bg-success hover:bg-success/90 text-white"
                  >
                    {creatingAgreement ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Finalizing...
                      </>
                    ) : (
                      <>
                        <FilePlus className="h-4 w-4 mr-2" />
                        Finalize & Create Agreement
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
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
                  className="space-y-2 max-w-md"
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

                {isAdmin && selectedTaskIds.size > 0 && (
                  <div className="flex items-center gap-2 p-2 rounded-lg border bg-muted/50">
                    <span className="text-sm font-medium">{selectedTaskIds.size} selected</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setBulkArchiveOpen(true)}
                    >
                      <Archive className="h-3.5 w-3.5 mr-1" />
                      Archive
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedTaskIds(new Set())}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                <div className="space-y-6">
                  <TaskPhaseSection 
                    taskList={terminationTasks} 
                    title={`1. Termination Phase — ${transfer.source_physician_name || 'Outgoing Physician'}`}
                    phase="termination"
                    isComplete={terminationComplete}
                    physicianId={transfer.source_physician_id}
                  />
                  <Separator />
                  <TaskPhaseSection 
                    taskList={initiationTasks} 
                    title={`2. Initiation Phase — ${transfer.target_physician_name || 'Incoming Physician'}`}
                    phase="initiation"
                    isComplete={initiationComplete}
                    physicianId={transfer.target_physician_id}
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

          <BulkArchiveDialog
            taskIds={Array.from(selectedTaskIds)}
            open={bulkArchiveOpen}
            onClose={() => setBulkArchiveOpen(false)}
            onSuccess={() => {
              setBulkArchiveOpen(false);
              setSelectedTaskIds(new Set());
              fetchTasks();
            }}
          />

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
