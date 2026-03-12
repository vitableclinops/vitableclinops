import { useState, useEffect } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { StatCard } from '@/components/StatCard';
import { ReadinessScreen } from '@/components/ReadinessScreen';
import { ProviderMeetingRSVP } from '@/components/meetings/ProviderMeetingRSVP';
import { ProviderAttestationCard } from '@/components/calendar/ProviderAttestationCard';
import { LicensureApplicationsWidget } from '@/components/licensure/LicensureApplicationsWidget';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { EditLicenseDialog } from '@/components/provider/EditLicenseDialog';
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
  Loader2,
  Edit,
  UserCog
} from 'lucide-react';

const ProviderDashboard = () => {
  const { profile, roles } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [adminTasks, setAdminTasks] = useState<any[]>([]);
  const [podLeadTasks, setPodLeadTasks] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('readiness');
  const [editingLicense, setEditingLicense] = useState<any>(null);

  const isPodLead = roles.includes('pod_lead');

  const fetchDashboardData = async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      // Fetch licenses
      const { data: licenseData } = await supabase
        .from('provider_licenses')
        .select('*')
        .eq('profile_id', profile.id);
      setLicenses(licenseData || []);

      // Fetch tasks assigned TO me (provider tasks)
      const { data: myTaskData } = await supabase
        .from('agreement_tasks')
        .select('*')
        .eq('assigned_to', profile.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      setMyTasks(myTaskData || []);

      // Fetch tasks about me (admin tasks on my behalf)
      const { data: adminTaskData } = await supabase
        .from('agreement_tasks')
        .select('*')
        .eq('provider_id', profile.id)
        .neq('assigned_role', 'provider')
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      setAdminTasks(adminTaskData || []);

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

  useEffect(() => {
    fetchDashboardData();
  }, [profile?.id]);

  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || 'Provider';
  const userEmail = profile?.email || '';
  const firstName = profile?.first_name || userName.split(' ')[0];

  // Calculate stats
  const licensedStatesCount = licenses.filter(l => l.status === 'verified' || l.status === 'active').length;
  const totalStatesCount = licenses.length;
  const incompleteLicenses = licenses.filter(l => !l.license_number || !l.expiration_date);
  const pendingMyTasksCount = myTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  const activeAgreementsCount = agreements.filter(a => a.agreement?.workflow_status === 'active').length;
  const pendingAgreementsCount = agreements.filter(a => 
    a.agreement?.workflow_status !== 'active' && a.agreement?.workflow_status !== 'terminated'
  ).length;

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

  const renderTaskItem = (task: any, showRole?: string) => (
    <div 
      key={task.id} 
      className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg"
    >
      {task.status === 'completed' ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
      ) : task.status === 'blocked' ? (
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
      ) : (
        <Clock className="h-5 w-5 text-amber-500 mt-0.5" />
      )}
      <div className="flex-1">
        <p className="font-medium">{task.title}</p>
        {task.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {task.state_abbreviation && (
            <Badge variant="outline">{task.state_abbreviation}</Badge>
          )}
          {showRole && (
            <Badge variant="secondary" className="text-xs capitalize">{showRole}</Badge>
          )}
        </div>
      </div>
      <Badge variant={
        task.status === 'completed' ? 'default' :
        task.status === 'blocked' ? 'destructive' :
        'secondary'
      }>
        {task.status}
      </Badge>
    </div>
  );

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
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">
                Welcome back, {firstName}
              </h1>
              {isPodLead && (
                <Badge className="bg-primary/10 text-primary border-primary/20 gap-1">
                  <UserCog className="h-3.5 w-3.5" />
                  Pod Lead
                </Badge>
              )}
            </div>
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
              variant={licensedStatesCount === totalStatesCount && totalStatesCount > 0 ? 'success' : 'default'}
            />
            <StatCard
              title="My Tasks"
              value={pendingMyTasksCount}
              subtitle="Awaiting your action"
              icon={ClipboardList}
              variant={pendingMyTasksCount > 0 ? 'warning' : 'success'}
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
            <TabsList className="flex-wrap">
              <TabsTrigger value="readiness" className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Readiness
              </TabsTrigger>
              <TabsTrigger value="my-tasks" className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                My Tasks
                {pendingMyTasksCount > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                    {pendingMyTasksCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="admin-tasks" className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Pending on My Behalf
              </TabsTrigger>
              <TabsTrigger value="licenses" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Licenses
                {incompleteLicenses.length > 0 && (
                  <Badge variant="outline" className="ml-1 text-amber-600 border-amber-300 text-xs">
                    {incompleteLicenses.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="agreements" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Agreements
              </TabsTrigger>
              {isPodLead && (
                <TabsTrigger value="pod" className="flex items-center gap-2">
                  <UserCog className="h-4 w-4" />
                  My Pod
                </TabsTrigger>
              )}
            </TabsList>

            <div className="grid gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <TabsContent value="readiness" className="mt-0">
                  <ReadinessScreen />
                </TabsContent>

                {/* MY TASKS - assigned to me */}
                <TabsContent value="my-tasks" className="mt-0">
                  <Card>
                    <CardHeader>
                      <CardTitle>My Tasks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {myTasks.length === 0 ? (
                        <div className="text-center py-8">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                          <p className="text-muted-foreground">All caught up! No tasks assigned to you.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {myTasks.map((task) => renderTaskItem(task))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ADMIN TASKS - about me but assigned to admin */}
                <TabsContent value="admin-tasks" className="mt-0">
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>Pending on My Behalf</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          These tasks are being handled by Clinical Operations on your behalf.
                        </p>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {adminTasks.length === 0 ? (
                        <div className="text-center py-8">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                          <p className="text-muted-foreground">No pending admin tasks for you.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {adminTasks.map((task) => renderTaskItem(task, 'admin'))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* LICENSES */}
                <TabsContent value="licenses" className="mt-0">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle>Your Licenses</CardTitle>
                      <Button variant="outline" size="sm" onClick={() => navigate('/provider/licenses')}>
                        Manage All
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {licenses.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                          No licenses reported yet.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {/* Show incomplete first */}
                          {[...licenses].sort((a, b) => {
                            const aInc = !a.license_number || !a.expiration_date ? 0 : 1;
                            const bInc = !b.license_number || !b.expiration_date ? 0 : 1;
                            return aInc - bInc;
                          }).map((license) => {
                            const incomplete = !license.license_number || !license.expiration_date;
                            return (
                              <div 
                                key={license.id} 
                                className={`flex items-center justify-between p-4 rounded-lg ${
                                  incomplete ? 'border border-amber-200 bg-amber-50/30' : 'bg-muted/50'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  {incomplete ? (
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                  ) : (
                                    <MapPin className="h-5 w-5 text-muted-foreground" />
                                  )}
                                  <div>
                                    <p className="font-medium">{license.state_abbreviation}</p>
                                    <p className="text-sm text-muted-foreground">
                                      {license.license_type || 'APRN'} • {license.license_number || (
                                        <span className="text-amber-600">Missing #</span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={
                                    license.status === 'verified' || license.status === 'active' 
                                      ? 'default' 
                                      : 'secondary'
                                  }>
                                    {license.status || 'Reported'}
                                  </Badge>
                                  <Button variant="ghost" size="icon" onClick={() => setEditingLicense(license)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* AGREEMENTS */}
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
                                    {item.agreement?.physician_name || 'Physician pending assignment'}
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

                {/* POD LEAD TAB */}
                {isPodLead && (
                  <TabsContent value="pod" className="mt-0">
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <UserCog className="h-5 w-5" />
                            My Pod
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            Quick view of your pod. Visit the full page for details.
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => navigate('/provider/pod')}>
                          View Full Pod
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </CardHeader>
                      <CardContent>
                        <p className="text-muted-foreground text-center py-4">
                          Visit the full Pod page to manage your pod members.
                        </p>
                        <div className="flex justify-center">
                          <Button onClick={() => navigate('/provider/pod')}>
                            <Users className="h-4 w-4 mr-2" />
                            Go to My Pod
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {profile?.id && <LicensureApplicationsWidget providerId={profile.id} />}
                <ProviderAttestationCard />
                <ProviderMeetingRSVP />

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Quick Links</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="ghost" className="w-full justify-start" onClick={() => navigate('/provider/licenses')}>
                      <MapPin className="h-4 w-4 mr-2" />
                      My Licenses
                      <ChevronRight className="h-4 w-4 ml-auto" />
                    </Button>
                    {isPodLead && (
                      <Button variant="ghost" className="w-full justify-start" onClick={() => navigate('/provider/pod')}>
                        <UserCog className="h-4 w-4 mr-2" />
                        My Pod
                        <ChevronRight className="h-4 w-4 ml-auto" />
                      </Button>
                    )}
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

          {editingLicense && (
            <EditLicenseDialog
              open={!!editingLicense}
              onOpenChange={(open) => !open && setEditingLicense(null)}
              license={editingLicense}
              onSaved={fetchDashboardData}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default ProviderDashboard;