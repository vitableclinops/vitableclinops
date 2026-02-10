import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, Grid3X3, List, MapPin, Shield, AlertTriangle, Clock, UserPlus, MoreHorizontal, Edit, Eye, ChevronRight, Search, CheckCircle2 } from 'lucide-react';
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
import { ManagementTable } from '@/components/directory/ManagementTable';
import { useProviderReadiness } from '@/hooks/useProviderReadiness';
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
  home_address: string | null;
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
  actively_licensed_states: string | null;
  medallion_id: string | null;
  chart_review_folder_url: string | null;
  created_at: string;
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
  actively_licensed_states: string | null;
  address_state: string | null;
}

const ProviderDirectoryPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile, roles } = useAuth();
  
  // Determine initial tab from URL or default based on role
  const tabParam = searchParams.get('tab');
  const isAdmin = roles.includes('admin');
  const defaultTab = isAdmin ? (tabParam === 'directory' ? 'directory' : 'management') : 'directory';
  
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
  const [statusFilter, setStatusFilter] = useState('hide_termed');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('all');
  const [agencyFilter, setAgencyFilter] = useState('all');
  
  
  // Sorting
  const [sortColumn, setSortColumn] = useState('full_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const userRole = roles[0] || 'provider';
  const userName = profile?.full_name || profile?.email || 'User';
  const userEmail = profile?.email || '';

  // Agencies for filter and table display
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);

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

  // Provider readiness data for management tab
  const { data: readinessData, isLoading: readinessLoading } = useProviderReadiness();


  // Extract unique values for filter dropdowns
  const { availableStates, availableProfessions } = useMemo(() => {
    const data = isAdmin ? providers : publicProviders;
    const states = new Set<string>();
    const professions = new Set<string>();

    data.forEach(p => {
      const statesField = isAdmin ? (p as FullProvider).actively_licensed_states : (p as DirectoryProvider).actively_licensed_states;
      if (statesField) {
        statesField.split(',').forEach(s => {
          const trimmed = s.trim();
          if (trimmed && trimmed.length === 2) states.add(trimmed);
        });
      }
      const prof = p.profession || p.credentials;
      if (prof) professions.add(prof);
    });

    return {
      availableStates: Array.from(states).sort(),
      availableProfessions: Array.from(professions).sort(),
    };
  }, [providers, publicProviders, isAdmin]);

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

      // State filter
      if (stateFilter !== 'all') {
        const statesField = isAdmin ? (p as FullProvider).actively_licensed_states : (p as DirectoryProvider).actively_licensed_states;
        if (!statesField?.includes(stateFilter)) return false;
      }

      // Profession filter
      if (professionFilter !== 'all') {
        const prof = p.profession || p.credentials;
        if (prof !== professionFilter) return false;
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
        case 'profession':
          aVal = a.profession || a.credentials;
          bVal = b.profession || b.credentials;
          break;
        case 'employment_status':
          aVal = a.employment_status;
          bVal = b.employment_status;
          break;
        case 'actively_licensed_states':
          aVal = isAdmin ? (a as FullProvider).actively_licensed_states : (a as DirectoryProvider).actively_licensed_states;
          bVal = isAdmin ? (b as FullProvider).actively_licensed_states : (b as DirectoryProvider).actively_licensed_states;
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
  }, [providers, publicProviders, isAdmin, activeTab, searchQuery, stateFilter, professionFilter, statusFilter, employmentTypeFilter, agencyFilter, sortColumn, sortDirection]);

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
    setStatusFilter('hide_termed');
    setEmploymentTypeFilter('all');
    setAgencyFilter('all');
  };

  const hasActiveFilters = searchQuery !== '' || stateFilter !== 'all' || professionFilter !== 'all' || statusFilter !== 'hide_termed' || employmentTypeFilter !== 'all' || agencyFilter !== 'all';

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
    actively_licensed_states: isAdmin ? (p as FullProvider).actively_licensed_states : (p as DirectoryProvider).actively_licensed_states,
    primary_specialty: p.primary_specialty,
    address_state: isAdmin ? (p as FullProvider).address_state : (p as DirectoryProvider).address_state,
    has_collaborative_agreements: isAdmin ? (p as FullProvider).has_collaborative_agreements : null,
  }));

  const handleRowClick = (provider: ProviderTableData) => {
    if (isAdmin) {
      const fullProvider = providers.find(p => p.id === provider.id);
      if (fullProvider) setSelectedProvider(fullProvider);
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
          {isAdmin ? (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList>
                <TabsTrigger value="management" className="gap-2">
                  <Shield className="h-4 w-4" />
                  Management
                </TabsTrigger>
                <TabsTrigger value="directory" className="gap-2">
                  <Users className="h-4 w-4" />
                  Directory
                </TabsTrigger>
              </TabsList>

              {/* Management Tab - Real data driven */}
              <TabsContent value="management" className="space-y-6">
                {readinessLoading ? (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      Loading provider readiness data...
                    </CardContent>
                  </Card>
                ) : (
                  <ManagementTable
                    providers={readinessData || []}
                    agencyMap={agencyMap}
                  />
                )}
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
                      onClick={() => setViewMode('table')}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                      size="icon"
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
                    isAdmin={isAdmin}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
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
                                  {provider.preferred_name || provider.full_name || 'Unknown'}
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
                              {(isAdmin ? (provider as FullProvider).actively_licensed_states : (provider as DirectoryProvider).actively_licensed_states) && (
                                <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                                  <MapPin className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">
                                    {isAdmin ? (provider as FullProvider).actively_licensed_states : (provider as DirectoryProvider).actively_licensed_states}
                                  </span>
                                </div>
                              )}
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
                    onClick={() => setViewMode('table')}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
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
                              {provider.preferred_name || provider.full_name || 'Unknown'}
                            </h3>
                            {(provider.profession || provider.credentials) && (
                              <p className="text-sm text-muted-foreground">{provider.profession || provider.credentials}</p>
                            )}
                            {provider.primary_specialty && (
                              <p className="text-xs text-muted-foreground">{provider.primary_specialty}</p>
                            )}
                            {(provider as DirectoryProvider).actively_licensed_states && (
                              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{(provider as DirectoryProvider).actively_licensed_states}</span>
                              </div>
                            )}
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
