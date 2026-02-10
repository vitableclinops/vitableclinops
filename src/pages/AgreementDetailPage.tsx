import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { RelatedLinksCard } from '@/components/navigation/RelatedLinksCard';
import { WorkflowStatusTracker } from '@/components/agreements/WorkflowStatusTracker';
import { TerminationDialog } from '@/components/agreements/TerminationDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { useAgreementTasks, AgreementTask } from '@/hooks/useAgreementTasks';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  MapPin,
  Users,
  FileText,
  Calendar,
  ChevronRight,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Edit,
  ArrowLeft,
  Plus,
  User,
  Stethoscope,
  ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type DbAgreement = Tables<'collaborative_agreements'>;
type DbProvider = Tables<'agreement_providers'>;
type DbMeeting = Tables<'supervision_meetings'>;

export default function AgreementDetailPage() {
  const { agreementId } = useParams<{ agreementId: string }>();
  const { profile, roles, hasRole } = useAuth();
  const { toast } = useToast();
  const { tasks, loading: tasksLoading, generateAgreementTasks } = useAgreementTasks({ agreementId });

  const [agreement, setAgreement] = useState<DbAgreement | null>(null);
  const [providers, setProviders] = useState<DbProvider[]>([]);
  const [meetings, setMeetings] = useState<DbMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminationOpen, setTerminationOpen] = useState(false);

  const userRole = roles.includes('admin') ? 'admin' : 
                   roles.includes('physician') ? 'physician' : 'provider';

  useEffect(() => {
    if (!agreementId) return;

    const fetchData = async () => {
      setLoading(true);

      const [agreementRes, providersRes, meetingsRes] = await Promise.all([
        supabase
          .from('collaborative_agreements')
          .select('*')
          .eq('id', agreementId)
          .maybeSingle(),
        supabase
          .from('agreement_providers')
          .select('*')
          .eq('agreement_id', agreementId),
        supabase
          .from('supervision_meetings')
          .select('*')
          .eq('agreement_id', agreementId)
          .order('scheduled_date', { ascending: true }),
      ]);

      if (agreementRes.data) setAgreement(agreementRes.data);
      if (providersRes.data) setProviders(providersRes.data);
      if (meetingsRes.data) setMeetings(meetingsRes.data);

      setLoading(false);
    };

    fetchData();
  }, [agreementId]);

  const handleGenerateTasks = async () => {
    if (!agreement) return;

    try {
      await generateAgreementTasks(
        agreement.id,
        agreement.state_abbreviation,
        agreement.state_name,
        providers[0]?.provider_id || null,
        agreement.physician_id
      );
      toast({
        title: 'Tasks generated',
        description: 'Agreement lifecycle tasks have been created.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate tasks.',
        variant: 'destructive',
      });
    }
  };

  const activeProviders = providers.filter(p => p.is_active);
  const terminatedProviders = providers.filter(p => !p.is_active);
  const upcomingMeetings = meetings.filter(m => m.status === 'scheduled' && new Date(m.scheduled_date) >= new Date());
  const pastMeetings = meetings.filter(m => m.status === 'completed' || new Date(m.scheduled_date) < new Date());

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-success/10 text-success border-success/20">Active</Badge>;
      case 'draft':
        return <Badge variant="secondary">Draft</Badge>;
      case 'terminated':
        return <Badge variant="destructive">Terminated</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTaskStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-primary" />;
      case 'blocked':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  if (!agreementId) {
    return <div>Agreement not found</div>;
  }

  const breadcrumbs = [
    { label: 'Agreements', href: '/admin/agreements' },
    { label: agreement?.state_name || 'Agreement' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />
      
      <main className="ml-16 lg:ml-64 transition-all duration-300">
        <div className="p-4 md:p-6 lg:p-8">
          {/* Breadcrumbs */}
          <Breadcrumbs items={breadcrumbs} className="mb-4" />

          {/* Back button */}
          <Link to="/admin/agreements" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to Agreements
          </Link>

          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-8 w-64 bg-muted rounded" />
              <div className="h-32 bg-muted rounded" />
            </div>
          ) : agreement ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">
                    {agreement.state_abbreviation}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-3xl font-bold text-foreground">
                        {agreement.state_name} Agreement
                      </h1>
                      {getStatusBadge(agreement.workflow_status)}
                    </div>
                    <p className="text-muted-foreground mt-1">
                      Dr. {agreement.physician_name} • {activeProviders.length} active provider{activeProviders.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {hasRole('admin') && agreement.workflow_status === 'active' && (
                    <Button 
                      variant="outline" 
                      className="text-destructive hover:text-destructive"
                      onClick={() => setTerminationOpen(true)}
                    >
                      Terminate Agreement
                    </Button>
                  )}
                  {hasRole('admin') && (
                    <Button variant="outline">
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>

              {/* Workflow Status - commented out pending prop fix */}
              {/* <WorkflowStatusTracker agreementId={agreement.id} /> */}

              <div className="grid gap-6 lg:grid-cols-3 mt-8">
                {/* Main content */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Agreement Details */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Agreement Details</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">State</p>
                          <Link 
                            to={`/states/${agreement.state_abbreviation}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {agreement.state_name}
                          </Link>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Physician</p>
                          <Link 
                            to={`/physicians/${encodeURIComponent(agreement.physician_email)}`}
                            className="font-medium text-primary hover:underline"
                          >
                            Dr. {agreement.physician_name}
                          </Link>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Meeting Cadence</p>
                          <p className="font-medium capitalize">{agreement.meeting_cadence || 'Not set'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Start Date</p>
                          <p className="font-medium">
                            {agreement.start_date ? format(new Date(agreement.start_date), 'MMM d, yyyy') : 'Not set'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Renewal Date</p>
                          <p className="font-medium">
                            {agreement.next_renewal_date ? format(new Date(agreement.next_renewal_date), 'MMM d, yyyy') : 'Not set'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Chart Review</p>
                          <p className="font-medium">
                            {agreement.chart_review_required ? (agreement.chart_review_frequency || 'Required') : 'Not required'}
                          </p>
                        </div>
                      </div>

                      {agreement.agreement_document_url && (
                        <>
                          <Separator className="my-4" />
                          <Button variant="outline" asChild>
                            <a href={agreement.agreement_document_url} target="_blank" rel="noopener noreferrer">
                              <FileText className="h-4 w-4 mr-2" />
                              View Agreement Document
                              <ExternalLink className="h-3 w-3 ml-2" />
                            </a>
                          </Button>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Tabs defaultValue="providers">
                    <TabsList>
                      <TabsTrigger value="providers">Providers ({activeProviders.length})</TabsTrigger>
                      <TabsTrigger value="tasks">Tasks ({tasks.length})</TabsTrigger>
                      <TabsTrigger value="meetings">Meetings ({meetings.length})</TabsTrigger>
                      <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>

                    <TabsContent value="providers" className="mt-4">
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle>Active Providers</CardTitle>
                          {hasRole('admin') && (
                            <Button size="sm">
                              <Plus className="h-4 w-4 mr-1" />
                              Add Provider
                            </Button>
                          )}
                        </CardHeader>
                        <CardContent>
                          {activeProviders.length > 0 ? (
                            <div className="space-y-3">
                              {activeProviders.map(provider => (
                                <Link
                                  key={provider.id}
                                  to={`/directory?search=${encodeURIComponent(provider.provider_email)}`}
                                  className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors group"
                                >
                                  <Avatar className="h-10 w-10">
                                    <AvatarFallback className="bg-primary/10 text-primary">
                                      {provider.provider_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1">
                                    <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                                      {provider.provider_name}
                                    </p>
                                    <p className="text-sm text-muted-foreground">{provider.provider_email}</p>
                                  </div>
                                  {provider.start_date && (
                                    <span className="text-xs text-muted-foreground">
                                      Since {format(new Date(provider.start_date), 'MMM yyyy')}
                                    </span>
                                  )}
                                  <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-center py-8">No active providers</p>
                          )}

                          {terminatedProviders.length > 0 && (
                            <>
                              <Separator className="my-4" />
                              <p className="text-sm text-muted-foreground mb-2">Terminated Providers</p>
                              <div className="space-y-2">
                                {terminatedProviders.map(provider => (
                                  <div key={provider.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                    <span className="text-sm text-muted-foreground">{provider.provider_name}</span>
                                    <Badge variant="destructive" className="text-xs">Removed</Badge>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="tasks" className="mt-4">
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle>Agreement Tasks</CardTitle>
                          {hasRole('admin') && tasks.length === 0 && (
                            <Button size="sm" onClick={handleGenerateTasks}>
                              <Plus className="h-4 w-4 mr-1" />
                              Generate Tasks
                            </Button>
                          )}
                        </CardHeader>
                        <CardContent>
                          {tasks.length > 0 ? (
                            <div className="space-y-3">
                              {tasks.map((task: AgreementTask) => (
                                <div
                                  key={task.id}
                                  className="flex items-center gap-4 p-4 rounded-lg border"
                                >
                                  {getTaskStatusIcon(task.status)}
                                  <div className="flex-1">
                                    <p className="font-medium text-foreground">{task.title}</p>
                                    {task.description && (
                                      <p className="text-sm text-muted-foreground">{task.description}</p>
                                    )}
                                  </div>
                                  <Badge variant="outline" className="capitalize">{task.category.replace('_', ' ')}</Badge>
                                  <Badge 
                                    variant={task.status === 'completed' ? 'default' : 'secondary'}
                                    className={task.status === 'completed' ? 'bg-success/10 text-success' : ''}
                                  >
                                    {task.status}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-8">
                              <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                              <p className="text-muted-foreground">No tasks yet</p>
                              {hasRole('admin') && (
                                <Button className="mt-4" onClick={handleGenerateTasks}>
                                  Generate Lifecycle Tasks
                                </Button>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="meetings" className="mt-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Supervision Meetings</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {upcomingMeetings.length > 0 && (
                            <div className="mb-6">
                              <p className="text-sm font-medium mb-2">Upcoming</p>
                              <div className="space-y-2">
                                {upcomingMeetings.map(meeting => (
                                  <div key={meeting.id} className="flex items-center gap-3 p-3 rounded-lg border bg-primary/5">
                                    <Calendar className="h-4 w-4 text-primary" />
                                    <span className="font-medium">
                                      {format(new Date(meeting.scheduled_date), 'EEEE, MMMM d, yyyy')}
                                    </span>
                                    <Badge variant="outline">{meeting.time_slot?.toUpperCase()}</Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {pastMeetings.length > 0 && (
                            <div>
                              <p className="text-sm font-medium mb-2 text-muted-foreground">Past Meetings</p>
                              <div className="space-y-2">
                                {pastMeetings.slice(0, 5).map(meeting => (
                                  <div key={meeting.id} className="flex items-center gap-3 p-3 rounded-lg border">
                                    <CheckCircle2 className="h-4 w-4 text-success" />
                                    <span className="text-muted-foreground">
                                      {format(new Date(meeting.scheduled_date), 'MMM d, yyyy')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {meetings.length === 0 && (
                            <p className="text-muted-foreground text-center py-8">No meetings scheduled</p>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="history" className="mt-4">
                      <Card>
                        <CardHeader>
                          <CardTitle>Audit History</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-muted-foreground text-center py-8">
                            Audit history will be displayed here
                          </p>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  <RelatedLinksCard
                    title="Related"
                    links={[
                      {
                        label: agreement.state_name,
                        href: `/states/${agreement.state_abbreviation}`,
                        icon: MapPin,
                        description: 'View state compliance details',
                      },
                      {
                        label: `Dr. ${agreement.physician_name}`,
                        href: `/physicians/${encodeURIComponent(agreement.physician_email)}`,
                        icon: Stethoscope,
                        description: 'Physician profile',
                      },
                      ...activeProviders.slice(0, 3).map(p => ({
                        label: p.provider_name,
                        href: `/directory?search=${encodeURIComponent(p.provider_email)}`,
                        icon: User,
                      })),
                    ]}
                  />

                  {agreement.medallion_document_url && (
                    <RelatedLinksCard
                      title="Documents"
                      links={[
                        {
                          label: 'Agreement Document',
                          href: agreement.medallion_document_url,
                          icon: FileText,
                          external: true,
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Agreement not found</p>
                <Button asChild className="mt-4">
                  <Link to="/admin/agreements">Back to Agreements</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {agreement && (
        <TerminationDialog
          open={terminationOpen}
          onOpenChange={setTerminationOpen}
          agreement={agreement}
          providers={providers.filter(p => p.is_active)}
          onSuccess={() => {
            setTerminationOpen(false);
            // Refetch data
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
