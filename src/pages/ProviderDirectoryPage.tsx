import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, Grid3X3, List, MapPin, Shield, AlertTriangle, Clock, UserPlus, MoreHorizontal, Edit, Eye, ChevronRight, Search, CheckCircle2, Activity, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProviderFilters } from '@/components/directory/ProviderFilters';
import { ProviderTable, ProviderTableData } from '@/components/directory/ProviderTable';
import { ProviderDetailModal } from '@/components/directory/ProviderDetailModal';
import { SupervisionAgreementsTable } from '@/components/directory/SupervisionAgreementsTable';
import { ExternalImportPanel } from '@/components/directory/ExternalImportPanel';
import { useExternalDirectoryData } from '@/hooks/useExternalImport';
import { summarizeLicenses } from '@/lib/externalImport';
import { MedallionSyncPanel } from '@/components/directory/MedallionSyncPanel';
import { activeLicensedStates, useMedallionDirectoryData } from '@/hooks/useMedallionDirectory';
import { usePcpCoverage } from '@/hooks/usePcpCoverage';
import { pcpCellFor } from '@/lib/pcpCoverage';
import { directoryDisplayName } from '@/lib/directoryDisplayName';
import { directoryMedallionConflicts } from '@/lib/directoryMedallionConflicts';
import { ProviderFlagAlerts } from '@/components/directory/ProviderFlagAlerts';
import { PcpCoverageStatus } from '@/components/directory/PcpCoverageStatus';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Provider } from '@/types';

interface FullProvider {
  id: string;
  user_id: string | null;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string;
  phone_number: string | null;
  npi_number: string | null;
  credentials: string | null;
  profession: string | null;
  avatar_url: string | null;
  birthday: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  postal_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  patient_age_preference: string | null;
  service_offerings: string | null;
  employment_start_date: string | null;
  employment_end_date: string | null;
  employment_offer_date: string | null;
  employment_status: string | null;
  employment_type: string | null;
  agency_id: string | null;
  primary_specialty: string | null;
  board_certificates: string | null;
  caqh_number: string | null;
  pronoun: string | null;
  has_caqh_management: boolean | null;
  has_collaborative_agreements: boolean | null;
  auto_renew_licenses: boolean | null;
  practice_restrictions: string | null;
  secondary_contact_email: string | null;
  medallion_id: string | null;
  chart_review_folder_url: string | null;
  created_at: string;
  activation_status: string | null;
  renewal_handling: string | null;
  languages: string | null;
  bio: string | null;
  pod_lead_id: string | null;
}

interface DirectoryProvider {
  id: string;
  full_name: string | null;
  preferred_name: string | null;
  npi_number: string | null;
  credentials: string | null;
  avatar_url: string | null;
  employment_status: string | null;
  employment_type: string | null;
  agency_id: string | null;
  profession: string | null;
  primary_specialty: string | null;
  address_state: string | null;
}


const ProviderDirectoryPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile, roles } = useAuth();

  // Determine initial tab from URL or default based on role
  const tabParam = searchParams.get('tab');
  const isAdmin = roles.includes('admin');
  const defaultTab = isAdmin && ['management', 'medallion', 'agency-import'].includes(tabParam ?? '') ? (tabParam ?? 'directory') : 'directory';
  
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [providers, setProviders] = useState<FullProvider[]>([]);
  const [publicProviders, setPublicProviders] = useState<DirectoryProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<FullProvider | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [professionFilter, setProfessionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('all');
  const [agencyFilter, setAgencyFilter] = useState('all');
  
  
  // Sorting
  const [sortColumn, setSortColumn] = useState('full_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const userRole = roles.includes('admin') ? 'admin' : (roles[0] || 'provider');
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';

  // Agencies for filter and table display
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);
  const [podLeadMap, setPodLeadMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const fetchAgencies = async () => {
      const { data } = await supabase.from('agencies').select('id, name').eq('is_active', true).order('name');
      if (data) setAgencies(data);
    };
    fetchAgencies();
  }, []);

  // Build agency lookup map
  const agencyMap = useMemo(() => {
    const map = new Map<string, string>();
    agencies.forEach(a => map.set(a.id, a.name));
    return map;
  }, [agencies]);

  useEffect(() => {
    const fetchProviders = async () => {
      setLoading(true);
      
      if (isAdmin) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('full_name', { ascending: true });

        if (!error && data) {
          setProviders(data as FullProvider[]);
          
          // Build pod lead name lookup from unique pod_lead_ids
          const podLeadIds = [...new Set(data.map((p: any) => p.pod_lead_id).filter(Boolean))] as string[];
          if (podLeadIds.length > 0) {
            const { data: leads } = await supabase
              .from('profiles')
              .select('id, full_name')
              .in('id', podLeadIds);
            if (leads) {
              const map = new Map<string, string>();
              leads.forEach((l: any) => map.set(l.id, l.full_name || l.id));
              setPodLeadMap(map);
            }
          }
        }
      }
      
      // Always fetch public directory for the directory tab
      const { data: publicData, error: publicError } = await supabase
        .from('provider_directory_public')
        .select('*')
        .order('full_name', { ascending: true });

      if (!publicError && publicData) {
        setPublicProviders(publicData as DirectoryProvider[]);
      }
      
      setLoading(false);
    };

    fetchProviders();
  }, [isAdmin]);

  // Provider → set of licensed state abbreviations, derived from
  // provider_state_status (the source of truth that replaced the old
  // actively_licensed_states column on profiles).
  const { data: providerStateMap } = useQuery({
    queryKey: ['provider_directory_state_map'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_state_status')
        .select('provider_id, state_abbreviation');
      if (error) throw error;
      const map = new Map<string, Set<string>>();
      for (const row of data ?? []) {
        if (!row.state_abbreviation || !row.provider_id) continue;
        if (!map.has(row.provider_id)) map.set(row.provider_id, new Set());
        map.get(row.provider_id)!.add(row.state_abbreviation);
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });

  // Medallion-sourced licensed states / languages for linked providers
  const { data: medallion } = useMedallionDirectoryData(isAdmin);
  const { data: external } = useExternalDirectoryData(isAdmin);
  const { data: pcpCoverage, isLoading: pcpCoverageLoading } = usePcpCoverage(isAdmin);

  // Provider readiness data for management tab



  // Extract unique values for filter dropdowns
  const { availableStates, availableProfessions } = useMemo(() => {
    const data = isAdmin ? providers : publicProviders;
    const states = new Set<string>();
    const professions = new Set<string>();

    // Pull state list from provider_state_status — the new source of truth.
    if (providerStateMap) {
      for (const stateSet of providerStateMap.values()) {
        for (const s of stateSet) states.add(s);
      }
    }

    data.forEach(p => {
      const prof = p.profession || p.credentials;
      if (prof) professions.add(prof);
    });

    return {
      availableStates: Array.from(states).sort(),
      availableProfessions: Array.from(professions).sort(),
    };
  }, [providers, publicProviders, isAdmin, providerStateMap]);

  // Filter and sort providers for directory view
  const filteredProviders = useMemo(() => {
    const data = isAdmin && activeTab === 'management' ? providers : publicProviders;
    
    let filtered = data.filter(p => {
      // Search filter
      const query = searchQuery.toLowerCase();
      if (query) {
        const name = (p.full_name || '').toLowerCase();
        const preferredName = (p.preferred_name || '').toLowerCase();
        const npi = (p.npi_number || '').toLowerCase();
        const email = isAdmin ? ((p as FullProvider).email || '').toLowerCase() : '';
        
        if (!name.includes(query) && !preferredName.includes(query) && !npi.includes(query) && !email.includes(query)) {
          return false;
        }
      }

      // State filter — derived from provider_state_status
      if (stateFilter !== 'all') {
        const providerStates = providerStateMap?.get(p.id);
        if (!providerStates || !providerStates.has(stateFilter)) {
          return false;
        }
      }

      // Profession filter
      if (professionFilter !== 'all') {
        const prof = (p.profession || p.credentials || '').toUpperCase();
        if (professionFilter === 'physician') {
          if (prof !== 'MD' && prof !== 'DO') return false;
        } else if (professionFilter === 'np') {
          if (prof !== 'NP' && prof !== 'APN') return false;
        } else if (professionFilter === 'lpc') {
          if (prof !== 'LPC' && prof !== 'LCSW') return false;
        } else {
          if (prof !== professionFilter.toUpperCase()) return false;
        }
      }

      // Status filter (admin only)
      if (isAdmin && statusFilter === 'hide_termed') {
        if (p.employment_status === 'termed') return false;
      } else if (isAdmin && statusFilter !== 'all') {
        if (p.employment_status !== statusFilter) return false;
      }

      // Employment type filter
      if (employmentTypeFilter !== 'all') {
        const empType = (p as FullProvider).employment_type || 'w2';
        if (empType !== employmentTypeFilter) return false;
      }

      // Agency filter
      if (agencyFilter !== 'all') {
        if ((p as FullProvider).agency_id !== agencyFilter) return false;
      }

      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      let aVal: string | null = null;
      let bVal: string | null = null;

      switch (sortColumn) {
        case 'full_name':
          aVal = a.full_name;
          bVal = b.full_name;
          break;
        case 'profession': {
          const normProf = (v: string | null | undefined) => {
            const val = (v || '').toUpperCase();
            if (val === 'MD' || val === 'DO') return 'PHYSICIAN';
            if (val === 'NP' || val === 'APN') return 'NURSE_PRACTITIONER';
            if (val === 'LPC' || val === 'LCSW') return 'THERAPIST';
            return val;
          };
          aVal = normProf(a.profession || a.credentials);
          bVal = normProf(b.profession || b.credentials);
          break;
        }
        case 'employment_status':
          aVal = a.employment_status;
          bVal = b.employment_status;
          break;
        case 'actively_licensed_states':
          aVal = '';
          bVal = '';
          break;
        default:
          aVal = a.full_name;
          bVal = b.full_name;
      }

      const aStr = (aVal || '').toLowerCase();
      const bStr = (bVal || '').toLowerCase();
      
      if (sortDirection === 'asc') {
        return aStr.localeCompare(bStr);
      }
      return bStr.localeCompare(aStr);
    });

    return filtered;
  }, [providers, publicProviders, isAdmin, activeTab, searchQuery, stateFilter, professionFilter, statusFilter, employmentTypeFilter, agencyFilter, sortColumn, sortDirection, providerStateMap]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setStateFilter('all');
    setProfessionFilter('all');
    setStatusFilter('active');
    setEmploymentTypeFilter('all');
    setAgencyFilter('all');
  };

  const hasActiveFilters = searchQuery !== '' || stateFilter !== 'all' || professionFilter !== 'all' || statusFilter !== 'active' || employmentTypeFilter !== 'all' || agencyFilter !== 'all';

  const getProviderInitials = (name: string | null) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-success/10 text-success">Active</Badge>;
      case 'inactive':
        return <Badge variant="secondary">Inactive</Badge>;
      case 'termed':
        return <Badge variant="destructive">Terminated</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  // Convert to table data format for directory view
  const tableData: ProviderTableData[] = filteredProviders.map(p => ({
    id: p.id,
    full_name: p.full_name,
    preferred_name: p.preferred_name,
    email: isAdmin ? (p as FullProvider).email : '',
    phone_number: isAdmin ? (p as FullProvider).phone_number : null,
    npi_number: p.npi_number,
    credentials: p.credentials,
    profession: p.profession,
    avatar_url: p.avatar_url,
    employment_status: p.employment_status,
    employment_type: (p as FullProvider).employment_type || null,
    agency_name: (p as FullProvider).agency_id ? (agencyMap.get((p as FullProvider).agency_id!) || null) : null,
    actively_licensed_states: (() => {
      const st = activeLicensedStates(medallion?.licensesByProfile.get(p.id));
      if (st.length) return st.join(', ');
      // Agency-imported providers: validated license rows only; incomplete inventories say so.
      const ext = !medallion?.byProfile.get(p.id) ? external?.byProfile.get(p.id) : undefined;
      if (ext) return `${summarizeLicenses(ext.licenses, ext.licenseInventory).label} · agency`;
      return null;
    })(),
    pcp_coverage: isAdmin
      ? pcpCellFor({ id: p.id, profession: p.profession, npi_number: p.npi_number }, pcpCoverageLoading ? undefined : pcpCoverage)
      : null,
    primary_specialty: p.primary_specialty,
    address_state: isAdmin ? (p as FullProvider).address_state : (p as DirectoryProvider).address_state,
    has_collaborative_agreements: isAdmin ? (p as FullProvider).has_collaborative_agreements : null,
    activation_status: isAdmin ? ((p as any).activation_status || null) : null,
    collaborative_physician: null, // Derived from collaborative_agreements now
    renewal_handling: isAdmin ? ((p as any).renewal_handling || null) : null,
    languages: isAdmin ? (medallion?.byProfile.get(p.id)?.languages?.join(', ') || (p as any).languages || null) : null,
    pod_name: null,
    pod_lead_id: isAdmin ? ((p as any).pod_lead_id || null) : null,
    pod_lead_name: isAdmin ? (podLeadMap.get((p as any).pod_lead_id) || null) : null,
    medallion_conflicts: isAdmin
      ? (directoryMedallionConflicts(p.id, medallion?.byProfile.get(p.id)?.conflicts ?? []).map(c => `${c.field.replace(/_/g, ' ')}: ours ${c.local ?? '—'}, Medallion ${c.medallion ?? '—'}`).join('; ') || null)
      : null,
  }));

  const handleRowClick = (provider: ProviderTableData) => {
    if (isAdmin) {
      const fullProvider = providers.find(p => p.id === provider.id);
      if (fullProvider) setSelectedProvider(fullProvider);
    }
  };

  const flaggedProviders = isAdmin ? providers
    .filter(p => !['termed', 'terminated'].includes((p.employment_status ?? '').toLowerCase()))
    .map(p => ({ id: p.id, name: directoryDisplayName(p), conflicts: directoryMedallionConflicts(p.id, medallion?.byProfile.get(p.id)?.conflicts ?? []) }))
    .filter(p => p.conflicts.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name)) : [];

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole as any}
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={profile?.avatar_url || undefined}
      />

      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Providers</h1>
                <p className="text-muted-foreground">
                  {isAdmin 
                    ? `${providers.length} total • ${providers.filter(p => p.employment_status === 'active').length} active`
                    : `${publicProviders.length} colleagues`
                  }
                </p>
              </div>
            </div>

            {isAdmin && (
              <Button onClick={() => navigate('/admin/add-provider')}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            )}
          </div>

          {/* Tabs for Admin */}
          {isAdmin && <ProviderFlagAlerts providers={flaggedProviders} onReview={id => {
            const provider = providers.find(p => p.id === id);
            if (provider) setSelectedProvider(provider);
          }} />}
          {isAdmin ? (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList>
                <TabsTrigger value="directory" className="gap-2">
                  <Users className="h-4 w-4" />
                  Directory
                </TabsTrigger>
                <TabsTrigger value="management" className="gap-2">
                  <Shield className="h-4 w-4" />
                  Supervision
                </TabsTrigger>
                <TabsTrigger value="medallion" className="gap-2">
                  <Activity className="h-4 w-4" />
                  Medallion sync
                </TabsTrigger>
                <TabsTrigger value="agency-import" className="gap-2">
                  <Upload className="h-4 w-4" />
                  Agency import
                </TabsTrigger>
              </TabsList>

              {/* Supervision Tab - Medallion agreements across all providers */}
              <TabsContent value="management" className="space-y-6">
                <SupervisionAgreementsTable />
              </TabsContent>

              <TabsContent value="agency-import">
                <ExternalImportPanel />
              </TabsContent>

              <TabsContent value="medallion">
                <MedallionSyncPanel
                  reviewProfiles={providers
                    .filter((p: any) => p.directory_visibility === 'review')
                    .map((p: any) => ({ id: p.id, full_name: p.full_name, email: p.email, directory_visibility_reason: p.directory_visibility_reason }))}
                />
              </TabsContent>

              {/* Directory Tab - Contact/Profile focused view */}
              <TabsContent value="directory" className="space-y-6">
                <div className="flex items-center justify-between">
                  <ProviderFilters
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    stateFilter={stateFilter}
                    onStateChange={setStateFilter}
                    professionFilter={professionFilter}
                    onProfessionChange={setProfessionFilter}
                    statusFilter={statusFilter}
                    onStatusChange={setStatusFilter}
                    employmentTypeFilter={employmentTypeFilter}
                    onEmploymentTypeChange={setEmploymentTypeFilter}
                    agencyFilter={agencyFilter}
                    onAgencyChange={setAgencyFilter}
                    availableStates={availableStates}
                    availableProfessions={availableProfessions}
                    availableAgencies={agencies}
                    onClearFilters={handleClearFilters}
                    hasActiveFilters={hasActiveFilters}
                  />

                  <div className="flex items-center gap-2">
                    <Button
                      variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                      size="icon"
                      aria-label="Table view"
                      aria-pressed={viewMode === 'table'}
                      title="Table view"
                      onClick={() => setViewMode('table')}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                      size="icon"
                      aria-label="Grid view"
                      aria-pressed={viewMode === 'grid'}
                      title="Grid view"
                      onClick={() => setViewMode('grid')}
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {loading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <Card key={i} className="animate-pulse">
                        <CardContent className="p-6">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-12 rounded-full bg-muted" />
                            <div className="space-y-2">
                              <div className="h-4 w-32 bg-muted rounded" />
                              <div className="h-3 w-24 bg-muted rounded" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : viewMode === 'table' ? (
                  <>
                  {isAdmin && <PcpCoverageStatus data={pcpCoverage ?? null} />}
                  <ProviderTable
                    providers={tableData}
                    onRowClick={handleRowClick}
                    isAdmin={isAdmin}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  </>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredProviders.map(provider => (
                      <Card 
                        key={provider.id} 
                        className="hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => isAdmin && setSelectedProvider(provider as FullProvider)}
                      >
                        <CardContent className="p-6">
                          <div className="flex items-start gap-4">
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={provider.avatar_url || undefined} />
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {getProviderInitials(provider.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-foreground truncate">
                                  {directoryDisplayName(provider)}
                                </h3>
                                {isAdmin && getStatusBadge(provider.employment_status)}
                              </div>
                              {(provider.profession || provider.credentials) && (
                                <p className="text-sm text-muted-foreground">{provider.profession || provider.credentials}</p>
                              )}
                              {provider.primary_specialty && (
                                <p className="text-xs text-muted-foreground">{provider.primary_specialty}</p>
                              )}
                              {provider.npi_number && (
                                <p className="text-xs text-muted-foreground mt-1 font-mono">NPI: {provider.npi_number}</p>
                              )}
              {/* Licensed states removed from profile - derived from provider_state_status */}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

            </Tabs>
          ) : (
            // Non-admin view - Just the directory
            <>
              <div className="flex items-center justify-between mb-6">
                <ProviderFilters
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  stateFilter={stateFilter}
                  onStateChange={setStateFilter}
                  professionFilter={professionFilter}
                  onProfessionChange={setProfessionFilter}
                  statusFilter={statusFilter}
                  onStatusChange={setStatusFilter}
                  employmentTypeFilter={employmentTypeFilter}
                  onEmploymentTypeChange={setEmploymentTypeFilter}
                  agencyFilter={agencyFilter}
                  onAgencyChange={setAgencyFilter}
                  availableStates={availableStates}
                  availableProfessions={availableProfessions}
                  availableAgencies={agencies}
                  onClearFilters={handleClearFilters}
                  hasActiveFilters={hasActiveFilters}
                />

                <div className="flex items-center gap-2">
                  <Button
                    variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                    size="icon"
                    aria-label="Table view"
                    aria-pressed={viewMode === 'table'}
                    title="Table view"
                    onClick={() => setViewMode('table')}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
                    aria-label="Grid view"
                    aria-pressed={viewMode === 'grid'}
                    title="Grid view"
                    onClick={() => setViewMode('grid')}
                  >
                    <Grid3X3 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <Card key={i} className="animate-pulse">
                      <CardContent className="p-6">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-full bg-muted" />
                          <div className="space-y-2">
                            <div className="h-4 w-32 bg-muted rounded" />
                            <div className="h-3 w-24 bg-muted rounded" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : viewMode === 'table' ? (
                <ProviderTable
                  providers={tableData}
                  onRowClick={handleRowClick}
                  isAdmin={false}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredProviders.map(provider => (
                    <Card 
                      key={provider.id} 
                      className="hover:shadow-md transition-shadow"
                    >
                      <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={provider.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {getProviderInitials(provider.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-foreground truncate">
                              {directoryDisplayName(provider)}
                            </h3>
                            {(provider.profession || provider.credentials) && (
                              <p className="text-sm text-muted-foreground">{provider.profession || provider.credentials}</p>
                            )}
                            {provider.primary_specialty && (
                              <p className="text-xs text-muted-foreground">{provider.primary_specialty}</p>
                            )}
              {/* Licensed states removed from profile */}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {isAdmin && (
        <ProviderDetailModal
          provider={selectedProvider}
          onClose={() => setSelectedProvider(null)}
        />
      )}
    </div>
  );
};

export default ProviderDirectoryPage;
