import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { MvpBanner } from '@/components/MvpBanner';
import { UpcomingMilestonesWidget } from '@/components/milestones/UpcomingMilestonesWidget';
import { ActiveTransfersWidget } from '@/components/agreements/ActiveTransfersWidget';
import { useGenerateMilestoneTasks } from '@/hooks/useMilestones';
import { useAdminDashboard } from '@/hooks/useAdminDashboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Users, 
  AlertTriangle, 
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Calendar,
  ShieldCheck,
  Cake,
  RefreshCw,
  Loader2,
  ArrowRightLeft,
  Flag,
  Lock,
  ListChecks,
  UserPlus,
  MapPin
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const AdminDashboard = () => {
  const { profile, roles } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('tasks');
  const [taskFilter, setTaskFilter] = useState<'all' | 'unassigned' | 'mine' | 'blocked' | 'escalated'>('all');
  const generateMilestones = useGenerateMilestoneTasks();
  const { stats, actionableTasks, taskStatusCounts, loading, refetch } = useAdminDashboard();
  
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';
  const userId = profile?.id;

  // Filter tasks based on active filter
  const filteredTasks = actionableTasks.filter(task => {
    switch (taskFilter) {
      case 'unassigned': return !task.assigned_to;
      case 'mine': return task.assigned_to === userId;
      case 'blocked': return task.status === 'blocked' || task.status === 'waiting_on_signature';
      case 'escalated': return task.escalated;
      default: return true;
    }
  });

  const unassignedCount = actionableTasks.filter(t => !t.assigned_to).length;
  const myTaskCount = actionableTasks.filter(t => t.assigned_to === userId).length;
  const blockedCount = actionableTasks.filter(t => t.status === 'blocked' || t.status === 'waiting_on_signature').length;
  const escalatedCount = actionableTasks.filter(t => t.escalated).length;

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

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'documents': return <FileText className="h-3.5 w-3.5" />;
      case 'document': return <FileText className="h-3.5 w-3.5" />;
      case 'signature': return <FileText className="h-3.5 w-3.5" />;
      case 'clinical': return <ShieldCheck className="h-3.5 w-3.5" />;
      case 'supervision_meeting': return <Calendar className="h-3.5 w-3.5" />;
      case 'chart_review': return <ShieldCheck className="h-3.5 w-3.5" />;
      case 'compliance': return <ShieldCheck className="h-3.5 w-3.5" />;
      case 'workflows': return <ArrowRightLeft className="h-3.5 w-3.5" />;
      case 'outreach': return <Users className="h-3.5 w-3.5" />;
      case 'milestones': return <Cake className="h-3.5 w-3.5" />;
      case 'milestone': return <Cake className="h-3.5 w-3.5" />;
      default: return <ListChecks className="h-3.5 w-3.5" />;
    }
  };

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case 'critical': return 'text-destructive';
      case 'high': return 'text-warning';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole as any}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          <MvpBanner />

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">
              Provider Operations Hub
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Real-time oversight of provider compliance, agreements, and operational workflows.
            </p>
          </div>

          {/* Stats Grid */}
          {loading ? (
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-8">
              <StatCard
                title="Internal Providers"
                value={stats.totalInternalProviders}
                subtitle={`${stats.w2Count} W2 · ${stats.contractorCount} 1099`}
                icon={Users}
                variant="default"
              />
              <StatCard
                title="Active Agreements"
                value={stats.activeAgreements}
                subtitle={`${stats.draftAgreements} draft · ${stats.pendingSetupAgreements} pending`}
                icon={FileText}
                variant="default"
              />
              <StatCard
                title="Active Transfers"
                value={stats.activeTransfers}
                subtitle="In progress"
                icon={ArrowRightLeft}
                variant={stats.activeTransfers > 0 ? 'warning' : 'default'}
              />
              <StatCard
                title="Open Tasks"
                value={actionableTasks.length}
                subtitle={`${unassignedCount} unassigned`}
                icon={ListChecks}
                variant={unassignedCount > 0 ? 'warning' : 'default'}
              />
              <StatCard
                title="Blocked"
                value={blockedCount}
                subtitle={`${escalatedCount} escalated`}
                icon={AlertTriangle}
                variant={blockedCount > 0 ? 'danger' : 'default'}
              />
              <StatCard
                title="Completed"
                value={taskStatusCounts['completed'] || 0}
                subtitle="Total tasks done"
                icon={CheckCircle2}
                variant="success"
              />
            </div>
          )}

          {/* Main Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="tasks" className="gap-2">
                <ListChecks className="h-4 w-4" />
                Task Queue
                {actionableTasks.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">{actionableTasks.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="compliance" className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                Compliance
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tasks">
              <div className="grid gap-8 lg:grid-cols-3">
                {/* Task Queue */}
                <div className="lg:col-span-2">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Actionable Tasks</CardTitle>
                        <Button variant="ghost" size="sm" onClick={refetch}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 mt-2 flex-wrap">
                        {[
                          { key: 'all', label: 'All', count: actionableTasks.length },
                          { key: 'unassigned', label: 'Unassigned', count: unassignedCount },
                          { key: 'mine', label: 'My Tasks', count: myTaskCount },
                          { key: 'blocked', label: 'Blocked', count: blockedCount },
                          { key: 'escalated', label: 'Escalated', count: escalatedCount },
                        ].map(f => (
                          <Button
                            key={f.key}
                            variant={taskFilter === f.key ? 'secondary' : 'ghost'}
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => setTaskFilter(f.key as any)}
                          >
                            {f.label}
                            {f.count > 0 && (
                              <Badge variant="outline" className="ml-1 text-[10px] px-1">{f.count}</Badge>
                            )}
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
                          {(() => {
                            const groupMap: Record<string, string> = {
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
                            const groupLabels: Record<string, string> = {
                              documents: 'Documents & Signatures',
                              clinical: 'Clinical Oversight',
                              workflows: 'Workflows & Transfers',
                              milestones: 'Milestones',
                              outreach: 'Outreach & Communication',
                              general: 'General',
                            };
                            const grouped = filteredTasks.reduce<Record<string, typeof filteredTasks>>((acc, task) => {
                              const cat = groupMap[task.category] || 'general';
                              if (!acc[cat]) acc[cat] = [];
                              acc[cat].push(task);
                              return acc;
                            }, {});
                            return Object.entries(grouped).map(([category, tasks]) => (
                              <div key={category}>
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-muted-foreground">{getCategoryIcon(category)}</span>
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {groupLabels[category] || category.replace(/_/g, ' ')}
                                  </h4>
                                  <Badge variant="outline" className="text-[10px] px-1">{tasks.length}</Badge>
                                </div>
                                <div className="space-y-1.5">
                                  {tasks.map(task => (
                                    <div 
                                      key={task.id}
                                      className={cn(
                                        "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors group",
                                        task.escalated && "border-destructive/30 bg-destructive/5",
                                        (task.status === 'blocked' || task.status === 'waiting_on_signature') && "border-warning/30 bg-warning/5"
                                      )}
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
                                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                          {task.state_name && (
                                            <span className="flex items-center gap-0.5">
                                              <MapPin className="h-3 w-3" />
                                              {task.state_abbreviation || task.state_name}
                                            </span>
                                          )}
                                          {task.provider_name && (
                                            <span>• {task.provider_name}</span>
                                          )}
                                          {task.transfer_id && (
                                            <Badge variant="outline" className="text-[10px] px-1">Transfer</Badge>
                                          )}
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
                                          <p className="text-xs text-warning mt-0.5 truncate">
                                            {task.blocked_reason}
                                          </p>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        {task.assigned_to_name ? (
                                          <Badge variant="outline" className="text-xs">
                                            {task.assigned_to_name}
                                          </Badge>
                                        ) : (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs text-muted-foreground hover:text-primary gap-1"
                                            onClick={() => handleSelfAssign(task.id)}
                                          >
                                            <UserPlus className="h-3 w-3" />
                                            Claim
                                          </Button>
                                        )}
                                        {task.transfer_id && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                            onClick={() => navigate('/admin/agreements')}
                                          >
                                            <ChevronRight className="h-4 w-4" />
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ));
                          })()}
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
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  {/* Active Transfers */}
                  <ActiveTransfersWidget />

                  {/* Task Distribution */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Task Status Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {Object.entries(taskStatusCounts).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "h-2 w-2 rounded-full",
                              status === 'completed' && "bg-success",
                              status === 'pending' && "bg-muted-foreground",
                              status === 'in_progress' && "bg-primary",
                              status === 'blocked' && "bg-warning",
                              status === 'waiting_on_signature' && "bg-warning",
                            )} />
                            <span className="text-sm capitalize">{status.replace(/_/g, ' ')}</span>
                          </div>
                          <span className="text-sm font-medium">{count}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Upcoming Milestones */}
                  <UpcomingMilestonesWidget />
                  
                  {/* Generate Milestone Tasks */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Cake className="h-4 w-4 text-pink-500" />
                        Milestone Tasks
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-3">
                        Scan all providers and generate upcoming birthday & anniversary tasks for pod leads.
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                        onClick={() => generateMilestones.mutate()}
                        disabled={generateMilestones.isPending}
                      >
                        {generateMilestones.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Generate Milestone Tasks
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="compliance">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Users className="h-5 w-5 text-primary" />
                      Internal Provider Compliance
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Compliance is monitored for all internal (W2 and 1099) providers. Agency-supplied providers are managed externally.
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-4 rounded-lg bg-primary/5 border">
                        <p className="text-2xl font-bold text-primary">{stats.totalInternalProviders}</p>
                        <p className="text-xs text-muted-foreground mt-1">Internal Providers</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-muted/50 border">
                        <p className="text-2xl font-bold">{stats.w2Count}</p>
                        <p className="text-xs text-muted-foreground mt-1">W2 Employees</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-muted/50 border">
                        <p className="text-2xl font-bold">{stats.contractorCount}</p>
                        <p className="text-xs text-muted-foreground mt-1">1099 Contractors</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border text-sm">
                      <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">
                        {stats.agencyCount} agency-supplied provider{stats.agencyCount !== 1 ? 's' : ''} excluded from internal compliance tracking.
                      </span>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => navigate('/admin/directory')}>
                      View Provider Directory
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <FileText className="h-5 w-5 text-primary" />
                      Agreement Overview
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full bg-success" />
                          <span className="text-sm">Active Agreements</span>
                        </div>
                        <span className="text-sm font-bold">{stats.activeAgreements}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />
                          <span className="text-sm">Draft</span>
                        </div>
                        <span className="text-sm font-bold">{stats.draftAgreements}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full bg-warning" />
                          <span className="text-sm">Pending Setup / Verification</span>
                        </div>
                        <span className="text-sm font-bold">{stats.pendingSetupAgreements}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                          <span className="text-sm">Active Transfers</span>
                        </div>
                        <span className="text-sm font-bold">{stats.activeTransfers}</span>
                      </div>
                      {stats.upcomingRenewals > 0 && (
                        <div className="flex items-center justify-between p-3 rounded-lg border border-warning/30 bg-warning/5">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-warning" />
                            <span className="text-sm">Renewals (next 90 days)</span>
                          </div>
                          <span className="text-sm font-bold text-warning">{stats.upcomingRenewals}</span>
                        </div>
                      )}
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => navigate('/admin/agreements')}>
                      Manage Agreements
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
