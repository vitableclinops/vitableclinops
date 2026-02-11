import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { RelatedLinksCard } from '@/components/navigation/RelatedLinksCard';
import { WorkflowStatusTracker } from '@/components/agreements/WorkflowStatusTracker';
import { TerminationDialog } from '@/components/agreements/TerminationDialog';
import { EditTaskDialog } from '@/components/admin/EditTaskDialog';
import { TaskAssignmentSelect } from '@/components/agreements/TaskAssignmentSelect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { useAgreementTasks, AgreementTask } from '@/hooks/useAgreementTasks';
import { useAgreementWorkflow } from '@/hooks/useAgreementWorkflow';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';
import {
  MapPin,
  Users,
  FileText,
  Calendar,
  ChevronRight,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Edit,
  ArrowLeft,
  Plus,
  User,
  Stethoscope,
  ClipboardList,
  ShieldCheck,
  ArrowRight,
  Lock,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Tables } from '@/integrations/supabase/types';

type DbAgreement = Tables<'collaborative_agreements'>;
type DbProvider = Tables<'agreement_providers'>;
type DbMeeting = Tables<'supervision_meetings'>;

export default function AgreementDetailPage() {
  const { agreementId } = useParams<{ agreementId: string }>();
  const { profile, roles, hasRole } = useAuth();
  const { toast } = useToast();
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useAgreementTasks({ agreementId });
  const { advanceStatus, checkTasksComplete } = useAgreementWorkflow();

  const [agreement, setAgreement] = useState<DbAgreement | null>(null);
  const [providers, setProviders] = useState<DbProvider[]>([]);
  const [meetings, setMeetings] = useState<DbMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminationOpen, setTerminationOpen] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [editingTask, setEditingTask] = useState<DashboardTaskItem | null>(null);

  const taskToDashboardItem = (task: AgreementTask): DashboardTaskItem => ({
    id: task.id,
    title: task.title,
    status: task.status,
    category: task.category,
    state_name: task.state_name,
    state_abbreviation: task.state_abbreviation,
    assigned_to_name: task.assigned_to_name,
    assigned_to: task.assigned_to,
    priority: task.priority,
    due_date: task.due_date,
    provider_id: task.provider_id,
    transfer_id: task.transfer_id,
    escalated: task.escalated,
    blocked_reason: task.blocked_reason,
    description: task.description,
  });

  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  const fetchData = useCallback(async () => {
    if (!agreementId) return;
    setLoading(true);

    const [agreementRes, providersRes, meetingsRes] = await Promise.all([
      supabase
        .from('collaborative_agreements')
        .select('*')
        .eq('id', agreementId)
        .maybeSingle(),
      supabase
        .from('agreement_providers')
        .select('*')
        .eq('agreement_id', agreementId),
      supabase
        .from('supervision_meetings')
        .select('*')
        .eq('agreement_id', agreementId)
        .order('scheduled_date', { ascending: true }),
    ]);

    if (agreementRes.data) setAgreement(agreementRes.data);
    if (providersRes.data) setProviders(providersRes.data);
    if (meetingsRes.data) setMeetings(meetingsRes.data);

    setLoading(false);
  }, [agreementId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Task stats
  const requiredTasks = tasks.filter(t => t.is_required);
  const completedRequiredTasks = requiredTasks.filter(t => t.status === 'completed');
  const pendingRequiredTasks = requiredTasks.filter(t => t.status !== 'completed');
  const allRequiredComplete = requiredTasks.length > 0 && pendingRequiredTasks.length === 0;

  // Determine next valid status transition
  const getNextStatus = (): { status: string; label: string } | null => {
    if (!agreement) return null;
    switch (agreement.workflow_status) {
      case 'draft':
        return { status: 'in_progress', label: 'Start Setup' };
      case 'in_progress':
      case 'pending_setup':
        return allRequiredComplete ? { status: 'pending_signatures', label: 'Advance to Signatures' } : null;
      case 'pending_signatures':
      case 'awaiting_physician_signature':
      case 'awaiting_provider_signatures':
      case 'fully_executed':
        return allRequiredComplete ? { status: 'pending_verification', label: 'Submit for Verification' } : null;
      case 'pending_verification':
        return { status: 'active', label: 'Verify & Activate' };
      case 'termination_initiated':
        return allRequiredComplete ? { status: 'terminated', label: 'Finalize Termination' } : null;
      default:
        return null;
    }
  };

  const handleAdvanceStatus = async () => {
    if (!agreement || !agreementId) return;
    const next = getNextStatus();
    if (!next) return;

    setAdvancing(true);
    try {
      const success = await advanceStatus(
        agreementId,
        next.status as any,
        profile?.id
      );
      if (success) {
        toast({
          title: 'Status updated',
          description: `Agreement is now: ${next.status.replace(/_/g, ' ')}`,
        });
        await fetchData();
        refetchTasks();
      }
    } catch (error) {
      console.error('Error advancing status:', error);
    } finally {
      setAdvancing(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    if (!profile?.id) return;
    try {
      const { error } = await supabase
        .from('agreement_tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: profile.id,
        })
        .eq('id', taskId);

      if (error) throw error;
      
      toast({ title: 'Task completed' });
      refetchTasks();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to complete task', variant: 'destructive' });
    }
  };

  const handleReopenTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('agreement_tasks')
        .update({
          status: 'pending',
          completed_at: null,
          completed_by: null,
        })
        .eq('id', taskId);

      if (error) throw error;
      
      toast({ title: 'Task reopened' });
      refetchTasks();
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to reopen task', variant: 'destructive' });
    }
  };

  const activeProviders = providers.filter(p => p.is_active);
  const terminatedProviders = providers.filter(p => !p.is_active);
  const upcomingMeetings = meetings.filter(m => m.status === 'scheduled' && new Date(m.scheduled_date) >= new Date());
  const pastMeetings = meetings.filter(m => m.status === 'completed' || new Date(m.scheduled_date) < new Date());

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-success/10 text-success border-success/20">Active</Badge>;
      case 'draft':
        return <Badge variant="secondary">Draft</Badge>;
      case 'in_progress':
        return <Badge variant="default">In Progress</Badge>;
      case 'pending_setup':
        return <Badge variant="default">Pending Setup</Badge>;
      case 'pending_signatures':
        return <Badge variant="default">Pending Signatures</Badge>;
      case 'pending_verification':
        return <Badge variant="default">Pending Verification</Badge>;
      case 'termination_initiated':
        return <Badge variant="destructive">Pending Termination</Badge>;
      case 'terminated':
        return <Badge variant="destructive">Terminated</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      case 'archived':
        return <Badge variant="secondary">Archived</Badge>;
      case 'invalid':
        return <Badge variant="destructive">Invalid</Badge>;
      default:
        return <Badge variant="outline">{status?.replace(/_/g, ' ')}</Badge>;
    }
  };

  const getTaskStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-primary" />;
      case 'blocked':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (!agreementId) {
    return <div>Agreement not found</div>;
  }

  // Build a descriptive breadcrumb: Provider ↔ Physician in State
  const breadcrumbLabel = agreement?.provider_name
    ? `${agreement.provider_name} ↔ Dr. ${agreement.physician_name} (${agreement.state_abbreviation})`
    : agreement?.state_name || 'Agreement';

  const breadcrumbs = [
    { label: 'Agreements', href: '/admin/agreements' },
    { label: breadcrumbLabel },
  ];

  const nextStatus = getNextStatus();

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="ml-16 lg:ml-64 transition-all duration-300">
        <div className="p-4 md:p-6 lg:p-8">
          <Breadcrumbs items={breadcrumbs} className="mb-4" />

          <Link to="/admin/agreements" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to Agreements
          </Link>

          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-8 w-64 bg-muted rounded" />
              <div className="h-32 bg-muted rounded" />
            </div>
          ) : agreement ? (
            <>
              {/* Header — clearly shows Provider ↔ Physician ↔ State */}
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">
                    {agreement.state_abbreviation}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-2xl font-bold text-foreground">
                        {agreement.state_name} Collaborative Agreement
                      </h1>
                      {getStatusBadge(agreement.workflow_status)}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <User className="h-4 w-4" />
                        <span className="font-medium text-foreground">{agreement.provider_name || 'Unassigned'}</span>
                      </div>
                      <span className="text-muted-foreground/50">↔</span>
                      <div className="flex items-center gap-1.5">
                        <Stethoscope className="h-4 w-4" />
                        <span className="font-medium text-foreground">Dr. {agreement.physician_name}</span>
                      </div>
                      <span className="text-muted-foreground/50">•</span>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" />
                        <span>{agreement.state_name}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {hasRole('admin') && nextStatus && (
                    <Button 
                      onClick={handleAdvanceStatus}
                      disabled={advancing}
                      className={agreement.workflow_status === 'termination_initiated' ? 'bg-destructive hover:bg-destructive/90' : ''}
                    >
                      {advancing ? (
                        <Clock className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4 mr-2" />
                      )}
                      {nextStatus.label}
                    </Button>
                  )}
                  {hasRole('admin') && agreement.workflow_status === 'active' && (
                    <Button 
                      variant="outline" 
                      className="text-destructive hover:text-destructive"
                      onClick={() => setTerminationOpen(true)}
                    >
                      Terminate Agreement
                    </Button>
                  )}
                  {hasRole('admin') && ['draft', 'in_progress', 'pending_setup'].includes(agreement.workflow_status) && (
                    <Button 
                      variant="outline" 
                      className="text-destructive hover:text-destructive"
                      onClick={async () => {
                        const success = await advanceStatus(agreement.id, 'cancelled' as any, profile?.id);
                        if (success) {
                          toast({ title: 'Agreement cancelled' });
                          fetchData();
                        }
                      }}
                    >
                      Cancel Agreement
                    </Button>
                  )}
                </div>
              </div>

              {/* Blocker Banner */}
              {(['in_progress', 'pending_setup', 'pending_signatures', 'termination_initiated'].includes(agreement.workflow_status)) && pendingRequiredTasks.length > 0 && (
                <div className="mb-6 p-4 rounded-lg border border-warning/30 bg-warning/5">
                  <div className="flex items-center gap-2">
                    <Lock className="h-5 w-5 text-warning" />
                    <span className="font-medium">Status advancement blocked</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {pendingRequiredTasks.length} required task{pendingRequiredTasks.length !== 1 ? 's' : ''} must be completed before this agreement can advance.
                  </p>
                </div>
              )}

              {/* Provider Message */}
              {agreement.provider_message && (
                <div className="mb-6 p-4 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Provider Message</span>
                  </div>
                  <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans bg-background p-3 rounded border">
                    {agreement.provider_message}
                  </pre>
                </div>
              )}

              {/* Workflow Status Tracker */}
              <WorkflowStatusTracker
                status={agreement.workflow_status}
                physicianName={agreement.physician_name || undefined}
                providerCount={activeProviders.length}
                className="mb-6"
                pendingTaskCount={pendingRequiredTasks.length}
                completedTaskCount={completedRequiredTasks.length}
                totalTaskCount={requiredTasks.length}
              />

              <div className="grid gap-6 lg:grid-cols-3 mt-6">
                {/* Main content */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Agreement Details */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Agreement Details</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">State</p>
                          <Link 
                            to={`/states/${agreement.state_abbreviation}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {agreement.state_name}
                          </Link>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Physician</p>
                          <Link 
                            to={`/physicians/${encodeURIComponent(agreement.physician_email)}`}
                            className="font-medium text-primary hover:underline"
                          >
                            Dr. {agreement.physician_name}
                          </Link>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Meeting Cadence</p>
                          <p className="font-medium capitalize">{agreement.meeting_cadence || 'Not set'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Start Date</p>
                          <p className="font-medium">
                            {agreement.start_date ? format(new Date(agreement.start_date), 'MMM d, yyyy') : 'Not set'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Renewal Date</p>
                          <p className="font-medium">
                            {agreement.next_renewal_date ? format(new Date(agreement.next_renewal_date), 'MMM d, yyyy') : 'Not set'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Chart Review</p>
                          <p className="font-medium">
                            {agreement.chart_review_required ? (agreement.chart_review_frequency || 'Required') : 'Not required'}
                          </p>
                        </div>
                      </div>

                      {agreement.agreement_document_url && (
                        <>
                          <Separator className="my-4" />
                          <Button variant="outline" asChild>
                            <a href={agreement.agreement_document_url} target="_blank" rel="noopener noreferrer">
                              <FileText className="h-4 w-4 mr-2" />
                              View Agreement Document
                              <ExternalLink className="h-3 w-3 ml-2" />
                            </a>
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Tabs defaultValue="tasks">
                    <TabsList>
                      <TabsTrigger value="tasks">
                        Tasks ({tasks.length})
                        {pendingRequiredTasks.length > 0 && (
                          <Badge variant="destructive" className="ml-2 text-xs h-5 px-1.5">
                            {pendingRequiredTasks.length}
                          </Badge>
                        )}
                      </TabsTrigger>
                      <TabsTrigger value="providers">Providers ({activeProviders.length})</TabsTrigger>
                      <TabsTrigger value="meetings">Meetings ({meetings.length})</TabsTrigger>
                      <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>

                    <TabsContent value="tasks" className="mt-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Required Tasks</CardTitle>
                          <CardDescription>
                            {allRequiredComplete 
                              ? 'All required tasks are complete. You may advance the agreement status.'
                              : `${pendingRequiredTasks.length} of ${requiredTasks.length} required task(s) remaining`
                            }
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {tasks.length > 0 ? (
                            <div className="space-y-3">
                              {tasks.map((task: AgreementTask) => (
                                <Collapsible key={task.id}>
                                  <div
                                    className={cn(
                                      "rounded-lg border transition-colors",
                                      task.status === 'completed' && "bg-success/5 border-success/20",
                                      task.status === 'blocked' && "bg-destructive/5 border-destructive/20"
                                    )}
                                  >
                                    <CollapsibleTrigger asChild>
                                      <div className="flex items-start gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                                        {getTaskStatusIcon(task.status)}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <p className="font-medium text-foreground">{task.title}</p>
                                            {task.is_required && (
                                              <Badge variant="outline" className="text-xs">Required</Badge>
                                            )}
                                          </div>
                                          {task.description && (
                                            <p className="text-sm text-muted-foreground mt-0.5">{task.description}</p>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <Badge variant="outline" className="capitalize text-xs">{task.category.replace(/_/g, ' ')}</Badge>
                                          {hasRole('admin') && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(e) => { e.stopPropagation(); setEditingTask(taskToDashboardItem(task)); }}
                                            >
                                              <Pencil className="h-3 w-3" />
                                            </Button>
                                          )}
                                          {hasRole('admin') && task.status !== 'completed' && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={(e) => { e.stopPropagation(); handleCompleteTask(task.id); }}
                                            >
                                              <CheckCircle2 className="h-3 w-3 mr-1" />
                                              Complete
                                            </Button>
                                          )}
                                          {hasRole('admin') && task.status === 'completed' && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="text-muted-foreground"
                                              onClick={(e) => { e.stopPropagation(); handleReopenTask(task.id); }}
                                            >
                                              Reopen
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    </CollapsibleTrigger>

                                    <CollapsibleContent>
                                      <div className="px-4 pb-4 pt-0 border-t border-border/50 mt-0">
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-3 text-sm">
                                          {task.due_date && (
                                            <div>
                                              <p className="text-xs text-muted-foreground">Due Date</p>
                                              <p className="font-medium">{format(new Date(task.due_date), 'MMM d, yyyy')}</p>
                                            </div>
                                          )}
                                          <div onClick={(e) => e.stopPropagation()}>
                                            <p className="text-xs text-muted-foreground mb-1">Assigned To</p>
                                            {hasRole('admin') ? (
                                              <TaskAssignmentSelect
                                                taskId={task.id}
                                                transferId={task.transfer_id || ''}
                                                currentAssigneeId={task.assigned_to}
                                                currentAssigneeName={task.assigned_to_name}
                                                onAssigned={refetchTasks}
                                              />
                                            ) : (
                                              <p className="font-medium">{task.assigned_to_name || 'Unassigned'}</p>
                                            )}
                                          </div>
                                          {task.priority && (
                                            <div>
                                              <p className="text-xs text-muted-foreground">Priority</p>
                                              <p className="font-medium capitalize">{task.priority}</p>
                                            </div>
                                          )}
                                          {task.assigned_role && (
                                            <div>
                                              <p className="text-xs text-muted-foreground">Assigned Role</p>
                                              <p className="font-medium capitalize">{task.assigned_role}</p>
                                            </div>
                                          )}
                                          {task.status === 'blocked' && task.blocked_reason && (
                                            <div className="col-span-2">
                                              <p className="text-xs text-destructive">Blocked Reason</p>
                                              <p className="font-medium text-destructive">{task.blocked_reason}</p>
                                            </div>
                                          )}
                                        </div>

                                        {task.task_purpose && (
                                          <p className="text-xs text-muted-foreground mt-3 italic">
                                            Purpose: {task.task_purpose}
                                          </p>
                                        )}
                                        {task.notes && (
                                          <div className="mt-3">
                                            <p className="text-xs text-muted-foreground">Notes</p>
                                            <p className="text-sm mt-0.5">{task.notes}</p>
                                          </div>
                                        )}
                                        {task.compliance_risk && task.status !== 'completed' && (
                                          <p className="text-xs text-destructive mt-2">
                                            ⚠ Compliance Risk: {task.compliance_risk}
                                          </p>
                                        )}
                                        {task.external_url && (
                                          <a
                                            href={task.external_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                            Open external link
                                          </a>
                                        )}
                                        {task.completed_at && (
                                          <p className="text-xs text-success mt-2">
                                            ✓ Completed {format(new Date(task.completed_at), 'MMM d, yyyy h:mm a')}
                                          </p>
                                        )}
                                      </div>
                                    </CollapsibleContent>
                                  </div>
                                </Collapsible>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-8">
                              <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                              <p className="text-muted-foreground">No tasks found</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="providers" className="mt-4">
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle>Active Providers</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {activeProviders.length > 0 ? (
                            <div className="space-y-3">
                              {activeProviders.map(provider => (
                                <Link
                                  key={provider.id}
                                  to={`/directory?search=${encodeURIComponent(provider.provider_email)}`}
                                  className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
                                >
                                  <Avatar className="h-10 w-10">
                                    <AvatarFallback className="bg-primary/10 text-primary">
                                      {provider.provider_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1">
                                    <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                                      {provider.provider_name}
                                    </p>
                                    <p className="text-sm text-muted-foreground">{provider.provider_email}</p>
                                  </div>
                                  {provider.start_date && (
                                    <span className="text-xs text-muted-foreground">
                                      Since {format(new Date(provider.start_date), 'MMM yyyy')}
                                    </span>
                                  )}
                                  <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-center py-8">No active providers</p>
                          )}

                          {terminatedProviders.length > 0 && (
                            <>
                              <Separator className="my-4" />
                              <p className="text-sm text-muted-foreground mb-2">Terminated Providers</p>
                              <div className="space-y-2">
                                {terminatedProviders.map(provider => (
                                  <div key={provider.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <span className="text-sm text-muted-foreground">{provider.provider_name}</span>
                                    <Badge variant="destructive" className="text-xs">Removed</Badge>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="meetings" className="mt-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Supervision Meetings</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {upcomingMeetings.length > 0 && (
                            <div className="mb-6">
                              <p className="text-sm font-medium mb-2">Upcoming</p>
                              <div className="space-y-2">
                                {upcomingMeetings.map(meeting => (
                                  <div key={meeting.id} className="flex items-center gap-3 p-3 rounded-lg border bg-primary/5">
                                    <Calendar className="h-4 w-4 text-primary" />
                                    <span className="font-medium">
                                      {format(new Date(meeting.scheduled_date), 'EEEE, MMMM d, yyyy')}
                                    </span>
                                    <Badge variant="outline">{(meeting as any).time_slot?.toUpperCase()}</Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {pastMeetings.length > 0 && (
                            <div>
                              <p className="text-sm font-medium mb-2 text-muted-foreground">Past Meetings</p>
                              <div className="space-y-2">
                                {pastMeetings.slice(0, 5).map(meeting => (
                                  <div key={meeting.id} className="flex items-center gap-3 p-3 rounded-lg border">
                                    <CheckCircle2 className="h-4 w-4 text-success" />
                                    <span className="text-muted-foreground">
                                      {format(new Date(meeting.scheduled_date), 'MMM d, yyyy')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {meetings.length === 0 && (
                            <p className="text-muted-foreground text-center py-8">No meetings scheduled</p>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="history" className="mt-4">
                      <AuditHistory agreementId={agreementId!} />
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  {/* Task Summary Card */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Compliance Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Required Tasks</span>
                        <span className="text-sm font-medium">{completedRequiredTasks.length}/{requiredTasks.length}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all",
                            allRequiredComplete ? "bg-success" : "bg-primary"
                          )}
                          style={{ width: requiredTasks.length > 0 ? `${(completedRequiredTasks.length / requiredTasks.length) * 100}%` : '0%' }} 
                        />
                      </div>
                      {allRequiredComplete ? (
                        <div className="flex items-center gap-2 text-success text-sm">
                          <ShieldCheck className="h-4 w-4" />
                          All requirements met
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-warning text-sm">
                          <AlertTriangle className="h-4 w-4" />
                          {pendingRequiredTasks.length} task{pendingRequiredTasks.length !== 1 ? 's' : ''} blocking
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <RelatedLinksCard
                    title="Related"
                    links={[
                      {
                        label: agreement.state_name,
                        href: `/states/${agreement.state_abbreviation}`,
                        icon: MapPin,
                        description: 'View state compliance details',
                      },
                      {
                        label: `Dr. ${agreement.physician_name}`,
                        href: `/physicians/${encodeURIComponent(agreement.physician_email)}`,
                        icon: Stethoscope,
                        description: 'Physician profile',
                      },
                      ...activeProviders.slice(0, 3).map(p => ({
                        label: p.provider_name,
                        href: `/directory?search=${encodeURIComponent(p.provider_email)}`,
                        icon: User,
                      })),
                    ]}
                  />
                </div>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Agreement not found</p>
                <Button asChild className="mt-4">
                  <Link to="/admin/agreements">Back to Agreements</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {agreement && (
        <TerminationDialog
          open={terminationOpen}
          onOpenChange={setTerminationOpen}
          agreement={agreement}
          providers={providers.filter(p => p.is_active)}
          onSuccess={() => {
            setTerminationOpen(false);
            fetchData();
            refetchTasks();
          }}
        />
      )}

      <EditTaskDialog
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSuccess={() => {
          setEditingTask(null);
          refetchTasks();
        }}
      />
    </div>
  );
}

// Audit History sub-component
function AuditHistory({ agreementId }: { agreementId: string }) {
  const [logs, setLogs] = useState<Tables<'agreement_audit_log'>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      const { data } = await supabase
        .from('agreement_audit_log')
        .select('*')
        .eq('entity_id', agreementId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      setLogs(data || []);
      setLoading(false);
    };
    fetchLogs();
  }, [agreementId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit History</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded" />)}
          </div>
        ) : logs.length > 0 ? (
          <div className="space-y-3">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium capitalize">{log.action.replace(/_/g, ' ')}</p>
                  {log.performed_by_name && (
                    <p className="text-xs text-muted-foreground">by {log.performed_by_name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-8">
            No audit history yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}