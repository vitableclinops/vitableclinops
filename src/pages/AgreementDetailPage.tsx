import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { RelatedLinksCard } from '@/components/navigation/RelatedLinksCard';
import { WorkflowStatusTracker } from '@/components/agreements/WorkflowStatusTracker';
import { TerminationDialog } from '@/components/agreements/TerminationDialog';
import { BulkReassignDialog } from '@/components/agreements/BulkReassignDialog';
import { VerificationChecklistDialog } from '@/components/agreements/VerificationChecklistDialog';
import { generateAuditReport } from '@/components/agreements/AuditReportGenerator';
import { TaskDialog, type TaskDialogTask } from '@/components/tasks/TaskDialog';
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
  Download,
  Lock,
  Pencil,
  RefreshCw,
  ArrowLeftRight,
  Paperclip,
} from 'lucide-react';
import { cn, parseLocalDate } from '@/lib/utils';
import { format } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarWidget } from '@/components/ui/calendar';
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
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [physicians, setPhysicians] = useState<{ id: string; name: string; email: string }[]>([]);
  const [advancing, setAdvancing] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskDialogTask | null>(null);

  const taskToDashboardItem = (task: AgreementTask): TaskDialogTask => ({
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
    agreement_id: task.agreement_id,
    escalated: task.escalated,
    blocked_reason: task.blocked_reason,
    description: task.description,
  });

  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  const fetchData = useCallback(async () => {
    if (!agreementId) return;
    setLoading(true);

    const [agreementRes, providersRes, meetingsRes, physiciansRes] = await Promise.all([
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
      supabase
        .from('physician_profiles')
        .select('id, full_name, email')
        .order('full_name'),
    ]);

    if (agreementRes.data) setAgreement(agreementRes.data);
    if (providersRes.data) setProviders(providersRes.data);
    if (meetingsRes.data) setMeetings(meetingsRes.data);
    if (physiciansRes.data) {
      setPhysicians(physiciansRes.data.map(p => ({ id: p.id, name: p.full_name || '', email: p.email || '' })));
    }

    setLoading(false);
  }, [agreementId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Task stats — exclude archived tasks from all operational counts
  const activeTasks = tasks.filter(t => t.status !== 'archived');
  const requiredTasks = activeTasks.filter(t => t.is_required);
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
              <div className="mb-6 space-y-4">
                {/* Title row */}
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">
                    {agreement.state_abbreviation}
                  </div>
                  <div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <h1 className="text-2xl font-bold text-foreground">
                        {agreement.state_name} Collaborative Agreement
                      </h1>
                      {getStatusBadge(agreement.workflow_status)}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <User className="h-4 w-4" />
                        <span className="font-medium text-foreground">{activeProviders.length > 0 ? activeProviders.map(p => p.provider_name).join(', ') : agreement.provider_name || 'Unassigned'}</span>
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

                {/* Action buttons — wrap naturally */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateAuditReport(agreementId!)}
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Audit Report
                  </Button>
                  {hasRole('admin') && nextStatus && (
                    nextStatus.status === 'active' ? (
                      <Button 
                        size="sm"
                        onClick={() => setVerificationOpen(true)}
                        disabled={advancing}
                      >
                        <ShieldCheck className="h-4 w-4 mr-1.5" />
                        {nextStatus.label}
                      </Button>
                    ) : (
                      <Button 
                        size="sm"
                        onClick={handleAdvanceStatus}
                        disabled={advancing}
                        className={agreement.workflow_status === 'termination_initiated' ? 'bg-destructive hover:bg-destructive/90' : ''}
                      >
                        {advancing ? (
                          <Clock className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <ArrowRight className="h-4 w-4 mr-1.5" />
                        )}
                        {nextStatus.label}
                      </Button>
                    )
                  )}
                  {hasRole('admin') && agreement.workflow_status === 'active' && (
                    <Button 
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const renewalDate = agreement.next_renewal_date 
                          ? parseLocalDate(agreement.next_renewal_date) 
                          : new Date();
                        const yearsToAdd = agreement.renewal_cadence === 'biennial' ? 2 : 1;
                        const nextDate = new Date(renewalDate);
                        nextDate.setFullYear(nextDate.getFullYear() + yearsToAdd);
                        
                        const { error } = await supabase
                          .from('collaborative_agreements')
                          .update({ 
                            workflow_status: 'pending_renewal' as any,
                            next_renewal_date: nextDate.toISOString().split('T')[0],
                          })
                          .eq('id', agreement.id);
                        
                        if (!error) {
                          await supabase.from('agreement_audit_log').insert({
                            entity_type: 'agreement',
                            entity_id: agreement.id,
                            action: 'renewal_initiated',
                            performed_by: profile?.id || null,
                            changes: { next_renewal_date: nextDate.toISOString().split('T')[0] },
                          });
                          toast({ title: 'Renewal initiated', description: 'Agreement marked for renewal.' });
                          fetchData();
                        } else {
                          toast({ title: 'Error', description: 'Failed to initiate renewal.', variant: 'destructive' });
                        }
                      }}
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      Initiate Renewal
                    </Button>
                  )}
                  {hasRole('admin') && agreement.workflow_status === 'active' && (
                    <Button 
                      variant="outline"
                      size="sm"
                      onClick={() => setTransferOpen(true)}
                    >
                      <ArrowLeftRight className="h-4 w-4 mr-1.5" />
                      Transfer
                    </Button>
                  )}
                  {hasRole('admin') && agreement.workflow_status === 'active' && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setTerminationOpen(true)}
                    >
                      Terminate
                    </Button>
                  )}
                  {hasRole('admin') && ['draft', 'in_progress', 'pending_setup'].includes(agreement.workflow_status) && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={async () => {
                        const success = await advanceStatus(agreement.id, 'cancelled' as any, profile?.id);
                        if (success) {
                          toast({ title: 'Agreement cancelled' });
                          fetchData();
                        }
                      }}
                    >
                      Cancel
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
                            {agreement.start_date ? format(parseLocalDate(agreement.start_date), 'MMM d, yyyy') : 'Not set'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Renewal Date</p>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-auto p-0 font-medium hover:text-primary">
                                {agreement.next_renewal_date 
                                  ? format(parseLocalDate(agreement.next_renewal_date), 'MMM d, yyyy') 
                                  : <span className="text-muted-foreground italic">Click to set</span>}
                                <Pencil className="h-3 w-3 ml-1 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <CalendarWidget
                                mode="single"
                                selected={agreement.next_renewal_date ? parseLocalDate(agreement.next_renewal_date) : undefined}
                                onSelect={async (date) => {
                                  if (!date) return;
                                  const dateStr = format(date, 'yyyy-MM-dd');
                                  await supabase
                                    .from('collaborative_agreements')
                                    .update({ next_renewal_date: dateStr })
                                    .eq('id', agreement.id);
                                  toast({ title: 'Renewal date updated', description: format(date, 'MMM d, yyyy') });
                                  fetchData();
                                }}
                                className={cn("p-3 pointer-events-auto")}
                              />
                            </PopoverContent>
                          </Popover>
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
                        Tasks ({activeTasks.length})
                        {pendingRequiredTasks.length > 0 && (
                          <Badge variant="destructive" className="ml-2 text-xs h-5 px-1.5">
                            {pendingRequiredTasks.length}
                          </Badge>
                        )}
                      </TabsTrigger>
                      <TabsTrigger value="documents">Documents</TabsTrigger>
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
                              {tasks.map((task: AgreementTask) => {
                                const isArchived = task.status === 'archived';
                                return (
                                <Collapsible key={task.id}>
                                  <div
                                    className={cn(
                                      "rounded-lg border transition-colors",
                                      task.status === 'completed' && "bg-success/5 border-success/20",
                                      task.status === 'blocked' && "bg-destructive/5 border-destructive/20",
                                      isArchived && "opacity-40 bg-muted/20 border-dashed border-muted-foreground/20"
                                    )}
                                  >
                                    <CollapsibleTrigger asChild>
                                      <div className="flex items-start gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                                        {getTaskStatusIcon(task.status)}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <p className={cn("font-medium text-foreground", isArchived && "line-through text-muted-foreground")}>{task.title}</p>
                                            {isArchived && (
                                              <Badge variant="secondary" className="text-xs">Archived</Badge>
                                            )}
                                            {!isArchived && task.is_required && (
                                              <Badge variant="outline" className="text-xs">Required</Badge>
                                            )}
                                          </div>
                                          {task.description && (
                                            <p className="text-sm text-muted-foreground mt-0.5">{task.description}</p>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <Badge variant="outline" className="capitalize text-xs">{task.category.replace(/_/g, ' ')}</Badge>
                                          {hasRole('admin') && !isArchived && (
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(e) => { e.stopPropagation(); setEditingTask(taskToDashboardItem(task)); }}
                                            >
                                              <Pencil className="h-3 w-3" />
                                            </Button>
                                          )}
                                          {hasRole('admin') && !isArchived && task.status !== 'completed' && (
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
                                );
                              })}
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

                    <TabsContent value="documents" className="mt-4">
                      <AgreementDocuments agreementId={agreementId!} />
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
                          {agreement.meeting_cadence && (
                            <CardDescription>
                              Cadence: {agreement.meeting_cadence} · {agreement.state_name}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent>
                          {/* Company-wide meetings this provider is invited to */}
                          <CompanyWideMeetings 
                            providerEmail={agreement.provider_email || activeProviders[0]?.provider_email}
                            stateAbbreviation={agreement.state_abbreviation}
                          />

                          {upcomingMeetings.length > 0 && (
                            <div className="mb-6">
                              <p className="text-sm font-medium mb-2">Agreement-Specific (Legacy)</p>
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

      {agreement && (
        <BulkReassignDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          selectedAgreements={activeProviders.map(p => ({
            id: `${agreement.id}-${p.id}`,
            providerId: p.provider_id || '',
            providerName: p.provider_name,
            providerEmail: p.provider_email,
            physicianName: agreement.physician_name || '',
            physicianEmail: agreement.physician_email || '',
            stateAbbreviation: agreement.state_abbreviation,
            stateName: agreement.state_name,
            agreementId: agreement.id,
          }))}
          physicians={physicians}
          onSuccess={() => {
            setTransferOpen(false);
            fetchData();
            refetchTasks();
          }}
        />
      )}

      {agreement && (
        <VerificationChecklistDialog
          open={verificationOpen}
          onOpenChange={setVerificationOpen}
          agreementId={agreementId!}
          agreement={{
            state_abbreviation: agreement.state_abbreviation,
            state_name: agreement.state_name,
            physician_email: agreement.physician_email,
            physician_name: agreement.physician_name,
            physician_id: agreement.physician_id,
            provider_id: agreement.provider_id,
            agreement_document_url: agreement.agreement_document_url,
            meeting_cadence: agreement.meeting_cadence,
          }}
          onApprove={async () => {
            setVerificationOpen(false);
            await handleAdvanceStatus();
          }}
        />
      )}

      <TaskDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(open) => { if (!open) setEditingTask(null); }}
        isAdmin={true}
        onTaskUpdated={() => { setEditingTask(null); refetchTasks(); }}
      />
    </div>
  );
}

// Company-wide meetings sub-component
function CompanyWideMeetings({ providerEmail, stateAbbreviation }: { providerEmail?: string | null; stateAbbreviation: string }) {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompanyMeetings = async () => {
      if (!providerEmail) {
        setLoading(false);
        return;
      }

      // Find meetings where this provider is an attendee
      const { data: attendeeRecords } = await supabase
        .from('meeting_attendees')
        .select('meeting_id, attendance_status, has_rsvped, rsvp_slot, assigned_slot')
        .eq('provider_email', providerEmail);

      if (!attendeeRecords?.length) {
        setLoading(false);
        return;
      }

      const meetingIds = attendeeRecords.map(a => a.meeting_id);
      const { data: meetingData } = await supabase
        .from('supervision_meetings')
        .select('*')
        .in('id', meetingIds)
        .eq('is_company_wide', true)
        .order('scheduled_date', { ascending: true });

      // Merge attendance info
      const merged = (meetingData || []).map(m => ({
        ...m,
        attendee: attendeeRecords.find(a => a.meeting_id === m.id),
      }));

      setMeetings(merged);
      setLoading(false);
    };
    fetchCompanyMeetings();
  }, [providerEmail]);

  // Also fetch state cadence requirement
  const [cadenceInfo, setCadenceInfo] = useState<string | null>(null);
  useEffect(() => {
    const fetchCadence = async () => {
      const { data } = await supabase
        .from('state_compliance_requirements')
        .select('meeting_months, ca_meeting_cadence')
        .eq('state_abbreviation', stateAbbreviation)
        .maybeSingle();
      if (data) {
        const months = data.meeting_months as number[] | null;
        if (months && months.length === 12) setCadenceInfo('Monthly');
        else if (months && months.length === 4) setCadenceInfo('Quarterly');
        else if (months && months.length > 0) setCadenceInfo(`${months.length}x/year`);
        else setCadenceInfo('Periodic / as-needed');
      }
    };
    fetchCadence();
  }, [stateAbbreviation]);

  if (loading) {
    return <div className="animate-pulse h-16 bg-muted rounded mb-4" />;
  }

  const now = new Date();
  const upcoming = meetings.filter(m => new Date(m.scheduled_date) >= now && m.status !== 'cancelled');
  const past = meetings.filter(m => new Date(m.scheduled_date) < now || m.status === 'completed');

  return (
    <div className="mb-4">
      {cadenceInfo && (
        <div className="flex items-center gap-2 mb-3 text-sm">
          <Badge variant="outline">{stateAbbreviation}</Badge>
          <span className="text-muted-foreground">requires</span>
          <Badge variant="secondary">{cadenceInfo}</Badge>
          <span className="text-muted-foreground">meetings</span>
        </div>
      )}

      {upcoming.length > 0 ? (
        <div className="mb-4">
          <p className="text-sm font-medium mb-2">Next Company-Wide Meeting</p>
          {upcoming.slice(0, 2).map(meeting => (
            <div key={meeting.id} className="flex items-center justify-between p-3 rounded-lg border bg-primary/5 mb-2">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-primary" />
                <div>
                  <span className="font-medium">
                    {format(new Date(meeting.scheduled_date), 'EEEE, MMMM d, yyyy')}
                  </span>
                  {meeting.time_slot && (
                    <span className="text-sm text-muted-foreground ml-2">
                      ({meeting.time_slot === 'am' ? '10:00 AM' : '2:00 PM'} CT)
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {meeting.attendee?.has_rsvped ? (
                  <Badge className="bg-success/10 text-success">RSVP'd</Badge>
                ) : (
                  <Badge variant="outline">Not RSVP'd</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-muted-foreground text-sm border rounded-lg mb-4">
          No upcoming company-wide meetings scheduled
        </div>
      )}

      {past.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 text-muted-foreground">Past Company-Wide ({past.length})</p>
          <div className="space-y-1">
            {past.slice(0, 3).map(meeting => (
              <div key={meeting.id} className="flex items-center justify-between p-2 rounded border text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-muted-foreground">
                    {format(new Date(meeting.scheduled_date), 'MMM d, yyyy')}
                  </span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {meeting.attendee?.attendance_status || 'invited'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
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

// ---- Agreement Documents Component ----
function AgreementDocuments({ agreementId }: { agreementId: string }) {
  const [documents, setDocuments] = useState<Array<{
    id: string;
    task_id: string;
    file_name: string;
    file_path: string;
    file_size: number | null;
    mime_type: string | null;
    uploaded_by_name: string | null;
    created_at: string;
    task_title?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDocs = async () => {
      setLoading(true);
      const { data: docs } = await supabase
        .from('task_documents')
        .select('id, task_id, file_name, file_path, file_size, mime_type, uploaded_by_name, created_at')
        .eq('agreement_id', agreementId)
        .order('created_at', { ascending: false });

      if (docs && docs.length > 0) {
        // Enrich with task titles
        const taskIds = [...new Set(docs.map(d => d.task_id))];
        const { data: tasks } = await supabase
          .from('agreement_tasks')
          .select('id, title')
          .in('id', taskIds);
        const titleMap = new Map((tasks || []).map(t => [t.id, t.title]));
        setDocuments(docs.map(d => ({ ...d, task_title: titleMap.get(d.task_id) })));
      } else {
        setDocuments([]);
      }
      setLoading(false);
    };
    fetchDocs();
  }, [agreementId]);

  const handleView = async (filePath: string) => {
    const { data } = await supabase.storage
      .from('task-documents')
      .createSignedUrl(filePath, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Group by task
  const grouped = documents.reduce<Record<string, typeof documents>>((acc, doc) => {
    const key = doc.task_title || doc.task_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {});

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-12 bg-muted rounded" />
            <div className="h-12 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="h-5 w-5" />
          Documents ({documents.length})
        </CardTitle>
        <CardDescription>
          All documents uploaded across tasks for this agreement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length > 0 ? (
          <div className="space-y-6">
            {Object.entries(grouped).map(([taskTitle, docs]) => (
              <div key={taskTitle}>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                  {taskTitle}
                </h4>
                <div className="space-y-2">
                  {docs.map(doc => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleView(doc.file_path)}
                    >
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.file_name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {doc.uploaded_by_name && <span>{doc.uploaded_by_name}</span>}
                          <span>{format(new Date(doc.created_at), 'MMM d, yyyy')}</span>
                          {doc.file_size && <span>{formatSize(doc.file_size)}</span>}
                        </div>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Paperclip className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No documents uploaded yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Documents will appear here when uploaded to tasks.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}