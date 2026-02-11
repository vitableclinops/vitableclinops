import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { CategoryBadge } from '@/components/CategoryBadge';
import { DemandTagBadge } from '@/components/DemandTagBadge';
import { SelfReportedLicenseCard } from '@/components/SelfReportedLicenseCard';
import { MvpBanner } from '@/components/MvpBanner';
import { ComplianceRiskSummaryCard } from '@/components/ComplianceRiskSummary';
import { UpcomingMilestonesWidget } from '@/components/milestones/UpcomingMilestonesWidget';
import { ActiveTransfersWidget } from '@/components/agreements/ActiveTransfersWidget';
import { useGenerateMilestoneTasks } from '@/hooks/useMilestones';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  providers, 
  getAllTasks, 
  states, 
  collaborativeAgreements,
  selfReportedLicenses,
  getPendingLicenseVerifications
} from '@/data/mockData';
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
  Shield,
  FileText,
  Calendar,
  ShieldCheck,
  Cake,
  RefreshCw,
  Loader2
} from 'lucide-react';
import type { Task, TaskStatus, Provider, TaskCategory } from '@/types';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

const AdminDashboard = () => {
  const { profile, roles } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('review');
  const [categoryFilter, setCategoryFilter] = useState<TaskCategory | 'all'>('all');
  const generateMilestones = useGenerateMilestoneTasks();
  
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';
  
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

  const tasksByCategory: Record<TaskCategory, number> = {
    licensure: allTasks.filter(t => t.category === 'licensure').length,
    collaborative: allTasks.filter(t => t.category === 'collaborative').length,
    compliance: allTasks.filter(t => t.category === 'compliance').length,
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

  const pendingLicenseVerifications = getPendingLicenseVerifications();
  const pendingRenewalAgreements = collaborativeAgreements.filter(a => a.status === 'pending_renewal');
  const nonCompliantProviders = providers.filter(p => !p.complianceStatus?.isCompliant);

  // Tasks needing review (submitted status)
  const tasksNeedingReview = allTasks.filter(t => {
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return t.status === 'submitted' && matchesCategory;
  });

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
        userRole={userRole as any}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          {/* MVP Banner */}
          <MvpBanner />

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">
              Provider Operations Hub
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage provider licensure, agreements, compliance, and track progress.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-8">
            <StatCard
              title="Total Providers"
              value={providers.length}
              subtitle={`${providersReadyForActivation.length} ready`}
              icon={Users}
              variant="default"
            />
            <StatCard
              title="Needs Review"
              value={tasksByStatus.submitted}
              subtitle="Submitted tasks"
              icon={Clock}
              variant={tasksByStatus.submitted > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="License Verifications"
              value={pendingLicenseVerifications.length}
              subtitle="Self-reported"
              icon={FileText}
              variant={pendingLicenseVerifications.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Agreement Renewals"
              value={pendingRenewalAgreements.length}
              subtitle="Pending renewal"
              icon={Calendar}
              variant={pendingRenewalAgreements.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Non-Compliant"
              value={nonCompliantProviders.length}
              subtitle="Providers"
              icon={ShieldCheck}
              variant={nonCompliantProviders.length > 0 ? 'danger' : 'success'}
            />
            <StatCard
              title="Blocked"
              value={tasksByStatus.blocked}
              subtitle={`${providersWithBlockers.length} providers`}
              icon={AlertTriangle}
              variant={tasksByStatus.blocked > 0 ? 'danger' : 'default'}
            />
          </div>

          {/* Compliance Risk Summary */}
          <div className="mb-8">
            <ComplianceRiskSummaryCard />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="review" className="gap-2">
                <Clock className="h-4 w-4" />
                Review Queue
              </TabsTrigger>
              <TabsTrigger value="activation" className="gap-2">
                <Shield className="h-4 w-4" />
                Activation Ready
              </TabsTrigger>
              <TabsTrigger value="blocked" className="gap-2">
                <AlertTriangle className="h-4 w-4" />
                Blocked
              </TabsTrigger>
            </TabsList>

            <TabsContent value="review">
              <div className="grid gap-8 lg:grid-cols-3">
                {/* Tasks needing review */}
                <div className="lg:col-span-2">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-4">
                      <CardTitle className="text-lg">Tasks Needing Review</CardTitle>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Button 
                            variant={categoryFilter === 'all' ? 'secondary' : 'ghost'} 
                            size="sm"
                            onClick={() => setCategoryFilter('all')}
                          >
                            All
                          </Button>
                          <Button 
                            variant={categoryFilter === 'licensure' ? 'secondary' : 'ghost'} 
                            size="sm"
                            onClick={() => setCategoryFilter('licensure')}
                          >
                            Licensure
                          </Button>
                          <Button 
                            variant={categoryFilter === 'collaborative' ? 'secondary' : 'ghost'} 
                            size="sm"
                            onClick={() => setCategoryFilter('collaborative')}
                          >
                            Collaborative
                          </Button>
                          <Button 
                            variant={categoryFilter === 'compliance' ? 'secondary' : 'ghost'} 
                            size="sm"
                            onClick={() => setCategoryFilter('compliance')}
                          >
                            Compliance
                          </Button>
                        </div>
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
                                    {state?.demandTag && state.demandTag !== 'stable' && (
                                      <DemandTagBadge tag={state.demandTag} size="sm" showLabel={false} />
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground truncate">
                                    {task.title}
                                  </p>
                                </div>
                                
                                <div className="flex items-center gap-3">
                                  <CategoryBadge category={task.category} size="sm" />
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

                {/* Sidebar */}
                <div className="space-y-6">
                  {/* Pending license verifications */}
                  {pendingLicenseVerifications.length > 0 && (
                    <Card className="border-warning/30">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <FileText className="h-4 w-4 text-warning" />
                          License Verifications
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {pendingLicenseVerifications.slice(0, 3).map(license => (
                          <SelfReportedLicenseCard 
                            key={license.id}
                            license={license}
                          />
                        ))}
                        {pendingLicenseVerifications.length > 3 && (
                          <Button variant="ghost" className="w-full" size="sm">
                            View all ({pendingLicenseVerifications.length})
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Quick stats by category */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Tasks by Category</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {Object.entries(tasksByCategory).map(([category, count]) => (
                        <div key={category} className="flex items-center justify-between">
                          <CategoryBadge category={category as TaskCategory} size="sm" />
                          <span className="text-sm font-medium text-foreground">{count}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Task distribution */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Task Status Distribution</CardTitle>
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

                   {/* Active Transfers */}
                   <ActiveTransfersWidget />

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

            <TabsContent value="activation">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="h-5 w-5 text-success" />
                    Providers Ready for Activation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {providersReadyForActivation.length > 0 ? (
                    <div className="space-y-4">
                      {providersReadyForActivation.map(provider => {
                        const readyStates = provider.states.filter(s => s.isReadyForActivation);
                        
                        return (
                          <div 
                            key={provider.id}
                            className="flex items-center gap-4 p-4 rounded-lg border bg-success/5 border-success/20 hover:shadow-md transition-shadow cursor-pointer group"
                          >
                            <Avatar className="h-12 w-12">
                              <AvatarFallback className="bg-success/20 text-success">
                                {getInitials(provider.firstName, provider.lastName)}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground">
                                {provider.firstName} {provider.lastName}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {provider.specialty}
                              </p>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {readyStates.map(ps => (
                                  <Badge key={ps.id} className="bg-success/10 text-success border-0">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    {ps.state.abbreviation}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <Button size="sm">Activate</Button>
                              <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground">
                        No providers are currently ready for activation.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="blocked">
              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    Blocked Providers
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {providersWithBlockers.length > 0 ? (
                    <div className="space-y-4">
                      {providersWithBlockers.map(provider => {
                        const blockedStates = provider.states.filter(s => 
                          s.tasks.some(t => t.status === 'blocked')
                        );
                        const blockedTasks = provider.states.flatMap(s => 
                          s.tasks.filter(t => t.status === 'blocked')
                        );
                        
                        return (
                          <div 
                            key={provider.id}
                            className="flex items-center gap-4 p-4 rounded-lg border bg-destructive/5 border-destructive/20 hover:shadow-md transition-shadow cursor-pointer group"
                          >
                            <Avatar className="h-12 w-12">
                              <AvatarFallback className="bg-destructive/20 text-destructive">
                                {getInitials(provider.firstName, provider.lastName)}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground">
                                {provider.firstName} {provider.lastName}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {blockedTasks.length} blocked task{blockedTasks.length !== 1 ? 's' : ''} in {blockedStates.map(s => s.state.abbreviation).join(', ')}
                              </p>
                              <div className="mt-2">
                                {blockedTasks.slice(0, 2).map(task => (
                                  <p key={task.id} className="text-xs text-muted-foreground truncate">
                                    • {task.title}
                                  </p>
                                ))}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm">Resolve</Button>
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
                        No providers are currently blocked!
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
