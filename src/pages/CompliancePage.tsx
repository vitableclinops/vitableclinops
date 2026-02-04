import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { CategoryBadge } from '@/components/CategoryBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  providers, 
  getAllTasks 
} from '@/data/mockData';
import { 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  Search,
  Plus,
  ChevronRight,
  ExternalLink,
  Users,
  FileText
} from 'lucide-react';
import type { Task, Provider } from '@/types';
import { cn } from '@/lib/utils';

const CompliancePage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  // Get all compliance tasks
  const allTasks = getAllTasks();
  const complianceTasks = allTasks.filter(t => t.category === 'compliance');
  
  // Calculate stats
  const completedTasks = complianceTasks.filter(t => t.status === 'approved').length;
  const overdueTasks = complianceTasks.filter(t => 
    t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'approved'
  );
  const pendingTasks = complianceTasks.filter(t => 
    ['not_started', 'in_progress', 'submitted'].includes(t.status)
  );
  
  // Provider compliance stats
  const compliantProviders = providers.filter(p => p.complianceStatus?.isCompliant);
  const nonCompliantProviders = providers.filter(p => !p.complianceStatus?.isCompliant);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
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
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Compliance Management
              </h1>
              <p className="text-muted-foreground mt-1">
                Track training, attestations, and policy acknowledgments across all providers.
              </p>
            </div>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Assign Task
            </Button>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-4 mb-8">
            <StatCard
              title="Compliant Providers"
              value={compliantProviders.length}
              subtitle={`of ${providers.length} total`}
              icon={CheckCircle2}
              variant="success"
            />
            <StatCard
              title="Non-Compliant"
              value={nonCompliantProviders.length}
              subtitle="Requires attention"
              icon={AlertTriangle}
              variant={nonCompliantProviders.length > 0 ? 'danger' : 'default'}
            />
            <StatCard
              title="Overdue Tasks"
              value={overdueTasks.length}
              subtitle="Past due date"
              icon={Clock}
              variant={overdueTasks.length > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Pending Review"
              value={pendingTasks.filter(t => t.status === 'submitted').length}
              subtitle="Awaiting verification"
              icon={FileText}
              variant="default"
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="overview" className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="tasks" className="gap-2">
                <FileText className="h-4 w-4" />
                Tasks
              </TabsTrigger>
              <TabsTrigger value="providers" className="gap-2">
                <Users className="h-4 w-4" />
                By Provider
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <div className="grid gap-8 lg:grid-cols-3">
                {/* Overdue section */}
                <div className="lg:col-span-2">
                  <Card className="border-destructive/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        Overdue Tasks
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {overdueTasks.length > 0 ? (
                        <div className="space-y-3">
                          {overdueTasks.map(task => {
                            const provider = providers.find(p => p.id === task.providerId);
                            const daysPastDue = task.dueDate 
                              ? Math.ceil((new Date().getTime() - new Date(task.dueDate).getTime()) / (1000 * 60 * 60 * 24))
                              : 0;
                            
                            return (
                              <div 
                                key={task.id}
                                className="flex items-center gap-4 p-4 rounded-lg border bg-destructive/5 border-destructive/20 hover:shadow-md transition-shadow cursor-pointer group"
                              >
                                <Avatar className="h-10 w-10">
                                  <AvatarFallback className="bg-destructive/10 text-destructive text-sm">
                                    {provider ? getInitials(provider.firstName, provider.lastName) : '??'}
                                  </AvatarFallback>
                                </Avatar>
                                
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-foreground">
                                      {provider?.firstName} {provider?.lastName}
                                    </span>
                                  </div>
                                  <p className="text-sm text-muted-foreground truncate">
                                    {task.title}
                                  </p>
                                </div>
                                
                                <div className="flex items-center gap-3">
                                  <Badge variant="destructive" className="text-xs">
                                    {daysPastDue} days overdue
                                  </Badge>
                                  {task.externalContentUrl && (
                                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                  )}
                                  <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="py-8 text-center">
                          <CheckCircle2 className="h-12 w-12 mx-auto text-success mb-3" />
                          <p className="text-muted-foreground">No overdue tasks!</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Non-compliant providers */}
                <div>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Non-Compliant Providers</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {nonCompliantProviders.length > 0 ? (
                        nonCompliantProviders.map(provider => (
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
                                {provider.complianceStatus?.overdueTasks} overdue
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          All providers are compliant
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="tasks">
              {/* Search */}
              <div className="relative max-w-md mb-6">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search compliance tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="space-y-3">
                {complianceTasks.map(task => {
                  const provider = providers.find(p => p.id === task.providerId);
                  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'approved';
                  
                  return (
                    <div 
                      key={task.id}
                      className={cn(
                        'flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer group',
                        isOverdue && 'border-destructive/20 bg-destructive/5'
                      )}
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/10 text-primary text-sm">
                          {provider ? getInitials(provider.firstName, provider.lastName) : '??'}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-foreground">
                            {task.title}
                          </span>
                          {task.complianceTaskType && (
                            <Badge variant="secondary" className="text-xs capitalize">
                              {task.complianceTaskType.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {provider?.firstName} {provider?.lastName}
                          {task.dueDate && (
                            <span className={cn(isOverdue && 'text-destructive')}>
                              {' '}• Due {new Date(task.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <StatusBadge status={task.status} size="sm" />
                        <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="providers">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {providers.map(provider => {
                  const status = provider.complianceStatus;
                  const completionPct = status 
                    ? Math.round((status.completedTasks / status.totalTasks) * 100)
                    : 0;
                  
                  return (
                    <Card 
                      key={provider.id} 
                      className={cn(
                        'card-interactive cursor-pointer',
                        status?.isCompliant && 'border-success/30',
                        !status?.isCompliant && status?.overdueTasks && status.overdueTasks > 0 && 'border-destructive/30'
                      )}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3 mb-4">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className={cn(
                              'text-sm',
                              status?.isCompliant ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                            )}>
                              {getInitials(provider.firstName, provider.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground">
                              {provider.firstName} {provider.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {provider.specialty}
                            </p>
                          </div>
                          {status?.isCompliant ? (
                            <CheckCircle2 className="h-5 w-5 text-success" />
                          ) : (
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                          )}
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Completion</span>
                            <span className="font-medium">{status?.completedTasks} / {status?.totalTasks}</span>
                          </div>
                          <Progress 
                            value={completionPct} 
                            className={cn('h-2', status?.isCompliant && '[&>div]:bg-success')}
                          />
                          {status?.overdueTasks && status.overdueTasks > 0 && (
                            <p className="text-xs text-destructive">
                              {status.overdueTasks} overdue task{status.overdueTasks !== 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default CompliancePage;
