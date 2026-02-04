import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { StateCard } from '@/components/StateCard';
import { TaskCard } from '@/components/TaskCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { currentUser, getProviderStats, states } from '@/data/mockData';
import { 
  MapPin, 
  ClipboardList, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  ChevronRight,
  Receipt
} from 'lucide-react';
import type { Task } from '@/types';

const ProviderDashboard = () => {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const stats = getProviderStats(currentUser);
  
  // Get all tasks sorted by priority
  const allTasks = currentUser.states.flatMap(s => 
    s.tasks.map(t => ({ ...t, stateName: s.state.name }))
  );
  
  const urgentTasks = allTasks.filter(t => 
    t.status === 'blocked' || t.status === 'in_progress'
  );
  
  const upcomingTasks = allTasks.filter(t => 
    t.status === 'not_started' || t.status === 'submitted'
  ).slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={currentUser.role}
        userName={`${currentUser.firstName} ${currentUser.lastName}`}
        userEmail={currentUser.email}
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
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
              title="Pending Reimbursements"
              value={stats.pendingReimbursements}
              subtitle="Awaiting approval"
              icon={Receipt}
              variant="warning"
            />
          </div>

          {/* Urgent Tasks */}
          {urgentTasks.length > 0 && (
            <Card className="mb-8 border-destructive/20 bg-destructive/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Needs Your Attention
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {urgentTasks.map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    stateName={task.stateName}
                    showState
                    onClick={() => setSelectedTask(task)}
                  />
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
                  <StateCard 
                    key={providerState.id} 
                    providerState={providerState}
                    onClick={() => console.log('View state:', providerState.state.name)}
                  />
                ))}
              </div>
            </div>

            {/* Upcoming tasks */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Up Next</h2>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  View all
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
              <div className="space-y-3">
                {upcomingTasks.map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task}
                    stateName={task.stateName}
                    showState
                    onClick={() => setSelectedTask(task)}
                  />
                ))}
                {upcomingTasks.length === 0 && (
                  <Card className="border-dashed">
                    <CardContent className="py-8 text-center">
                      <CheckCircle2 className="h-10 w-10 mx-auto text-success mb-3" />
                      <p className="text-sm text-muted-foreground">
                        All caught up! No pending tasks.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ProviderDashboard;
