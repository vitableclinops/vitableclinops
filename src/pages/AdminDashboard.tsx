import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { MvpBanner } from '@/components/MvpBanner';
import { AdminStatsGrid } from '@/components/admin/AdminStatsGrid';
import { AdminTaskQueue } from '@/components/admin/AdminTaskQueue';
import { AdminComplianceTab } from '@/components/admin/AdminComplianceTab';
import { AdminDashboardSidebar } from '@/components/admin/AdminDashboardSidebar';
import { ArchiveTaskDialog } from '@/components/admin/ArchiveTaskDialog';
import { ReassignTaskDialog } from '@/components/admin/ReassignTaskDialog';
import { BulkReassignDialog } from '@/components/admin/BulkReassignDialog';
import { BulkArchiveDialog } from '@/components/admin/BulkArchiveDialog';
import { TaskDialog, type TaskDialogTask } from '@/components/tasks/TaskDialog';
import { AddTaskDialog } from '@/components/admin/AddTaskDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListChecks, ShieldCheck, Activity, TrendingUp, BarChart3, Network, Cpu, DollarSign, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminDashboard } from '@/hooks/useAdminDashboard';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';

const OPS_LINKS = [
  { label: 'Ops Dashboard', icon: Activity,    href: '/admin/ops',                  color: 'text-primary' },
  { label: 'Demand Forecast', icon: TrendingUp,  href: '/admin/demand-forecast',       color: 'text-emerald-600' },
  { label: 'Utilization',   icon: BarChart3,   href: '/admin/utilization',           color: 'text-yellow-600' },
  { label: 'Routing',       icon: Network,     href: '/admin/routing',               color: 'text-blue-600' },
  { label: 'Matching',      icon: Cpu,         href: '/admin/matching',              color: 'text-violet-600' },
  { label: 'DS Strategy',   icon: DollarSign,  href: '/admin/contractor-strategy',   color: 'text-orange-600' },
];

const AdminDashboard = () => {
  const { profile, hasRole } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('tasks');
  const { stats, actionableTasks, archivedTasks, taskStatusCounts, loading, refetch } = useAdminDashboard();
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; title: string } | null>(null);
  const [reassignTarget, setReassignTarget] = useState<{ id: string; title: string; assignee: string | null } | null>(null);
  const [editTarget, setEditTarget] = useState<TaskDialogTask | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [bulkReassignIds, setBulkReassignIds] = useState<string[]>([]);
  const [bulkArchiveIds, setBulkArchiveIds] = useState<string[]>([]);

  const isAdmin = hasRole('admin');
  const isPodLead = hasRole('pod_lead') && !isAdmin;
  const userRole = isAdmin ? 'admin' : isPodLead ? 'pod_lead' : 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';
  const userId = profile?.id;

  // For pod leads, only show tasks assigned to them
  const visibleTasks = isPodLead
    ? actionableTasks.filter(t => t.assigned_to === userId)
    : actionableTasks;

  const unassignedCount = visibleTasks.filter(t => !t.assigned_to).length;
  const blockedCount = visibleTasks.filter(t => t.status === 'blocked' || t.status === 'waiting_on_signature').length;
  const escalatedCount = visibleTasks.filter(t => t.escalated).length;

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
              {isPodLead ? 'Pod Lead Dashboard' : 'Provider Operations Hub'}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              {isPodLead
                ? 'Your milestone tasks and team celebrations.'
                : 'Real-time oversight of provider compliance, agreements, and operational workflows.'}
            </p>
          </div>

          {/* Stats Grid - only for admins */}
          {!isPodLead && (
            <AdminStatsGrid
              stats={stats}
              loading={loading}
              totalTasks={actionableTasks.length}
              unassignedCount={unassignedCount}
              blockedCount={blockedCount}
              escalatedCount={escalatedCount}
              completedCount={taskStatusCounts['completed'] || 0}
            />
          )}

          {/* Coverage & Ops quick links — admin only */}
          {!isPodLead && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Coverage &amp; Ops
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => navigate('/admin/ops')}
                >
                  Open Ops Dashboard <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {OPS_LINKS.map(({ label, icon: Icon, href, color }) => (
                  <Card
                    key={href}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(href)}
                  >
                    <CardContent className="p-3 flex flex-col items-center gap-1.5">
                      <Icon className={`h-5 w-5 ${color}`} />
                      <span className="text-xs font-medium text-center leading-tight">{label}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Main Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="tasks" className="gap-2">
                <ListChecks className="h-4 w-4" />
                {isPodLead ? 'My Tasks' : 'Task Queue'}
                {visibleTasks.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">{visibleTasks.length}</Badge>
                )}
              </TabsTrigger>
              {!isPodLead && (
                <TabsTrigger value="compliance" className="gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Compliance
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="tasks">
              <div className="grid gap-8 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <AdminTaskQueue
                    actionableTasks={visibleTasks}
                    archivedTasks={archivedTasks}
                    loading={loading}
                    userId={userId}
                    refetch={refetch}
                    onEditTask={setEditTarget}
                    onArchiveTask={setArchiveTarget}
                    onReassignTask={setReassignTarget}
                    onAddTask={() => setShowAddTask(true)}
                    onBulkReassign={(ids) => setBulkReassignIds(ids)}
                    onBulkArchive={(ids) => setBulkArchiveIds(ids)}
                  />
                </div>
                <AdminDashboardSidebar taskStatusCounts={taskStatusCounts} tasks={visibleTasks} />
              </div>
            </TabsContent>

            <TabsContent value="compliance">
              <AdminComplianceTab stats={stats} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <ArchiveTaskDialog
        taskId={archiveTarget?.id || null}
        taskTitle={archiveTarget?.title || ''}
        onClose={() => setArchiveTarget(null)}
        onSuccess={() => { setArchiveTarget(null); refetch(); }}
      />
      <ReassignTaskDialog
        taskId={reassignTarget?.id || null}
        taskTitle={reassignTarget?.title || ''}
        currentAssignee={reassignTarget?.assignee || null}
        onClose={() => setReassignTarget(null)}
        onSuccess={() => { setReassignTarget(null); refetch(); }}
      />
      <BulkReassignDialog
        taskIds={bulkReassignIds}
        open={bulkReassignIds.length > 0}
        onClose={() => setBulkReassignIds([])}
        onSuccess={() => { setBulkReassignIds([]); refetch(); }}
      />
      <BulkArchiveDialog
        taskIds={bulkArchiveIds}
        open={bulkArchiveIds.length > 0}
        onClose={() => setBulkArchiveIds([])}
        onSuccess={() => { setBulkArchiveIds([]); refetch(); }}
      />
      <TaskDialog
        task={editTarget}
        open={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        isAdmin={true}
        onTaskUpdated={() => { setEditTarget(null); refetch(); }}
      />
      <AddTaskDialog
        open={showAddTask}
        onClose={() => setShowAddTask(false)}
        onSuccess={() => { setShowAddTask(false); refetch(); }}
      />
    </div>
  );
};

export default AdminDashboard;
