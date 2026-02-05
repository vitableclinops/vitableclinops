import { useState, useEffect } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { SupervisionCalendar } from '@/components/SupervisionCalendar';
import { StatCard } from '@/components/StatCard';
import { AgreementWizard } from '@/components/agreements/AgreementWizard';
import { TerminationDialog } from '@/components/agreements/TerminationDialog';
import { NotificationQueue } from '@/components/agreements/NotificationQueue';
import { WorkflowStatusTracker } from '@/components/agreements/WorkflowStatusTracker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supervisionMeetings } from '@/data/mockData';
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
  ExternalLink,
  MapPin,
  Building2,
  ChevronRight,
  AlertCircle,
  Shield
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { Tables } from '@/integrations/supabase/types';

type DbAgreement = Tables<'collaborative_agreements'>;
type DbProvider = Tables<'agreement_providers'>;

const CollaborativeAgreementsPage = () => {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [physicianFilter, setPhysicianFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('all-agreements');
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
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      agreement.state_name.toLowerCase().includes(searchLower) ||
      agreement.state_abbreviation.toLowerCase().includes(searchLower) ||
      agreement.physician_name.toLowerCase().includes(searchLower) ||
      dbProviders.filter(p => p.agreement_id === agreement.id)
        .some(p => p.provider_name.toLowerCase().includes(searchLower));
    
    const matchesStatus = statusFilter === 'all' || agreement.workflow_status === statusFilter;
    const matchesState = stateFilter === 'all' || agreement.state_abbreviation === stateFilter;
    const matchesPhysician = physicianFilter === 'all' || agreement.physician_name === physicianFilter;
    
    return matchesSearch && matchesStatus && matchesState && matchesPhysician;
  });

  const handleTerminateClick = async (agreement: DbAgreement) => {
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

  // Stats calculations
  const dbActiveCount = dbAgreements.filter(a => a.workflow_status === 'active').length;
  const dbPendingCount = dbAgreements.filter(a => 
    ['draft', 'pending_signatures', 'awaiting_physician_signature', 'awaiting_provider_signatures'].includes(a.workflow_status)
  ).length;
  const totalActiveProviders = dbProviders.filter(p => p.is_active).length;
  
  // Check for compliance risks
  const agreementsWithoutDocument = dbAgreements.filter(
    a => a.workflow_status === 'active' && !a.medallion_document_url && !a.agreement_document_url
  ).length;

  const { profile, roles } = useAuth();
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';

  // Group by physician
  const physicianData = (() => {
    const map = new Map<string, {
      name: string;
      email: string;
      npi: string | null;
      agreements: DbAgreement[];
      activeProviders: DbProvider[];
      terminatedProviders: DbProvider[];
      states: string[];
    }>();

    dbAgreements.forEach(agreement => {
      const existing = map.get(agreement.physician_email);
      const activeProviders = dbProviders.filter(p => p.agreement_id === agreement.id && p.is_active);
      const terminatedProviders = dbProviders.filter(p => p.agreement_id === agreement.id && !p.is_active);
      
      if (existing) {
        existing.agreements.push(agreement);
        existing.activeProviders.push(...activeProviders);
        existing.terminatedProviders.push(...terminatedProviders);
        if (!existing.states.includes(agreement.state_abbreviation)) {
          existing.states.push(agreement.state_abbreviation);
        }
      } else {
        map.set(agreement.physician_email, {
          name: agreement.physician_name,
          email: agreement.physician_email,
          npi: agreement.physician_npi,
          agreements: [agreement],
          activeProviders: [...activeProviders],
          terminatedProviders: [...terminatedProviders],
          states: [agreement.state_abbreviation]
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  // Group by state
  const stateData = (() => {
    const map = new Map<string, {
      abbreviation: string;
      name: string;
      agreements: DbAgreement[];
      activeProviders: DbProvider[];
      physicians: string[];
    }>();

    dbAgreements.forEach(agreement => {
      const existing = map.get(agreement.state_abbreviation);
      const activeProviders = dbProviders.filter(p => p.agreement_id === agreement.id && p.is_active);
      
      if (existing) {
        existing.agreements.push(agreement);
        existing.activeProviders.push(...activeProviders);
        if (!existing.physicians.includes(agreement.physician_name)) {
          existing.physicians.push(agreement.physician_name);
        }
      } else {
        map.set(agreement.state_abbreviation, {
          abbreviation: agreement.state_abbreviation,
          name: agreement.state_name,
          agreements: [agreement],
          activeProviders: [...activeProviders],
          physicians: [agreement.physician_name]
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-success/10 text-success border-success/20">Active</Badge>;
      case 'draft':
        return <Badge variant="secondary">Draft</Badge>;
      case 'pending_signatures':
      case 'awaiting_physician_signature':
      case 'awaiting_provider_signatures':
        return <Badge className="bg-warning/10 text-warning border-warning/20">Pending</Badge>;
      case 'terminated':
        return <Badge variant="destructive">Terminated</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
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
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Collaborative Agreements
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage physician collaborations, supervision schedules, and compliance.
              </p>
            </div>
            <Button onClick={() => setWizardOpen(true)} size="lg">
              <Plus className="h-4 w-4 mr-2" />
              New Agreement
            </Button>
          </div>

          {/* Wizards and Dialogs */}
          <AgreementWizard 
            open={wizardOpen} 
            onOpenChange={setWizardOpen}
            onSuccess={() => fetchDbAgreements()}
          />

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
              value={dbActiveCount}
              subtitle={`${uniqueStates.length} states covered`}
              icon={FileText}
              variant="success"
            />
            <StatCard
              title="Active Providers"
              value={totalActiveProviders}
              subtitle={`${uniquePhysicians.length} supervising physicians`}
              icon={Users}
              variant="default"
            />
            <StatCard
              title="In Progress"
              value={dbPendingCount}
              subtitle="Awaiting signatures"
              icon={Clock}
              variant={dbPendingCount > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Compliance Alerts"
              value={agreementsWithoutDocument}
              subtitle="Missing documentation"
              icon={AlertTriangle}
              variant={agreementsWithoutDocument > 0 ? 'danger' : 'success'}
            />
          </div>

          {/* Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6 h-12">
              <TabsTrigger value="all-agreements" className="gap-2 px-4">
                <FileText className="h-4 w-4" />
                All Agreements
              </TabsTrigger>
              <TabsTrigger value="by-physician" className="gap-2 px-4">
                <Building2 className="h-4 w-4" />
                By Physician
              </TabsTrigger>
              <TabsTrigger value="by-state" className="gap-2 px-4">
                <MapPin className="h-4 w-4" />
                By State
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-2 px-4">
                <Calendar className="h-4 w-4" />
                Calendar
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-2 px-4">
                <Mail className="h-4 w-4" />
                Notifications
              </TabsTrigger>
            </TabsList>

            {/* All Agreements Tab */}
            <TabsContent value="all-agreements">
              {/* Search and Filters */}
              <div className="flex flex-wrap gap-4 mb-6">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by provider, physician, or state..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-10"
                  />
                </div>
                
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px] h-10">
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
                  <SelectTrigger className="w-[130px] h-10">
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
                  <SelectTrigger className="w-[180px] h-10">
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
              <p className="text-sm text-muted-foreground mb-4">
                Showing {filteredAgreements.length} of {dbAgreements.length} agreements
              </p>

              {/* Agreements Table-like List */}
              <Card>
                <CardContent className="p-0">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-4 p-4 border-b bg-muted/50 text-sm font-medium text-muted-foreground">
                    <div className="col-span-2">State</div>
                    <div className="col-span-2">Physician</div>
                    <div className="col-span-3">Providers</div>
                    <div className="col-span-2">Meeting Cadence</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2 text-right">Actions</div>
                  </div>
                  
                  {/* Rows */}
                  <ScrollArea className="h-[500px]">
                    {filteredAgreements.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        No agreements found matching your filters.
                      </div>
                    ) : (
                      filteredAgreements.map((agreement) => {
                        const agreementProviders = dbProviders.filter(p => p.agreement_id === agreement.id && p.is_active);
                        const hasComplianceRisk = !agreement.medallion_document_url && !agreement.agreement_document_url;
                        
                        return (
                          <div 
                            key={agreement.id} 
                            className={`grid grid-cols-12 gap-4 p-4 border-b hover:bg-muted/30 transition-colors items-center ${
                              agreement.workflow_status === 'terminated' ? 'opacity-60' : ''
                            }`}
                          >
                            {/* State */}
                            <div className="col-span-2">
                              <div className="flex items-center gap-3">
                                <div className={`h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                                  agreement.workflow_status === 'active' 
                                    ? 'bg-success/10 text-success' 
                                    : agreement.workflow_status === 'terminated'
                                    ? 'bg-muted text-muted-foreground'
                                    : 'bg-warning/10 text-warning'
                                }`}>
                                  {agreement.state_abbreviation}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{agreement.state_name}</p>
                                  {hasComplianceRisk && agreement.workflow_status === 'active' && (
                                    <div className="flex items-center gap-1 text-destructive text-xs">
                                      <AlertCircle className="h-3 w-3" />
                                      Missing doc
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {/* Physician */}
                            <div className="col-span-2">
                              <p className="font-medium text-sm">Dr. {agreement.physician_name}</p>
                              <p className="text-xs text-muted-foreground">{agreement.physician_email}</p>
                            </div>
                            
                            {/* Providers */}
                            <div className="col-span-3">
                              {agreementProviders.length > 0 ? (
                                <div>
                                  <p className="text-sm font-medium">{agreementProviders.length} provider{agreementProviders.length !== 1 ? 's' : ''}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {agreementProviders.slice(0, 2).map(p => p.provider_name).join(', ')}
                                    {agreementProviders.length > 2 && ` +${agreementProviders.length - 2} more`}
                                  </p>
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">No active providers</p>
                              )}
                            </div>
                            
                            {/* Meeting Cadence */}
                            <div className="col-span-2">
                              <p className="text-sm capitalize">
                                {agreement.meeting_cadence?.replace(/_/g, ' ') || 'Not set'}
                              </p>
                            </div>
                            
                            {/* Status */}
                            <div className="col-span-1">
                              {getStatusBadge(agreement.workflow_status)}
                            </div>
                            
                            {/* Actions */}
                            <div className="col-span-2 flex justify-end gap-2">
                              {agreement.medallion_document_url && (
                                <Button variant="ghost" size="sm" asChild>
                                  <a href={agreement.medallion_document_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                              {agreement.workflow_status !== 'terminated' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => handleTerminateClick(agreement)}
                                >
                                  {agreement.workflow_status === 'active' ? 'Terminate' : 'Cancel'}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* By Physician Tab */}
            <TabsContent value="by-physician">
              <div className="space-y-6">
                {physicianData.map((physician) => (
                  <Card key={physician.email} className="overflow-hidden">
                    <CardHeader className="bg-muted/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-xl font-bold text-primary">
                              {physician.name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                          <div>
                            <CardTitle className="text-xl">Dr. {physician.name}</CardTitle>
                            <CardDescription className="text-sm">
                              {physician.email} {physician.npi && `• NPI: ${physician.npi}`}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-center">
                            <p className="text-2xl font-bold text-foreground">{physician.agreements.length}</p>
                            <p className="text-muted-foreground">States</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-success">{physician.activeProviders.length}</p>
                            <p className="text-muted-foreground">Active</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-muted-foreground">{physician.terminatedProviders.length}</p>
                            <p className="text-muted-foreground">Terminated</p>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6">
                      {/* States badges */}
                      <div className="flex flex-wrap gap-2 mb-6">
                        {physician.states.sort().map(state => (
                          <Badge key={state} variant="outline" className="px-3 py-1 text-sm">
                            {state}
                          </Badge>
                        ))}
                      </div>
                      
                      {/* Provider list */}
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="providers" className="border-none">
                          <AccordionTrigger className="hover:no-underline py-2">
                            <span className="flex items-center gap-2 text-sm font-medium">
                              <Users className="h-4 w-4" />
                              View all supervised providers ({physician.activeProviders.length} active)
                            </span>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="grid gap-2 pt-2">
                              {physician.activeProviders.map(provider => {
                                const agreement = physician.agreements.find(a => a.id === provider.agreement_id);
                                return (
                                  <div 
                                    key={provider.id} 
                                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
                                        <CheckCircle2 className="h-4 w-4 text-success" />
                                      </div>
                                      <div>
                                        <p className="font-medium text-sm">{provider.provider_name}</p>
                                        <p className="text-xs text-muted-foreground">{provider.provider_email}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <Badge variant="secondary">{agreement?.state_abbreviation}</Badge>
                                      {provider.start_date && (
                                        <span className="text-xs text-muted-foreground">
                                          Since {new Date(provider.start_date).toLocaleDateString()}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* By State Tab */}
            <TabsContent value="by-state">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {stateData.map((state) => {
                  const hasComplianceRisk = state.agreements.some(
                    a => a.workflow_status === 'active' && !a.medallion_document_url && !a.agreement_document_url
                  );
                  
                  return (
                    <Card key={state.abbreviation} className="card-interactive">
                      <CardHeader className="pb-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
                              <span className="text-xl font-bold text-primary">
                                {state.abbreviation}
                              </span>
                            </div>
                            <div>
                              <CardTitle className="text-lg">{state.name}</CardTitle>
                              <CardDescription>
                                {state.physicians.length} physician{state.physicians.length !== 1 ? 's' : ''}
                              </CardDescription>
                            </div>
                          </div>
                          {hasComplianceRisk && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertCircle className="h-3 w-3" />
                              Risk
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Provider count */}
                        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-muted-foreground" />
                            <span className="font-medium">Active Providers</span>
                          </div>
                          <span className="text-2xl font-bold text-success">
                            {state.activeProviders.length}
                          </span>
                        </div>
                        
                        {/* Supervising physicians */}
                        <div>
                          <p className="text-sm font-medium text-muted-foreground mb-2">
                            Supervising Physicians
                          </p>
                          <div className="space-y-2">
                            {state.physicians.map(physician => {
                              const agreement = state.agreements.find(a => a.physician_name === physician);
                              const providerCount = state.activeProviders.filter(
                                p => p.agreement_id === agreement?.id
                              ).length;
                              
                              return (
                                <div 
                                  key={physician} 
                                  className="flex items-center justify-between p-3 rounded-lg border"
                                >
                                  <div className="flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-primary" />
                                    <span className="text-sm font-medium">Dr. {physician}</span>
                                  </div>
                                  <span className="text-sm text-muted-foreground">
                                    {providerCount} provider{providerCount !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        
                        {/* Provider names preview */}
                        {state.activeProviders.length > 0 && (
                          <div className="pt-2 border-t">
                            <p className="text-xs text-muted-foreground">
                              {state.activeProviders.slice(0, 3).map(p => p.provider_name).join(', ')}
                              {state.activeProviders.length > 3 && ` +${state.activeProviders.length - 3} more`}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            {/* Calendar Tab */}
            <TabsContent value="calendar">
              <SupervisionCalendar meetings={supervisionMeetings} />
            </TabsContent>

            {/* Notifications Tab */}
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
