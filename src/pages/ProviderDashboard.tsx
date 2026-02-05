import { useState, useEffect } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { ReadinessScreen } from '@/components/ReadinessScreen';
import { ProviderMeetingRSVP } from '@/components/meetings/ProviderMeetingRSVP';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { 
  MapPin, 
  ClipboardList, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  ChevronRight,
  Users,
  ShieldCheck,
  FileText,
  Loader2
} from 'lucide-react';

const ProviderDashboard = () => {
  const { profile, roles } = useAuth();
  const [loading, setLoading] = useState(true);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('readiness');

  useEffect(() => {
    if (!profile?.id) return;

    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        // Fetch licenses
        const { data: licenseData } = await supabase
          .from('provider_licenses')
          .select('*')
          .eq('profile_id', profile.id);
        setLicenses(licenseData || []);

        // Fetch tasks
        const { data: taskData } = await supabase
          .from('agreement_tasks')
          .select('*')
          .eq('provider_id', profile.id)
          .order('created_at', { ascending: false });
        setTasks(taskData || []);

        // Fetch agreements via agreement_providers
        const { data: agreementData } = await supabase
          .from('agreement_providers')
          .select(`
            *,
            agreement:agreement_id (
              id,
              state_name,
              state_abbreviation,
              workflow_status,
              physician_name,
              start_date
            )
          `)
          .eq('provider_id', profile.id);
        setAgreements(agreementData || []);

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [profile?.id]);

  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || 'Provider';
  const userEmail = profile?.email || '';
  const firstName = profile?.first_name || userName.split(' ')[0];

  // Calculate stats
  const licensedStatesCount = licenses.filter(l => l.status === 'verified' || l.status === 'active').length;
  const totalStatesCount = licenses.length;
  const pendingTasksCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  const blockedTasksCount = tasks.filter(t => t.status === 'blocked').length;
  const activeAgreementsCount = agreements.filter(a => a.agreement?.workflow_status === 'active').length;
  const pendingAgreementsCount = agreements.filter(a => 
    a.agreement?.workflow_status !== 'active' && a.agreement?.workflow_status !== 'terminated'
  ).length;

  // Determine if provider has completed basic setup
  const hasCompletedOnboarding = profile?.onboarding_completed === true;
  const showReadinessFirst = !hasCompletedOnboarding || pendingAgreementsCount > 0 || licensedStatesCount < totalStatesCount;

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppSidebar 
          userRole={userRole as any}
          userName={userName}
          userEmail={userEmail}
          userAvatarUrl={profile?.avatar_url || undefined}
        />
        <main className="pl-64 transition-all duration-300">
          <div className="flex items-center justify-center min-h-screen">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </main>
      </div>
    );
  }

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
              Welcome back, {firstName}
            </h1>
            <p className="text-muted-foreground mt-1">
              {showReadinessFirst 
                ? 'Complete your activation requirements to start practicing.'
                : 'Here\'s your licensure overview and what needs your attention.'}
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <StatCard
              title="Licensed States"
              value={licensedStatesCount}
              subtitle={`of ${totalStatesCount} selected`}
              icon={MapPin}
              variant={licensedStatesCount === totalStatesCount ? 'success' : 'default'}
            />
            <StatCard
              title="Pending Tasks"
              value={pendingTasksCount}
              subtitle="Awaiting action"
              icon={ClipboardList}
              variant="default"
            />
            <StatCard
              title="Active Agreements"
              value={activeAgreementsCount}
              subtitle={pendingAgreementsCount > 0 ? `${pendingAgreementsCount} pending` : 'All set'}
              icon={Users}
              variant={pendingAgreementsCount > 0 ? 'warning' : 'success'}
            />
            <StatCard
              title="Status"
              value={profile?.activation_status === 'active' ? 'Active' : 'Pending'}
              subtitle={profile?.activation_status?.replace(/_/g, ' ') || 'Setting up'}
              icon={ShieldCheck}
              variant={profile?.activation_status === 'active' ? 'success' : 'warning'}
            />
          </div>

          {/* Main Content Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList>
              <TabsTrigger value="readiness" className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Readiness
              </TabsTrigger>
              <TabsTrigger value="licenses" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Licenses
              </TabsTrigger>
              <TabsTrigger value="agreements" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Agreements
              </TabsTrigger>
              <TabsTrigger value="tasks" className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Tasks
              </TabsTrigger>
            </TabsList>

            <div className="grid gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <TabsContent value="readiness" className="mt-0">
                  <ReadinessScreen />
                </TabsContent>

                <TabsContent value="licenses" className="mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle>Your Licenses</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {licenses.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                          No licenses reported yet.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {licenses.map((license) => (
                            <div 
                              key={license.id} 
                              className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <MapPin className="h-5 w-5 text-muted-foreground" />
                                <div>
                                  <p className="font-medium">{license.state_abbreviation}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {license.license_type || 'APRN'} • {license.license_number || 'No number'}
                                  </p>
                                </div>
                              </div>
                              <Badge variant={
                                license.status === 'verified' || license.status === 'active' 
                                  ? 'default' 
                                  : 'secondary'
                              }>
                                {license.status || 'Reported'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="agreements" className="mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle>Collaborative Agreements</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {agreements.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                          No collaborative agreements yet.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {agreements.map((item) => (
                            <div 
                              key={item.id} 
                              className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <Users className="h-5 w-5 text-muted-foreground" />
                                <div>
                                  <p className="font-medium">{item.agreement?.state_name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {item.agreement?.physician_name}
                                  </p>
                                </div>
                              </div>
                              <Badge variant={
                                item.agreement?.workflow_status === 'active' 
                                  ? 'default' 
                                  : item.agreement?.workflow_status === 'draft'
                                    ? 'secondary'
                                    : 'outline'
                              }>
                                {item.agreement?.workflow_status || 'Draft'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="tasks" className="mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle>Your Tasks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {tasks.length === 0 ? (
                        <div className="text-center py-8">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-success mb-2" />
                          <p className="text-muted-foreground">All caught up!</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {tasks.slice(0, 10).map((task) => (
                            <div 
                              key={task.id} 
                              className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg"
                            >
                              {task.status === 'completed' ? (
                                <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
                              ) : task.status === 'blocked' ? (
                                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
                              ) : (
                                <Clock className="h-5 w-5 text-warning mt-0.5" />
                              )}
                              <div className="flex-1">
                                <p className="font-medium">{task.title}</p>
                                {task.description && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {task.description}
                                  </p>
                                )}
                                {task.state_name && (
                                  <Badge variant="outline" className="mt-2">
                                    {task.state_name}
                                  </Badge>
                                )}
                              </div>
                              <Badge variant={
                                task.status === 'completed' ? 'default' :
                                task.status === 'blocked' ? 'destructive' :
                                'secondary'
                              }>
                                {task.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                <ProviderMeetingRSVP />

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Quick Links</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="ghost" className="w-full justify-start" asChild>
                      <a href="/profile/settings">
                        <FileText className="h-4 w-4 mr-2" />
                        Profile Settings
                        <ChevronRight className="h-4 w-4 ml-auto" />
                      </a>
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" asChild>
                      <a href="/knowledge">
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        Knowledge Base
                        <ChevronRight className="h-4 w-4 ml-auto" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default ProviderDashboard;
