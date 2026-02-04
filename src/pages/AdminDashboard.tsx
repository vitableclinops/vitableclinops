import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { providers, getAllTasks, states } from '@/data/mockData';
import { 
  Users, 
  ClipboardList, 
  AlertTriangle, 
  CheckCircle2,
  Search,
  Filter,
  ChevronRight,
  MapPin,
  Receipt,
  Clock,
  Shield
} from 'lucide-react';
import type { Task, TaskStatus, Provider } from '@/types';

const AdminDashboard = () => {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Calculate admin stats
  const allTasks = getAllTasks();
  const tasksByStatus: Record<TaskStatus, number> = {
    not_started: allTasks.filter(t => t.status === 'not_started').length,
    in_progress: allTasks.filter(t => t.status === 'in_progress').length,
    submitted: allTasks.filter(t => t.status === 'submitted').length,
    verified: allTasks.filter(t => t.status === 'verified').length,
    approved: allTasks.filter(t => t.status === 'approved').length,
    blocked: allTasks.filter(t => t.status === 'blocked').length,
  };
  
  const pendingReimbursements = allTasks.filter(t => 
    t.reimbursement?.status === 'pending'
  ).length;
  
  const providersWithBlockers = providers.filter(p => 
    p.states.some(s => s.tasks.some(t => t.status === 'blocked'))
  );
  
  const providersReadyForActivation = providers.filter(p =>
    p.states.some(s => s.isReadyForActivation)
  );

  // Tasks needing review (submitted status)
  const tasksNeedingReview = allTasks.filter(t => t.status === 'submitted');

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  const getProviderFromTask = (task: Task): Provider | undefined => {
    return providers.find(p => p.id === task.providerId);
  };

  const getStateFromTask = (task: Task) => {
    return states.find(s => s.id === task.stateId);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole="admin"
        userName="Sarah Chen"
        userEmail="sarah.chen@example.com"
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">
              Operations Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage provider licensure, review submissions, and track progress.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
            <StatCard
              title="Total Providers"
              value={providers.length}
              subtitle={`${providersReadyForActivation.length} ready for activation`}
              icon={Users}
              variant="default"
            />
            <StatCard
              title="Active Tasks"
              value={tasksByStatus.in_progress + tasksByStatus.submitted}
              subtitle="In progress or submitted"
              icon={ClipboardList}
              variant="default"
            />
            <StatCard
              title="Needs Review"
              value={tasksByStatus.submitted}
              subtitle="Awaiting verification"
              icon={Clock}
              variant="warning"
            />
            <StatCard
              title="Blocked"
              value={tasksByStatus.blocked}
              subtitle={`${providersWithBlockers.length} provider${providersWithBlockers.length !== 1 ? 's' : ''} affected`}
              icon={AlertTriangle}
              variant={tasksByStatus.blocked > 0 ? 'danger' : 'default'}
            />
            <StatCard
              title="Pending Reimbursements"
              value={pendingReimbursements}
              subtitle="Awaiting approval"
              icon={Receipt}
              variant="warning"
            />
          </div>

          {/* Main content grid */}
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Tasks needing review */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-4">
                  <CardTitle className="text-lg">Tasks Needing Review</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search tasks..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 w-64"
                      />
                    </div>
                    <Button variant="outline" size="icon">
                      <Filter className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {tasksNeedingReview.length > 0 ? (
                    <div className="space-y-3">
                      {tasksNeedingReview.map(task => {
                        const provider = getProviderFromTask(task);
                        const state = getStateFromTask(task);
                        
                        return (
                          <div 
                            key={task.id}
                            className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer group"
                          >
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="bg-primary/10 text-primary text-sm">
                                {provider ? getInitials(provider.firstName, provider.lastName) : '??'}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-foreground">
                                  {provider?.firstName} {provider?.lastName}
                                </span>
                                <span className="text-muted-foreground">•</span>
                                <Badge variant="secondary" className="text-xs">
                                  {state?.abbreviation}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {task.title}
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <StatusBadge status={task.status} size="sm" />
                              <span className="text-xs text-muted-foreground">
                                {task.evidence.length} file{task.evidence.length !== 1 ? 's' : ''}
                              </span>
                              <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <CheckCircle2 className="h-12 w-12 mx-auto text-success mb-3" />
                      <p className="text-muted-foreground">
                        No tasks pending review. You're all caught up!
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Provider status sidebar */}
            <div className="space-y-6">
              {/* Ready for activation */}
              <Card className="border-success/30">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Shield className="h-4 w-4 text-success" />
                    Ready for Activation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {providersReadyForActivation.length > 0 ? (
                    providersReadyForActivation.map(provider => {
                      const readyStates = provider.states.filter(s => s.isReadyForActivation);
                      
                      return (
                        <div 
                          key={provider.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-success/5 cursor-pointer hover:bg-success/10 transition-colors"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-success/20 text-success text-xs">
                              {getInitials(provider.firstName, provider.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {provider.firstName} {provider.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {readyStates.map(s => s.state.abbreviation).join(', ')}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No providers ready for activation
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Blocked providers */}
              {providersWithBlockers.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      Blocked Providers
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {providersWithBlockers.map(provider => {
                      const blockedStates = provider.states.filter(s => 
                        s.tasks.some(t => t.status === 'blocked')
                      );
                      
                      return (
                        <div 
                          key={provider.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 cursor-pointer hover:bg-destructive/10 transition-colors"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-destructive/20 text-destructive text-xs">
                              {getInitials(provider.firstName, provider.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {provider.firstName} {provider.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {blockedStates.map(s => s.state.abbreviation).join(', ')} blocked
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Quick stats by status */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Task Distribution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(tasksByStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <StatusBadge status={status as TaskStatus} size="sm" />
                      <span className="text-sm font-medium text-foreground">{count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
