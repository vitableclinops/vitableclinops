import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { SupervisionCalendar } from '@/components/SupervisionCalendar';
import { StatCard } from '@/components/StatCard';
import { AgreementWizard } from '@/components/agreements/AgreementWizard';
import { TerminationDialog } from '@/components/agreements/TerminationDialog';
import { NotificationQueue } from '@/components/agreements/NotificationQueue';
import { WorkflowStatusTracker } from '@/components/agreements/WorkflowStatusTracker';
import { StateComplianceGrid } from '@/components/agreements/StateComplianceGrid';
import { BulkReassignDialog } from '@/components/agreements/BulkReassignDialog';
import { TransferWorkflowCard } from '@/components/agreements/TransferWorkflowCard';
import { AdminTaskQueue } from '@/components/agreements/AdminTaskQueue';
import { CompanyMeetingWizard } from '@/components/meetings/CompanyMeetingWizard';
import { useAgreementTransfers } from '@/hooks/useAgreementTransfers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useStateCompliance, StateCompliance } from '@/hooks/useStateCompliance';
import { useScheduledMeetings } from '@/hooks/useScheduledMeetings';
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
  Shield,
  Upload,
  Eye,
  MoreHorizontal,
  Link as LinkIcon,
  ArrowRightLeft,
  UserMinus
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import type { Tables } from '@/integrations/supabase/types';

type DbAgreement = Tables<'collaborative_agreements'>;
type DbProvider = Tables<'agreement_providers'>;

// Helper functions for date calculations
// Note: Next meeting dates are now pulled from scheduled meetings in the database,
// not auto-calculated from cadence. Cadence is shown for reference only.

const calculateRenewalDate = (startDate: string | null): Date | null => {
  if (!startDate) return null;
  const start = new Date(startDate);
  const renewalDate = new Date(start);
  renewalDate.setFullYear(renewalDate.getFullYear() + 1);
  return renewalDate;
};

const getDaysUntil = (targetDate: Date | null): number | null => {
  if (!targetDate) return null;
  const now = new Date();
  const diffTime = targetDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const formatCadence = (cadence: string | null): string => {
  if (!cadence) return 'Not set';
  return cadence
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
};

// Flattened view: Each agreement = one provider + one physician + one state
interface FlattenedAgreement {
  id: string;
  providerId: string;
  providerName: string;
  providerEmail: string;
  providerNpi: string | null;
  providerCredentials: string | null;
  physicianName: string;
  physicianEmail: string;
  stateAbbreviation: string;
  stateName: string;
  startDate: string | null;
  terminatedAt: string | null;
  removedReason: string | null;
  isActive: boolean;
  meetingCadence: string | null;
  chartReviewFrequency: string | null;
  documentUrl: string | null;
  medallionDocumentUrl: string | null;
  agreementId: string;
  nextMeetingDate: Date | null;
  renewalDate: Date | null;
  daysUntilMeeting: number | null;
  daysUntilRenewal: number | null;
  // State compliance fields
  caRequired: boolean;
  fpaStatus: string | null;
  rxrRequired: boolean;
  nlc: boolean;
  npMdRatio: string | null;
}

// Helper to get meeting cadence from state compliance data
const getStateMeetingCadence = (stateAbbr: string, complianceData: StateCompliance[]): string | null => {
  const stateCompliance = complianceData.find(c => c.state_abbreviation === stateAbbr);
  return stateCompliance?.ca_meeting_cadence || null;
};

// Helper to check if state requires collaborative agreement
const getStateCARequired = (stateAbbr: string, complianceData: StateCompliance[]): boolean => {
  const stateCompliance = complianceData.find(c => c.state_abbreviation === stateAbbr);
  return stateCompliance?.ca_required ?? false;
};

// Helper to get FPA status
const getStateFPAStatus = (stateAbbr: string, complianceData: StateCompliance[]): string | null => {
  const stateCompliance = complianceData.find(c => c.state_abbreviation === stateAbbr);
  return stateCompliance?.fpa_status || null;
};

const CollaborativeAgreementsPage = () => {
  // All hooks must be called first, before any conditional logic
  const { toast } = useToast();
  const { profile, roles, hasRole } = useAuth();
  const { allData: stateComplianceData, loading: complianceLoading } = useStateCompliance();
  const { getNextMeetingForAgreement, hasMeetingScheduled, loading: meetingsLoading } = useScheduledMeetings();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [physicianFilter, setPhysicianFilter] = useState<string>('all');
  const [meetingFilter, setMeetingFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('all-agreements');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [meetingWizardOpen, setMeetingWizardOpen] = useState(false);
  
  // Termination dialog state
  const [terminationOpen, setTerminationOpen] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<DbAgreement | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<DbProvider[]>([]);

  // Document upload dialog
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFlatAgreement, setSelectedFlatAgreement] = useState<FlattenedAgreement | null>(null);
  const [documentUrl, setDocumentUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);

  // Transfers
  const { transfers, loading: transfersLoading, refetch: refetchTransfers } = useAgreementTransfers();

  // Database agreements and providers
  const [dbAgreements, setDbAgreements] = useState<DbAgreement[]>([]);
  const [dbProviders, setDbProviders] = useState<DbProvider[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Derived values from auth
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';

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

  // Create flattened agreements - each provider-state-physician combo is one row
  // Use state compliance data for meeting cadences when available
  // Next meeting dates come from actual scheduled meetings in the database
  const flattenedAgreements: FlattenedAgreement[] = dbProviders.map(provider => {
    const agreement = dbAgreements.find(a => a.id === provider.agreement_id);
    if (!agreement) return null;
    
    // Use state compliance cadence if available, otherwise fall back to agreement cadence
    const stateCadence = getStateMeetingCadence(agreement.state_abbreviation, stateComplianceData);
    const effectiveCadence = stateCadence || agreement.meeting_cadence;
    
    // Get next meeting from scheduled meetings in database (not auto-calculated)
    const nextScheduledMeeting = getNextMeetingForAgreement(agreement.id);
    const nextMeetingDate = nextScheduledMeeting ? new Date(nextScheduledMeeting.scheduled_date) : null;
    
    const renewalDate = calculateRenewalDate(provider.start_date);
    
    // Get state compliance info
    const stateCompliance = stateComplianceData.find(c => c.state_abbreviation === agreement.state_abbreviation);
    
    return {
      id: `${provider.id}-${agreement.id}`,
      providerId: provider.id,
      providerName: provider.provider_name,
      providerEmail: provider.provider_email,
      providerNpi: provider.provider_npi,
      providerCredentials: null,
      physicianName: agreement.physician_name,
      physicianEmail: agreement.physician_email,
      stateAbbreviation: agreement.state_abbreviation,
      stateName: agreement.state_name,
      startDate: provider.start_date,
      terminatedAt: provider.removed_at,
      removedReason: provider.removed_reason,
      isActive: provider.is_active ?? true,
      meetingCadence: effectiveCadence, // Use state-derived cadence for display
      chartReviewFrequency: agreement.chart_review_frequency,
      documentUrl: provider.medallion_document_url,
      medallionDocumentUrl: agreement.medallion_document_url,
      agreementId: agreement.id,
      nextMeetingDate, // Now from actual scheduled meetings
      renewalDate,
      daysUntilMeeting: getDaysUntil(nextMeetingDate),
      daysUntilRenewal: getDaysUntil(renewalDate),
      // Add state compliance info
      caRequired: stateCompliance?.ca_required ?? false,
      fpaStatus: stateCompliance?.fpa_status || null,
      rxrRequired: stateCompliance?.rxr_required ?? false,
      nlc: stateCompliance?.nlc ?? false,
      npMdRatio: stateCompliance?.np_md_ratio || null,
    };
  }).filter(Boolean) as FlattenedAgreement[];

  // Extract unique values for filters
  const uniqueStates = [...new Set(flattenedAgreements.map(a => a.stateAbbreviation))].sort();
  const uniquePhysicians = [...new Set(flattenedAgreements.map(a => a.physicianName))].sort();

  // Filter flattened agreements
  const filteredFlatAgreements = flattenedAgreements.filter(agreement => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      agreement.stateName.toLowerCase().includes(searchLower) ||
      agreement.stateAbbreviation.toLowerCase().includes(searchLower) ||
      agreement.physicianName.toLowerCase().includes(searchLower) ||
      agreement.providerName.toLowerCase().includes(searchLower) ||
      agreement.providerEmail.toLowerCase().includes(searchLower);
    
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'active' && agreement.isActive) ||
      (statusFilter === 'terminated' && !agreement.isActive);
    const matchesState = stateFilter === 'all' || agreement.stateAbbreviation === stateFilter;
    const matchesPhysician = physicianFilter === 'all' || agreement.physicianName === physicianFilter;
    
    // Meeting filter logic
    let matchesMeeting = true;
    if (meetingFilter !== 'all') {
      if (meetingFilter === 'upcoming7') {
        matchesMeeting = agreement.daysUntilMeeting !== null && agreement.daysUntilMeeting >= 0 && agreement.daysUntilMeeting <= 7;
      } else if (meetingFilter === 'upcoming14') {
        matchesMeeting = agreement.daysUntilMeeting !== null && agreement.daysUntilMeeting >= 0 && agreement.daysUntilMeeting <= 14;
      } else if (meetingFilter === 'overdue') {
        matchesMeeting = agreement.daysUntilMeeting !== null && agreement.daysUntilMeeting < 0;
      } else if (meetingFilter === 'none') {
        matchesMeeting = agreement.nextMeetingDate === null;
      }
    }
    
    return matchesSearch && matchesStatus && matchesState && matchesPhysician && matchesMeeting;
  });

  // Bulk selection helpers
  const isAllSelected = filteredFlatAgreements.length > 0 && 
    filteredFlatAgreements.every(a => selectedIds.has(a.id));
  
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredFlatAgreements.map(a => a.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectedAgreementsForBulk = filteredFlatAgreements.filter(a => selectedIds.has(a.id));

  // Get all physicians from physician_profiles view
  const { data: allPhysicians } = useQuery({
    queryKey: ['physicians-for-reassign'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('physician_profiles')
        .select('id, full_name, email, npi_number')
        .eq('employment_status', 'active')
        .order('full_name');
      if (error) throw error;
      return (data || []).map(p => ({
        id: p.id,
        name: p.full_name || 'Unknown',
        email: p.email || '',
      }));
    },
  });
  const physiciansForReassign = allPhysicians || [];

  // Handle document upload/link
  const handleDocumentSave = async () => {
    if (!selectedFlatAgreement || !documentUrl.trim()) return;
    
    setUploading(true);
    try {
      const { error } = await supabase
        .from('agreement_providers')
        .update({ medallion_document_url: documentUrl.trim() })
        .eq('id', selectedFlatAgreement.providerId);
      
      if (error) throw error;
      
      toast({
        title: 'Document saved',
        description: 'Agreement document has been linked successfully.',
      });
      
      setUploadDialogOpen(false);
      setDocumentUrl('');
      setSelectedFlatAgreement(null);
      fetchDbAgreements();
    } catch (error) {
      console.error('Error saving document:', error);
      toast({
        title: 'Error',
        description: 'Failed to save document link.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

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
  const activeAgreementsCount = flattenedAgreements.filter(a => a.isActive).length;
  const terminatedCount = flattenedAgreements.filter(a => !a.isActive).length;
  const totalActiveProviders = dbProviders.filter(p => p.is_active).length;
  
  // Check for compliance risks
  const agreementsWithoutDocument = flattenedAgreements.filter(
    a => a.isActive && !a.documentUrl && !a.medallionDocumentUrl
  ).length;
  
  // Upcoming meetings in next 14 days
  const upcomingMeetings = flattenedAgreements.filter(
    a => a.isActive && a.daysUntilMeeting !== null && a.daysUntilMeeting >= 0 && a.daysUntilMeeting <= 14
  ).length;
  
  // Renewals due in next 30 days (or overdue)
  const renewalsDue = flattenedAgreements.filter(
    a => a.isActive && a.daysUntilRenewal !== null && a.daysUntilRenewal <= 30
  ).length;

  // Note: useAuth() is called at top of component - userRole, userName, userEmail defined there

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
      
      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8 overflow-x-auto">
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
            <div className="flex gap-2">
              {/* Only admins and physicians can schedule meetings */}
              {(hasRole('admin') || hasRole('physician')) && (
                <Button variant="outline" onClick={() => setMeetingWizardOpen(true)} size="lg">
                  <Calendar className="h-4 w-4 mr-2" />
                  Schedule Meeting
                </Button>
              )}
              {/* Only admins can create new agreements */}
              {hasRole('admin') && (
                <Button onClick={() => setWizardOpen(true)} size="lg">
                  <Plus className="h-4 w-4 mr-2" />
                  New Agreement
                </Button>
              )}
            </div>
          </div>

          {/* Wizards and Dialogs */}
          <AgreementWizard 
            open={wizardOpen} 
            onOpenChange={setWizardOpen}
            onSuccess={() => fetchDbAgreements()}
          />

          <CompanyMeetingWizard
            open={meetingWizardOpen}
            onOpenChange={setMeetingWizardOpen}
            onSuccess={() => {
              fetchDbAgreements();
            }}
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
          <div className="grid gap-4 md:grid-cols-5 mb-8">
            <StatCard
              title="Active Agreements"
              value={activeAgreementsCount}
              subtitle={`${uniqueStates.length} states covered`}
              icon={FileText}
              variant="success"
            />
            <StatCard
              title="Upcoming Meetings"
              value={upcomingMeetings}
              subtitle="Next 14 days"
              icon={Calendar}
              variant={upcomingMeetings > 0 ? 'warning' : 'default'}
            />
            <StatCard
              title="Renewals Due"
              value={renewalsDue}
              subtitle="Next 30 days"
              icon={Clock}
              variant={renewalsDue > 0 ? 'danger' : 'success'}
            />
            <StatCard
              title="Missing Docs"
              value={agreementsWithoutDocument}
              subtitle="Need documentation"
              icon={AlertTriangle}
              variant={agreementsWithoutDocument > 0 ? 'danger' : 'success'}
            />
            <StatCard
              title="Total Providers"
              value={totalActiveProviders}
              subtitle={`${uniquePhysicians.length} physicians`}
              icon={Users}
              variant="default"
            />
          </div>

          {/* Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6 h-12">
              <TabsTrigger value="all-agreements" className="gap-2 px-4">
                <FileText className="h-4 w-4" />
                All Agreements
              </TabsTrigger>
              <TabsTrigger value="transfers" className="gap-2 px-4">
                <ArrowRightLeft className="h-4 w-4" />
                Tasks
                {transfers.filter(t => t.status === 'pending' || t.status === 'in_progress').length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {transfers.filter(t => t.status === 'pending' || t.status === 'in_progress').length}
                  </Badge>
                )}
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
                    <SelectItem value="terminated">Ended</SelectItem>
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

                <Select value={meetingFilter} onValueChange={setMeetingFilter}>
                  <SelectTrigger className="w-[170px] h-10">
                    <SelectValue placeholder="Next Meeting" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Meetings</SelectItem>
                    <SelectItem value="upcoming7">Next 7 days</SelectItem>
                    <SelectItem value="upcoming14">Next 14 days</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="none">None scheduled</SelectItem>
                  </SelectContent>
                </Select>

                {(searchQuery || statusFilter !== 'all' || stateFilter !== 'all' || physicianFilter !== 'all' || meetingFilter !== 'all') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setStateFilter('all');
                      setPhysicianFilter('all');
                      setMeetingFilter('all');
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>

              {/* Bulk Actions Bar */}
              {selectedIds.size > 0 && hasRole('admin') && (
                <div className="flex items-center gap-4 p-3 mb-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <span className="text-sm font-medium">
                    {selectedIds.size} agreement{selectedIds.size !== 1 ? 's' : ''} selected
                  </span>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkReassignOpen(true)}
                  >
                    <UserMinus className="h-4 w-4 mr-2" />
                    Reassign Physician
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear selection
                  </Button>
                </div>
              )}

              {/* Results count */}
              <p className="text-sm text-muted-foreground mb-4">
                Showing {filteredFlatAgreements.length} of {flattenedAgreements.length} individual agreements
              </p>

              {/* Document Upload Dialog */}
              <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Link Agreement Document</DialogTitle>
                    <DialogDescription>
                      Add a link to the collaborative agreement document for {selectedFlatAgreement?.providerName} in {selectedFlatAgreement?.stateAbbreviation}.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="documentUrl">Document URL</Label>
                      <Input
                        id="documentUrl"
                        placeholder="https://drive.google.com/... or https://..."
                        value={documentUrl}
                        onChange={(e) => setDocumentUrl(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Paste a link to the signed agreement from Google Drive, Dropbox, or other file storage.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleDocumentSave} disabled={uploading || !documentUrl.trim()}>
                      {uploading ? 'Saving...' : 'Save Document Link'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Agreements Table - One row per Provider-State-Physician */}
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-3 p-4 border-b bg-muted/50 text-sm font-medium text-muted-foreground min-w-[900px]">
                    {hasRole('admin') && (
                      <div className="flex items-center">
                        <Checkbox
                          checked={isAllSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </div>
                    )}
                    <div className={hasRole('admin') ? 'col-span-3' : 'col-span-4'}>Provider</div>
                    <div>State</div>
                    <div className="col-span-2">Physician</div>
                    <div className="col-span-2">Next Meeting</div>
                    <div className="col-span-2">Renewal Due</div>
                    <div className="text-right">Actions</div>
                  </div>
                  
                  {/* Rows */}
                  <ScrollArea className="h-[600px]">
                    {filteredFlatAgreements.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground">
                        No agreements found matching your filters.
                      </div>
                    ) : (
                      filteredFlatAgreements.map((agreement) => {
                        const hasDocument = !!agreement.documentUrl || !!agreement.medallionDocumentUrl;
                        const documentLink = agreement.documentUrl || agreement.medallionDocumentUrl;
                        
                        // Meeting urgency
                        const meetingUrgent = agreement.daysUntilMeeting !== null && agreement.daysUntilMeeting <= 7;
                        const meetingOverdue = agreement.daysUntilMeeting !== null && agreement.daysUntilMeeting < 0;
                        
                        // Renewal urgency
                        const renewalUrgent = agreement.daysUntilRenewal !== null && agreement.daysUntilRenewal <= 14;
                        const renewalOverdue = agreement.daysUntilRenewal !== null && agreement.daysUntilRenewal < 0;
                        const renewalDueSoon = agreement.daysUntilRenewal !== null && agreement.daysUntilRenewal <= 30;
                        
                        return (
                          <div 
                            key={agreement.id} 
                            className={`grid grid-cols-12 gap-3 p-4 border-b hover:bg-muted/30 transition-colors items-center group min-w-[900px] ${
                              !agreement.isActive ? 'opacity-60 bg-muted/10' : ''
                            } ${selectedIds.has(agreement.id) ? 'bg-primary/5' : ''}`}
                          >
                            {/* Checkbox */}
                            {hasRole('admin') && (
                              <div>
                                <Checkbox
                                  checked={selectedIds.has(agreement.id)}
                                  onCheckedChange={() => toggleSelect(agreement.id)}
                                  aria-label={`Select ${agreement.providerName}`}
                                />
                              </div>
                            )}
                            {/* Provider */}
                            <div className={hasRole('admin') ? 'col-span-3' : 'col-span-4'}>
                              <Link 
                                to={`/directory?search=${encodeURIComponent(agreement.providerEmail)}`}
                                className="flex items-center gap-3 group/provider"
                              >
                                <div className={`h-9 w-9 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 ${
                                  agreement.isActive 
                                    ? 'bg-success/10 text-success' 
                                    : 'bg-muted text-muted-foreground'
                                }`}>
                                  {agreement.providerName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-sm truncate group-hover/provider:text-primary transition-colors">{agreement.providerName}</p>
                                  <div className="flex items-center gap-2">
                                    {!agreement.isActive && (
                                      <Badge variant="secondary" className="text-[10px] px-1 py-0">Ended</Badge>
                                    )}
                                    {!hasDocument && agreement.isActive && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-warning border-warning/30">No Doc</Badge>
                                    )}
                                  </div>
                                </div>
                              </Link>
                            </div>
                            
                            {/* State with CA requirement indicator */}
                            <div>
                              <div className="flex flex-col gap-1">
                                <Link to={`/states/${agreement.stateAbbreviation}`}>
                                  <Badge variant="outline" className="font-bold text-xs w-fit hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer">
                                    {agreement.stateAbbreviation}
                                  </Badge>
                                </Link>
                                {agreement.caRequired && (
                                  <span className="text-[10px] text-muted-foreground">CA Req</span>
                                )}
                              </div>
                            </div>
                            
                            {/* Physician with state-derived cadence */}
                            <div className="col-span-2">
                              <Link 
                                to={`/physicians/${encodeURIComponent(agreement.physicianEmail)}`}
                                className="text-sm hover:text-primary hover:underline transition-colors"
                              >
                                Dr. {agreement.physicianName.split(' ')[1] || agreement.physicianName}
                              </Link>
                              <p className="text-xs text-muted-foreground">
                                {formatCadence(agreement.meetingCadence)}
                              </p>
                            </div>
                            
                            {/* Next Meeting - Clean display with hover for details */}
                            <div className="col-span-2">
                              {!agreement.isActive ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : agreement.nextMeetingDate ? (
                                <div className="group/meeting relative cursor-default">
                                  <div className="flex items-center gap-1.5">
                                    {meetingOverdue && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                                    {meetingUrgent && !meetingOverdue && <Clock className="h-3.5 w-3.5 text-warning shrink-0" />}
                                    <span className={`text-sm ${
                                      meetingOverdue ? 'text-destructive font-medium' : 
                                      meetingUrgent ? 'text-warning font-medium' : ''
                                    }`}>
                                      {agreement.nextMeetingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                  </div>
                                  {/* Tooltip on hover */}
                                  <div className="absolute left-0 top-full mt-1 bg-popover border rounded-md shadow-md p-2 text-xs z-10 hidden group-hover/meeting:block whitespace-nowrap">
                                    {meetingOverdue ? (
                                      <span className="text-destructive">{Math.abs(agreement.daysUntilMeeting!)} days overdue</span>
                                    ) : agreement.daysUntilMeeting === 0 ? (
                                      <span className="text-warning">Meeting today</span>
                                    ) : (
                                      <span>In {agreement.daysUntilMeeting} days</span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">None scheduled</span>
                              )}
                            </div>
                            
                            {/* Renewal Due - Clean display with hover for details */}
                            <div className="col-span-2">
                              {!agreement.isActive ? (
                                <span className="text-sm text-muted-foreground">—</span>
                              ) : agreement.renewalDate ? (
                                <div className="group/renewal relative cursor-default">
                                  <div className="flex items-center gap-1.5">
                                    {renewalOverdue && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                                    {renewalDueSoon && !renewalOverdue && <Clock className="h-3.5 w-3.5 text-warning shrink-0" />}
                                    <span className={`text-sm ${
                                      renewalOverdue ? 'text-destructive font-medium' : 
                                      renewalDueSoon ? 'text-warning font-medium' : ''
                                    }`}>
                                      {agreement.renewalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                                    </span>
                                  </div>
                                  {/* Tooltip on hover */}
                                  <div className="absolute left-0 top-full mt-1 bg-popover border rounded-md shadow-md p-2 text-xs z-10 hidden group-hover/renewal:block whitespace-nowrap">
                                    {renewalOverdue ? (
                                      <span className="text-destructive font-medium">{Math.abs(agreement.daysUntilRenewal!)} days overdue - needs new agreement!</span>
                                    ) : agreement.daysUntilRenewal! <= 30 ? (
                                      <span className="text-warning">{agreement.daysUntilRenewal} days until renewal</span>
                                    ) : (
                                      <span>{agreement.daysUntilRenewal} days remaining</span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">Not set</span>
                              )}
                            </div>
                            
                            {/* Actions - combined doc + menu */}
                            <div className="flex justify-end items-center gap-1">
                              <Button variant="ghost" size="icon" asChild className="h-8 w-8">
                                <Link to={`/admin/agreements/${agreement.agreementId}`} title="View Agreement Details">
                                  <ChevronRight className="h-4 w-4" />
                                </Link>
                              </Button>
                              {hasDocument && (
                                <Button variant="ghost" size="icon" asChild className="text-success h-8 w-8">
                                  <a href={documentLink!} target="_blank" rel="noopener noreferrer" title="View Document">
                                    <Eye className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                              {!hasDocument && agreement.isActive && (
                                <div className="flex items-center gap-1 text-warning text-xs mr-1" title="Missing documentation">
                                  <AlertCircle className="h-4 w-4" />
                                </div>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link to={`/admin/agreements/${agreement.agreementId}`}>
                                      <Eye className="h-4 w-4 mr-2" />
                                      View Details
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedFlatAgreement(agreement);
                                      setDocumentUrl(agreement.documentUrl || '');
                                      setUploadDialogOpen(true);
                                    }}
                                  >
                                    <LinkIcon className="h-4 w-4 mr-2" />
                                    {hasDocument ? 'Update Document' : 'Add Document'}
                                  </DropdownMenuItem>
                                  {hasDocument && (
                                    <DropdownMenuItem asChild>
                                      <a href={documentLink!} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-4 w-4 mr-2" />
                                        Open Document
                                      </a>
                                    </DropdownMenuItem>
                                  )}
                                  {agreement.isActive && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => {
                                          const dbAgreement = dbAgreements.find(a => a.id === agreement.agreementId);
                                          if (dbAgreement) handleTerminateClick(dbAgreement);
                                        }}
                                      >
                                        <AlertCircle className="h-4 w-4 mr-2" />
                                        Terminate
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tasks Tab */}
            <TabsContent value="transfers">
              <div className="grid gap-6 xl:grid-cols-3">
                {/* Task Queue Sidebar */}
                <div className="xl:col-span-1 order-2 xl:order-1">
                  <AdminTaskQueue />
                </div>

                {/* Transfer Workflows */}
                <div className="xl:col-span-2 space-y-4 order-1 xl:order-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="text-lg font-semibold">Active Tasks</h3>
                      <p className="text-sm text-muted-foreground">Track in-progress tasks, transfers, and checklist workflows</p>
                    </div>
                  </div>
                  
                  {transfersLoading ? (
                    <div className="animate-pulse space-y-4">
                      <div className="h-24 bg-muted rounded" />
                      <div className="h-24 bg-muted rounded" />
                    </div>
                  ) : transfers.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center">
                        <ArrowRightLeft className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">No transfers in progress</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Use bulk selection on the All Agreements tab to initiate transfers
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-4">
                      {transfers.map(transfer => (
                        <TransferWorkflowCard 
                          key={transfer.id} 
                          transfer={transfer} 
                          onUpdate={refetchTransfers}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
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
                      {/* States badges with compliance info */}
                      <div className="flex flex-wrap gap-2 mb-6">
                        {physician.states.sort().map(state => {
                          const stateCompliance = stateComplianceData.find(c => c.state_abbreviation === state);
                          const caRequired = stateCompliance?.ca_required ?? false;
                          return (
                            <div key={state} className="flex flex-col items-center gap-0.5">
                              <Badge 
                                variant={caRequired ? "default" : "outline"} 
                                className="px-3 py-1 text-sm"
                              >
                                {state}
                              </Badge>
                              {caRequired && (
                                <span className="text-[9px] text-muted-foreground">CA Req</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Provider list - Aggregated by provider name */}
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="providers" className="border-none">
                          <AccordionTrigger className="hover:no-underline py-2">
                            <span className="flex items-center gap-2 text-sm font-medium">
                              <Users className="h-4 w-4" />
                              View all supervised providers ({
                                // Count unique providers by email
                                new Set(physician.activeProviders.map(p => p.provider_email)).size
                              } providers, {physician.activeProviders.length} agreements)
                            </span>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="grid gap-2 pt-2">
                              {/* Aggregate providers by email */}
                              {(() => {
                                // Group providers by email
                                const providerMap = new Map<string, {
                                  name: string;
                                  email: string;
                                  stateAgreements: Array<{
                                    state: string;
                                    startDate: string | null;
                                    agreementId: string;
                                  }>;
                                }>();
                                
                                physician.activeProviders.forEach(provider => {
                                  const agreement = physician.agreements.find(a => a.id === provider.agreement_id);
                                  if (!agreement) return;
                                  
                                  const existing = providerMap.get(provider.provider_email);
                                  if (existing) {
                                    existing.stateAgreements.push({
                                      state: agreement.state_abbreviation,
                                      startDate: provider.start_date,
                                      agreementId: agreement.id
                                    });
                                  } else {
                                    providerMap.set(provider.provider_email, {
                                      name: provider.provider_name,
                                      email: provider.provider_email,
                                      stateAgreements: [{
                                        state: agreement.state_abbreviation,
                                        startDate: provider.start_date,
                                        agreementId: agreement.id
                                      }]
                                    });
                                  }
                                });
                                
                                return Array.from(providerMap.values())
                                  .sort((a, b) => a.name.localeCompare(b.name))
                                  .map(provider => (
                                    <div 
                                      key={provider.email} 
                                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
                                          <CheckCircle2 className="h-4 w-4 text-success" />
                                        </div>
                                        <div>
                                          <p className="font-medium text-sm">{provider.name}</p>
                                          <p className="text-xs text-muted-foreground">{provider.email}</p>
                                        </div>
                                      </div>
                                      <div className="flex flex-col items-end gap-1">
                                        {/* State badges with CA indicator */}
                                        <div className="flex flex-wrap gap-1 justify-end">
                                          {provider.stateAgreements
                                            .sort((a, b) => a.state.localeCompare(b.state))
                                            .map(sa => {
                                              const stateCompliance = stateComplianceData.find(c => c.state_abbreviation === sa.state);
                                              const caRequired = stateCompliance?.ca_required ?? false;
                                              return (
                                                <Badge 
                                                  key={sa.agreementId} 
                                                  variant={caRequired ? "default" : "secondary"} 
                                                  className="text-xs"
                                                  title={caRequired ? `${sa.state} requires CA` : sa.state}
                                                >
                                                  {sa.state}
                                                </Badge>
                                              );
                                            })
                                          }
                                        </div>
                                        {/* Show dates if multiple states */}
                                        {provider.stateAgreements.length > 1 ? (
                                          <span className="text-xs text-muted-foreground">
                                            {provider.stateAgreements.length} agreements
                                          </span>
                                        ) : provider.stateAgreements[0]?.startDate && (
                                          <span className="text-xs text-muted-foreground">
                                            Since {new Date(provider.stateAgreements[0].startDate).toLocaleDateString()}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ));
                              })()}
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
              <StateComplianceGrid stateData={stateData} />
            </TabsContent>

            {/* Calendar Tab */}
            <TabsContent value="calendar">
              <SupervisionCalendar meetings={supervisionMeetings} />
            </TabsContent>

            {/* Notifications Tab */}
            <TabsContent value="notifications">
              <div className="space-y-6">
                {/* Compliance Alerts Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      Compliance Alerts
                    </CardTitle>
                    <CardDescription>
                      Overdue meetings and renewals requiring immediate attention
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const overdueItems = flattenedAgreements.filter(a => 
                        a.isActive && (
                          (a.daysUntilMeeting !== null && a.daysUntilMeeting < 0) ||
                          (a.daysUntilRenewal !== null && a.daysUntilRenewal < 0)
                        )
                      );
                      
                      const upcomingItems = flattenedAgreements.filter(a =>
                        a.isActive && (
                          (a.daysUntilMeeting !== null && a.daysUntilMeeting >= 0 && a.daysUntilMeeting <= 7) ||
                          (a.daysUntilRenewal !== null && a.daysUntilRenewal >= 0 && a.daysUntilRenewal <= 30)
                        )
                      );
                      
                      if (overdueItems.length === 0 && upcomingItems.length === 0) {
                        return (
                          <div className="text-center py-8 text-muted-foreground">
                            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                            <p>No compliance alerts - all agreements are on track!</p>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="space-y-4">
                          {/* Overdue Section */}
                          {overdueItems.length > 0 && (
                            <div>
                              <h4 className="font-medium text-destructive mb-3 flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                Overdue ({overdueItems.length})
                              </h4>
                              <div className="space-y-2">
                                {overdueItems.map(item => (
                                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                                    <div className="flex items-center gap-3">
                                      <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center text-destructive text-xs font-medium">
                                        {item.providerName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium">{item.providerName}</p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                          <Badge variant={item.caRequired ? "default" : "outline"} className="text-[10px] px-1.5 py-0">
                                            {item.stateAbbreviation}
                                          </Badge>
                                          <span>Dr. {item.physicianName.split(' ')[1] || item.physicianName}</span>
                                          {item.meetingCadence && (
                                            <span className="text-muted-foreground/70">• {formatCadence(item.meetingCadence)}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-right flex flex-col gap-1">
                                      {item.daysUntilMeeting !== null && item.daysUntilMeeting < 0 && (
                                        <Badge variant="destructive">
                                          Meeting {Math.abs(item.daysUntilMeeting)} days overdue
                                        </Badge>
                                      )}
                                      {item.daysUntilRenewal !== null && item.daysUntilRenewal < 0 && (
                                        <Badge variant="destructive">
                                          Renewal {Math.abs(item.daysUntilRenewal)} days overdue
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Upcoming Section */}
                          {upcomingItems.length > 0 && (
                            <div>
                              <h4 className="font-medium text-warning mb-3 flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                Action Needed Soon ({upcomingItems.length})
                              </h4>
                              <div className="space-y-2">
                                {upcomingItems.slice(0, 10).map(item => (
                                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-warning/30 bg-warning/5">
                                    <div className="flex items-center gap-3">
                                      <div className="h-8 w-8 rounded-full bg-warning/10 flex items-center justify-center text-warning text-xs font-medium">
                                        {item.providerName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium">{item.providerName}</p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                          <Badge variant={item.caRequired ? "default" : "outline"} className="text-[10px] px-1.5 py-0">
                                            {item.stateAbbreviation}
                                          </Badge>
                                          <span>Dr. {item.physicianName.split(' ')[1] || item.physicianName}</span>
                                          {item.meetingCadence && (
                                            <span className="text-muted-foreground/70">• {formatCadence(item.meetingCadence)}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex gap-2 flex-wrap justify-end">
                                      {item.daysUntilMeeting !== null && item.daysUntilMeeting >= 0 && item.daysUntilMeeting <= 7 && (
                                        <Badge variant="outline" className="text-warning border-warning/50">
                                          Meeting in {item.daysUntilMeeting} days
                                        </Badge>
                                      )}
                                      {item.daysUntilRenewal !== null && item.daysUntilRenewal >= 0 && item.daysUntilRenewal <= 30 && (
                                        <Badge variant="outline" className="text-warning border-warning/50">
                                          Renewal in {item.daysUntilRenewal} days
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {upcomingItems.length > 10 && (
                                  <p className="text-xs text-muted-foreground text-center py-2">
                                    +{upcomingItems.length - 10} more items
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
                
                {/* Manual Notification Queue */}
                <NotificationQueue />
              </div>
            </TabsContent>
          </Tabs>

          {/* Bulk Reassign Dialog */}
          <BulkReassignDialog
            open={bulkReassignOpen}
            onOpenChange={setBulkReassignOpen}
            selectedAgreements={selectedAgreementsForBulk}
            physicians={physiciansForReassign}
            onSuccess={() => {
              fetchDbAgreements();
              refetchTransfers();
              setSelectedIds(new Set());
            }}
          />
        </div>
      </main>
    </div>
  );
};

export default CollaborativeAgreementsPage;
