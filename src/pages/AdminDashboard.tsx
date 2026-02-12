import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { MvpBanner } from '@/components/MvpBanner';
import { AdminStatsGrid } from '@/components/admin/AdminStatsGrid';
import { AdminTaskQueue } from '@/components/admin/AdminTaskQueue';
import { AdminComplianceTab } from '@/components/admin/AdminComplianceTab';
import { AdminDashboardSidebar } from '@/components/admin/AdminDashboardSidebar';
import { ArchiveTaskDialog } from '@/components/admin/ArchiveTaskDialog';
import { ReassignTaskDialog } from '@/components/admin/ReassignTaskDialog';
import { EditTaskDialog } from '@/components/admin/EditTaskDialog';
import { AddTaskDialog } from '@/components/admin/AddTaskDialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListChecks, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAdminDashboard } from '@/hooks/useAdminDashboard';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';

const AdminDashboard = () => {
  const { profile, hasRole } = useAuth();
  const [activeTab, setActiveTab] = useState('tasks');
  const { stats, actionableTasks, archivedTasks, taskStatusCounts, loading, refetch } = useAdminDashboard();
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; title: string } | null>(null);
  const [reassignTarget, setReassignTarget] = useState<{ id: string; title: string; assignee: string | null } | null>(null);
  const [editTarget, setEditTarget] = useState<DashboardTaskItem | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);

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
                  />
                </div>
                <AdminDashboardSidebar taskStatusCounts={taskStatusCounts} />
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
      <EditTaskDialog
        task={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => { setEditTarget(null); refetch(); }}
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
