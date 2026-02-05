import { useState, useEffect } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { CollaborativeAgreementCard } from '@/components/CollaborativeAgreementCard';
import { SupervisionCalendar } from '@/components/SupervisionCalendar';
import { StatCard } from '@/components/StatCard';
import { AgreementWizard } from '@/components/agreements/AgreementWizard';
import { TerminationDialog } from '@/components/agreements/TerminationDialog';
import { NotificationQueue } from '@/components/agreements/NotificationQueue';
import { WorkflowStatusTracker } from '@/components/agreements/WorkflowStatusTracker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { 
  collaborativeAgreements, 
  supervisionMeetings, 
  collaboratingPhysicians,
  providers,
  states
} from '@/data/mockData';
import { 
  Users, 
  FileText, 
  Calendar, 
  AlertTriangle,
  Search,
  Plus,
  Clock,
  CheckCircle2,
  Mail,
  Filter,
  ExternalLink
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Tables } from '@/integrations/supabase/types';

type DbAgreement = Tables<'collaborative_agreements'>;
type DbProvider = Tables<'agreement_providers'>;

const CollaborativeAgreementsPage = () => {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [physicianFilter, setPhysicianFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('agreements');
  const [wizardOpen, setWizardOpen] = useState(false);
  
  // Termination dialog state
  const [terminationOpen, setTerminationOpen] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<DbAgreement | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<DbProvider[]>([]);

  // Database agreements and providers
  const [dbAgreements, setDbAgreements] = useState<DbAgreement[]>([]);
  const [dbProviders, setDbProviders] = useState<DbProvider[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDbAgreements = async () => {
    const [agreementsRes, providersRes] = await Promise.all([
      supabase
        .from('collaborative_agreements')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('agreement_providers')
        .select('*')
        .eq('is_active', true)
    ]);

    if (agreementsRes.error) {
      console.error('Error fetching agreements:', agreementsRes.error);
    } else {
      setDbAgreements(agreementsRes.data || []);
    }
    
    if (!providersRes.error) {
      setDbProviders(providersRes.data || []);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    fetchDbAgreements();
  }, []);

  // Extract unique values for filters
  const uniqueStates = [...new Set(dbAgreements.map(a => a.state_abbreviation))].sort();
  const uniquePhysicians = [...new Set(dbAgreements.map(a => a.physician_name))].sort();

  // Filter agreements
  const filteredAgreements = dbAgreements.filter(agreement => {
    // Search filter
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      agreement.state_name.toLowerCase().includes(searchLower) ||
      agreement.state_abbreviation.toLowerCase().includes(searchLower) ||
      agreement.physician_name.toLowerCase().includes(searchLower) ||
      dbProviders.filter(p => p.agreement_id === agreement.id)
        .some(p => p.provider_name.toLowerCase().includes(searchLower));
    
    // Status filter
    const matchesStatus = statusFilter === 'all' || agreement.workflow_status === statusFilter;
    
    // State filter
    const matchesState = stateFilter === 'all' || agreement.state_abbreviation === stateFilter;
    
    // Physician filter
    const matchesPhysician = physicianFilter === 'all' || agreement.physician_name === physicianFilter;
    
    return matchesSearch && matchesStatus && matchesState && matchesPhysician;
  });

  const handleTerminateClick = async (agreement: DbAgreement) => {
    // Fetch providers for this agreement
    const { data: providers } = await supabase
      .from('agreement_providers')
      .select('*')
      .eq('agreement_id', agreement.id)
      .eq('is_active', true);

    setSelectedAgreement(agreement);
    setSelectedProviders(providers || []);
    setTerminationOpen(true);
  };

  const handleTerminationSuccess = () => {
    fetchDbAgreements();
    toast({
      title: 'Agreement terminated',
      description: 'The agreement has been successfully terminated.',
    });
  };

  // Mock data stats
  const activeAgreements = collaborativeAgreements.filter(a => a.status === 'active');
  const pendingRenewal = collaborativeAgreements.filter(a => a.status === 'pending_renewal');
  const upcomingMeetings = supervisionMeetings.filter(m => 
    m.status === 'scheduled' && new Date(m.scheduledDate) >= new Date()
  );
  const missedMeetings = supervisionMeetings.filter(m => m.status === 'missed');

  // Database stats
  const dbActiveCount = dbAgreements.filter(a => a.workflow_status === 'active').length;
  const dbPendingCount = dbAgreements.filter(a => 
    ['draft', 'pending_signatures', 'awaiting_physician_signature', 'awaiting_provider_signatures'].includes(a.workflow_status)
  ).length;

  const { profile, roles } = useAuth();
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';

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
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Collaborative Agreements
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage physician collaborations, supervision schedules, and renewals.
              </p>
            </div>
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Agreement
            </Button>
          </div>

          {/* Agreement Wizard */}
          <AgreementWizard 
            open={wizardOpen} 
            onOpenChange={setWizardOpen}
            onSuccess={() => {
              fetchDbAgreements();
            }}
          />

          {/* Termination Dialog */}
          {selectedAgreement && (
            <TerminationDialog
              open={terminationOpen}
              onOpenChange={setTerminationOpen}
              agreement={selectedAgreement}
              providers={selectedProviders}
              onSuccess={handleTerminationSuccess}
            />
          )}

          {/* Stats Grid */}
          <div className="grid gap-4 md:grid-cols-4 mb-8">
            <StatCard
              title="Active Agreements"
              value={activeAgreements.length + dbActiveCount}
              subtitle={`${collaboratingPhysicians.length} physicians`}
              icon={FileText}
              variant="success"
            />
            <StatCard
              title="In Progress"
              value={dbPendingCount}
              subtitle="Awaiting signatures"
              icon={Clock}
              variant={dbPendingCount > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Upcoming Meetings"
              value={upcomingMeetings.length}
              subtitle="Next 30 days"
              icon={Calendar}
              variant="default"
            />
            <StatCard
              title="Missed Meetings"
              value={missedMeetings.length}
              subtitle="Needs rescheduling"
              icon={Clock}
              variant={missedMeetings.length > 0 ? 'danger' : 'default'}
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="agreements" className="gap-2">
                <FileText className="h-4 w-4" />
                Agreements
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-2">
                <Calendar className="h-4 w-4" />
                Supervision Calendar
              </TabsTrigger>
              <TabsTrigger value="physicians" className="gap-2">
                <Users className="h-4 w-4" />
                Physicians
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-2">
                <Mail className="h-4 w-4" />
                Notifications
              </TabsTrigger>
            </TabsList>

            <TabsContent value="agreements">
              {/* Search and Filters */}
              <div className="flex flex-wrap gap-4 mb-6">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by provider, physician, or state..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="pending_signatures">Pending</SelectItem>
                    <SelectItem value="terminated">Terminated</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={stateFilter} onValueChange={setStateFilter}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="State" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States</SelectItem>
                    {uniqueStates.map(state => (
                      <SelectItem key={state} value={state}>{state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={physicianFilter} onValueChange={setPhysicianFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Physician" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Physicians</SelectItem>
                    {uniquePhysicians.map(physician => (
                      <SelectItem key={physician} value={physician}>Dr. {physician}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {(searchQuery || statusFilter !== 'all' || stateFilter !== 'all' || physicianFilter !== 'all') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setStateFilter('all');
                      setPhysicianFilter('all');
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>

              {/* Results count */}
              {dbAgreements.length > 0 && (
                <p className="text-sm text-muted-foreground mb-4">
                  Showing {filteredAgreements.length} of {dbAgreements.length} agreements
                </p>
              )}

              {/* Database Agreements (In Progress) */}
              {filteredAgreements.filter(a => !['active', 'terminated'].includes(a.workflow_status)).length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-primary" />
                    In Progress
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredAgreements
                      .filter(a => !['active', 'terminated'].includes(a.workflow_status))
                      .map(agreement => {
                        const agreementProviders = dbProviders.filter(p => p.agreement_id === agreement.id);
                        return (
                        <Card key={agreement.id} className="card-interactive">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                  <span className="text-sm font-bold text-primary">
                                    {agreement.state_abbreviation}
                                  </span>
                                </div>
                                <div>
                                  <CardTitle className="text-base">
                                    {agreement.state_name} Agreement
                                  </CardTitle>
                                  <p className="text-sm text-muted-foreground">
                                    Dr. {agreement.physician_name}
                                  </p>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleTerminateClick(agreement)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <WorkflowStatusTracker
                              status={agreement.workflow_status}
                              physicianName={agreement.physician_name}
                              physicianSigned={!!agreement.physician_signed_at}
                              compact
                            />
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Agreements needing renewal */}
              {pendingRenewal.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-warning" />
                    Pending Renewal
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {pendingRenewal.map(agreement => (
                      <CollaborativeAgreementCard 
                        key={agreement.id} 
                        agreement={agreement}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Active agreements */}
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  Active Agreements
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {activeAgreements.map(agreement => (
                    <CollaborativeAgreementCard 
                      key={agreement.id} 
                      agreement={agreement}
                    />
                  ))}
                  {/* Show active DB agreements */}
                  {filteredAgreements
                    .filter(a => a.workflow_status === 'active')
                    .map(agreement => {
                      const agreementProviders = dbProviders.filter(p => p.agreement_id === agreement.id);
                      return (
                        <Card key={agreement.id} className="card-interactive">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                                  <span className="text-sm font-bold text-success">
                                    {agreement.state_abbreviation}
                                  </span>
                                </div>
                                <div>
                                  <CardTitle className="text-base">
                                    {agreement.state_name} Agreement
                                  </CardTitle>
                                  <p className="text-sm text-muted-foreground">
                                    Dr. {agreement.physician_name}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-success border-success/30">
                                  Active
                                </Badge>
                                {agreement.medallion_document_url && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    asChild
                                  >
                                    <a href={agreement.medallion_document_url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => handleTerminateClick(agreement)}
                                >
                                  Terminate
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <Users className="h-4 w-4" />
                                <span>{agreementProviders.length} provider{agreementProviders.length !== 1 ? 's' : ''}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-4 w-4" />
                                <span>Started {agreement.start_date ? new Date(agreement.start_date).toLocaleDateString() : 'N/A'}</span>
                              </div>
                              {agreement.supervision_type && agreement.supervision_type !== 'primary' && (
                                <Badge variant="secondary" className="text-xs">
                                  {agreement.supervision_type}
                                </Badge>
                              )}
                            </div>
                            {agreementProviders.length > 0 && (
                              <div className="mt-2 text-xs text-muted-foreground">
                                {agreementProviders.slice(0, 3).map(p => p.provider_name).join(', ')}
                                {agreementProviders.length > 3 && ` +${agreementProviders.length - 3} more`}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              </div>

              {/* Terminated agreements */}
              {filteredAgreements.filter(a => a.workflow_status === 'terminated').length > 0 && (
                <div className="mt-8">
                  <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-5 w-5" />
                    Terminated Agreements
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredAgreements
                      .filter(a => a.workflow_status === 'terminated')
                      .map(agreement => (
                        <Card key={agreement.id} className="opacity-60">
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                                  <span className="text-sm font-bold text-muted-foreground">
                                    {agreement.state_abbreviation}
                                  </span>
                                </div>
                                <div>
                                  <CardTitle className="text-base text-muted-foreground">
                                    {agreement.state_name} Agreement
                                  </CardTitle>
                                  <p className="text-sm text-muted-foreground">
                                    Dr. {agreement.physician_name}
                                  </p>
                                </div>
                              </div>
                              <Badge variant="destructive">Terminated</Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm text-muted-foreground">
                              {agreement.termination_reason || 'No reason provided'}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="calendar">
              <SupervisionCalendar meetings={supervisionMeetings} />
            </TabsContent>

            <TabsContent value="physicians">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {collaboratingPhysicians.map(physician => {
                  const physicianAgreements = collaborativeAgreements.filter(
                    a => a.physicianId === physician.id
                  );
                  const supervisedProviders = providers.filter(p =>
                    physicianAgreements.some(a => a.providerIds.includes(p.id))
                  );

                  return (
                    <Card key={physician.id} className="card-interactive cursor-pointer">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-lg font-semibold text-primary">
                              {physician.firstName[0]}{physician.lastName[0]}
                            </span>
                          </div>
                          <div>
                            <CardTitle className="text-base">
                              Dr. {physician.firstName} {physician.lastName}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              {physician.specialty}
                            </p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          <span>{physicianAgreements.length} agreement{physicianAgreements.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Users className="h-4 w-4" />
                          <span>{supervisedProviders.length} provider{supervisedProviders.length !== 1 ? 's' : ''} supervised</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {physicianAgreements.map(a => {
                            const state = states.find(s => s.id === a.stateId);
                            return (
                              <Badge key={a.id} variant="secondary" className="text-xs">
                                {state?.abbreviation}
                              </Badge>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="notifications">
              <NotificationQueue />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default CollaborativeAgreementsPage;
