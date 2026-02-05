import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { StateCard } from '@/components/StateCard';
import { TaskCard } from '@/components/TaskCard';
import { ActivationReadinessCard } from '@/components/ActivationReadinessCard';
import { ComplianceStatusCard } from '@/components/ComplianceStatusCard';
import { DemandTagBadge } from '@/components/DemandTagBadge';
import { ProviderMeetingRSVP } from '@/components/meetings/ProviderMeetingRSVP';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { currentUser, getProviderStats, states } from '@/data/mockData';
import { useAuth } from '@/hooks/useAuth';
import { 
  MapPin, 
  ClipboardList, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  ChevronRight,
  Receipt,
  Users,
  ShieldCheck,
  FileText
} from 'lucide-react';
import type { Task } from '@/types';

const ProviderDashboard = () => {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const stats = getProviderStats(currentUser);
  
  // Get all tasks sorted by priority
  const allTasks = currentUser.states.flatMap(s => 
    s.tasks.map(t => ({ ...t, stateName: s.state.name, state: s.state }))
  );
  
  const urgentTasks = allTasks.filter(t => 
    t.status === 'blocked' || t.status === 'in_progress'
  );
  
  const upcomingTasks = allTasks.filter(t => 
    t.status === 'not_started' || t.status === 'submitted'
  ).slice(0, 5);

  // Get states with demand tags
  const criticalStates = currentUser.states.filter(s => s.state.demandTag === 'critical');
  const complianceTasks = allTasks.filter(t => t.category === 'compliance');

  const { profile, roles } = useAuth();
  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || `${currentUser.firstName} ${currentUser.lastName}`;
  const userEmail = profile?.email || currentUser.email;

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
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">
              Welcome back, {currentUser.firstName}
            </h1>
            <p className="text-muted-foreground mt-1">
              Here's your licensure overview and what needs your attention.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
            <StatCard
              title="Licensed States"
              value={stats.licensedStates}
              subtitle={`of ${stats.totalStates} total`}
              icon={MapPin}
              variant="success"
            />
            <StatCard
              title="Pending Tasks"
              value={stats.pendingTasks}
              subtitle="Awaiting action"
              icon={ClipboardList}
              variant="default"
            />
            <StatCard
              title="Blocked Tasks"
              value={stats.blockedTasks}
              subtitle="Needs attention"
              icon={AlertTriangle}
              variant={stats.blockedTasks > 0 ? 'danger' : 'default'}
            />
            <StatCard
              title="Compliance"
              value={stats.complianceComplete ? '✓' : stats.overdueComplianceTasks}
              subtitle={stats.complianceComplete ? 'All complete' : 'overdue tasks'}
              icon={ShieldCheck}
              variant={stats.complianceComplete ? 'success' : 'warning'}
            />
            <StatCard
              title="Reimbursements"
              value={stats.pendingReimbursements}
              subtitle="Pending approval"
              icon={Receipt}
              variant="warning"
            />
          </div>

          {/* Priority states alert */}
          {criticalStates.length > 0 && (
            <Card className="mb-8 border-destructive/30 bg-destructive/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Priority States
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  These states have high demand and need expedited licensure:
                </p>
                <div className="flex flex-wrap gap-3">
                  {criticalStates.map(ps => (
                    <div 
                      key={ps.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border"
                    >
                      <span className="font-medium">{ps.state.name}</span>
                      <DemandTagBadge tag={ps.state.demandTag!} size="sm" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Urgent Tasks */}
          {urgentTasks.length > 0 && (
            <Card className="mb-8 border-warning/20 bg-warning/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                  Needs Your Attention
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {urgentTasks.map(task => (
                  <div key={task.id}>
                    {task.demandReason && (
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-warning" />
                        {task.demandReason}
                      </p>
                    )}
                    <TaskCard 
                      task={task} 
                      stateName={task.stateName}
                      showState
                      onClick={() => setSelectedTask(task)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Main content grid */}
          <div className="grid gap-8 lg:grid-cols-3">
            {/* States section */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Your States</h2>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  View all
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {currentUser.states.map(providerState => (
                  <div key={providerState.id} className="space-y-3">
                    <StateCard 
                      providerState={providerState}
                      onClick={() => console.log('View state:', providerState.state.name)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Upcoming Meetings RSVP */}
              <ProviderMeetingRSVP />

              {/* Compliance status */}
              {currentUser.complianceStatus && (
                <ComplianceStatusCard 
                  status={currentUser.complianceStatus}
                  tasks={complianceTasks}
                />
              )}

              {/* Upcoming tasks */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Up Next</CardTitle>
                    <Button variant="ghost" size="sm" className="text-muted-foreground h-8">
                      View all
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {upcomingTasks.slice(0, 3).map(task => (
                    <TaskCard 
                      key={task.id} 
                      task={task}
                      stateName={task.stateName}
                      showState
                      onClick={() => setSelectedTask(task)}
                    />
                  ))}
                  {upcomingTasks.length === 0 && (
                    <div className="py-4 text-center">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-success mb-2" />
                      <p className="text-sm text-muted-foreground">
                        All caught up!
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ProviderDashboard;
