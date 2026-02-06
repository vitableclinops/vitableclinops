import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { DemandTagBadge } from '@/components/DemandTagBadge';
import { StateImportDialog } from '@/components/StateImportDialog';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { states as initialStates, providers, getAllTasks } from '@/data/mockData';
import { useAuth } from '@/hooks/useAuth';
import { 
  Search,
  MapPin,
  Shield,
  Users,
  DollarSign,
  Clock,
  Edit,
  Plus,
  FileText,
  Pill,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  X,
  Download,
  Upload,
  ShieldCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { State, DemandTag, Task, Provider } from '@/types';
import { toast } from 'sonner';

type FPAFilter = 'all' | 'fpa' | 'no-fpa';
type CAFilter = 'all' | 'ca-required' | 'no-ca';

const StateCompliancePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  
  const [activeMainTab, setActiveMainTab] = useState(tabParam === 'compliance' ? 'compliance' : 'states');
  
  // State Directory state
  const [states, setStates] = useState<State[]>(initialStates);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState<State | null>(null);
  const [filterDemand, setFilterDemand] = useState<DemandTag | 'all'>('all');
  const [filterFPA, setFilterFPA] = useState<FPAFilter>('all');
  const [filterCA, setFilterCA] = useState<CAFilter>('all');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Compliance state
  const [complianceSearchQuery, setComplianceSearchQuery] = useState('');
  const [complianceTab, setComplianceTab] = useState('overview');

  const { profile, roles } = useAuth();
  const userRole = roles[0] || 'admin';
  const userName = profile?.full_name || profile?.email || 'Admin User';
  const userEmail = profile?.email || '';

  // ========== State Directory Logic ==========
  const filteredStates = states.filter(state => {
    const matchesSearch = state.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      state.abbreviation.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDemand = filterDemand === 'all' || state.demandTag === filterDemand;
    const matchesFPA = filterFPA === 'all' || 
      (filterFPA === 'fpa' && state.hasFPA) || 
      (filterFPA === 'no-fpa' && !state.hasFPA);
    const matchesCA = filterCA === 'all' || 
      (filterCA === 'ca-required' && state.requiresCollaborativeAgreement) || 
      (filterCA === 'no-ca' && !state.requiresCollaborativeAgreement);
    return matchesSearch && matchesDemand && matchesFPA && matchesCA;
  });

  const activeFiltersCount = [filterDemand !== 'all', filterFPA !== 'all', filterCA !== 'all'].filter(Boolean).length;

  const clearAllFilters = () => {
    setSearchQuery('');
    setFilterDemand('all');
    setFilterFPA('all');
    setFilterCA('all');
  };

  const exportToCSV = () => {
    const headers = [
      'State', 'Abbreviation', 'Demand Tag', 'Has FPA', 'Requires Collaborative Agreement',
      'Meeting Cadence', 'Chart Review Required', 'Requires Prescriptive Authority',
      'Min Application Fee', 'Max Application Fee', 'Min Processing Weeks', 'Max Processing Weeks'
    ];

    const rows = filteredStates.map(state => [
      state.name, state.abbreviation, state.demandTag || '',
      state.hasFPA ? 'Yes' : 'No', state.requiresCollaborativeAgreement ? 'Yes' : 'No',
      state.collaborativeAgreementRequirements?.meetingCadence || '',
      state.collaborativeAgreementRequirements?.chartReviewRequired ? 'Yes' : 'No',
      state.requiresPrescriptiveAuthority ? 'Yes' : 'No',
      state.applicationFeeRange.min, state.applicationFeeRange.max,
      state.processingTimeWeeks.min, state.processingTimeWeeks.max
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `state-compliance-data-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImport = (importedStates: Partial<State>[]) => {
    setStates(prevStates => {
      const newStates = [...prevStates];
      importedStates.forEach(imported => {
        const existingIndex = newStates.findIndex(s => s.abbreviation.toLowerCase() === imported.abbreviation?.toLowerCase());
        if (existingIndex >= 0) {
          newStates[existingIndex] = { ...newStates[existingIndex], ...imported } as State;
        } else {
          newStates.push(imported as State);
        }
      });
      return newStates;
    });
    toast.success(`Successfully imported ${importedStates.length} states`);
  };

  const criticalStates = states.filter(s => s.demandTag === 'critical');
  const atRiskStates = states.filter(s => s.demandTag === 'at_risk');

  // ========== Compliance Logic ==========
  const allTasks = getAllTasks();
  const complianceTasks = allTasks.filter(t => t.category === 'compliance');
  
  const completedTasks = complianceTasks.filter(t => t.status === 'approved').length;
  const overdueTasks = complianceTasks.filter(t => 
    t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'approved'
  );
  const pendingTasks = complianceTasks.filter(t => 
    ['not_started', 'in_progress', 'submitted'].includes(t.status)
  );
  
  const compliantProviders = providers.filter(p => p.complianceStatus?.isCompliant);
  const nonCompliantProviders = providers.filter(p => !p.complianceStatus?.isCompliant);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
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
                <MapPin className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">States & Compliance</h1>
                <p className="text-muted-foreground">
                  State regulations and provider compliance tracking
                </p>
              </div>
            </div>
          </div>

          <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="space-y-6">
            <TabsList>
              <TabsTrigger value="states" className="gap-2">
                <MapPin className="h-4 w-4" />
                State Directory
              </TabsTrigger>
              <TabsTrigger value="compliance" className="gap-2">
                <ShieldCheck className="h-4 w-4" />
                Compliance
              </TabsTrigger>
            </TabsList>

            {/* State Directory Tab */}
            <TabsContent value="states" className="space-y-6">
              {/* Actions */}
              <div className="flex items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Import CSV
                </Button>
                <Button variant="outline" onClick={exportToCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add State
                </Button>
              </div>

              <StateImportDialog
                open={importDialogOpen}
                onOpenChange={setImportDialogOpen}
                onImport={handleImport}
                existingStates={states}
              />

              {/* Priority states alerts */}
              {(criticalStates.length > 0 || atRiskStates.length > 0) && (
                <div className="grid gap-4 md:grid-cols-2">
                  {criticalStates.length > 0 && (
                    <Card className="border-destructive/30 bg-destructive/5">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                          <div className="flex-1">
                            <p className="font-medium text-foreground">Critical Priority States</p>
                            <p className="text-sm text-muted-foreground">{criticalStates.map(s => s.abbreviation).join(', ')}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {atRiskStates.length > 0 && (
                    <Card className="border-warning/30 bg-warning/5">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 text-warning" />
                          <div className="flex-1">
                            <p className="font-medium text-foreground">At Risk States</p>
                            <p className="text-sm text-muted-foreground">{atRiskStates.map(s => s.abbreviation).join(', ')}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              <div className="grid gap-8 lg:grid-cols-3">
                {/* States list */}
                <div className="lg:col-span-2">
                  {/* Filters */}
                  <div className="space-y-4 mb-6">
                    <div className="flex items-center gap-4">
                      <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search states..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      {activeFiltersCount > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-muted-foreground">
                          <X className="h-4 w-4 mr-1" />
                          Clear filters ({activeFiltersCount})
                        </Button>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-3">
                      <Select value={filterDemand} onValueChange={(v) => setFilterDemand(v as DemandTag | 'all')}>
                        <SelectTrigger className="w-[150px]">
                          <SelectValue placeholder="Demand" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Demand</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                          <SelectItem value="at_risk">At Risk</SelectItem>
                          <SelectItem value="watch">Watch</SelectItem>
                          <SelectItem value="stable">Stable</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={filterFPA} onValueChange={(v) => setFilterFPA(v as FPAFilter)}>
                        <SelectTrigger className="w-[170px]">
                          <SelectValue placeholder="FPA Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All FPA Status</SelectItem>
                          <SelectItem value="fpa">FPA Available</SelectItem>
                          <SelectItem value="no-fpa">No FPA</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={filterCA} onValueChange={(v) => setFilterCA(v as CAFilter)}>
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="CA Requirements" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All CA Status</SelectItem>
                          <SelectItem value="ca-required">CA Required</SelectItem>
                          <SelectItem value="no-ca">No CA Required</SelectItem>
                        </SelectContent>
                      </Select>

                      <span className="text-sm text-muted-foreground ml-2">
                        {filteredStates.length} of {states.length} states
                      </span>
                    </div>
                  </div>

                  {/* States grid */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredStates.map(state => (
                      <Link key={state.id} to={`/states/${state.abbreviation}`} className="block">
                        <Card 
                          className={cn(
                            'card-interactive cursor-pointer group h-full',
                            selectedState?.id === state.id && 'ring-2 ring-primary'
                          )}
                          onClick={(e) => { e.preventDefault(); setSelectedState(state); }}
                        >
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  'flex h-12 w-12 items-center justify-center rounded-lg text-lg font-bold',
                                  state.hasFPA ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
                                )}>
                                  {state.abbreviation}
                                </div>
                                <div>
                                  <CardTitle className="text-lg">{state.name}</CardTitle>
                                  <div className="flex items-center gap-2 mt-1">
                                    {state.demandTag && <DemandTagBadge tag={state.demandTag} size="sm" />}
                                  </div>
                                </div>
                              </div>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                              {state.hasFPA ? (
                                <Badge className="text-xs bg-success/10 text-success border-0">
                                  <Shield className="h-3 w-3 mr-1" />
                                  FPA Available
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">
                                  <Users className="h-3 w-3 mr-1" />
                                  Collaboration Required
                                </Badge>
                              )}
                              {state.requiresPrescriptiveAuthority && (
                                <Badge variant="outline" className="text-xs">
                                  <Pill className="h-3 w-3 mr-1" />
                                  Separate Rx Authority
                                </Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <DollarSign className="h-4 w-4" />
                                <span>${state.applicationFeeRange.min} - ${state.applicationFeeRange.max}</span>
                              </div>
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                <span>{state.processingTimeWeeks.min}-{state.processingTimeWeeks.max} weeks</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>

                  {filteredStates.length === 0 && (
                    <Card className="border-dashed">
                      <CardContent className="py-12 text-center">
                        <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                        <p className="text-muted-foreground">No states found matching your criteria</p>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* State detail panel */}
                <div>
                  {selectedState ? (
                    <Card className="sticky top-8">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg flex items-center gap-2">
                            {selectedState.name}
                            <Badge variant="secondary">{selectedState.abbreviation}</Badge>
                          </CardTitle>
                          <Button variant="outline" size="sm" onClick={() => navigate(`/states/${selectedState.abbreviation}`)}>
                            View Full
                          </Button>
                        </div>
                        {selectedState.demandTag && <DemandTagBadge tag={selectedState.demandTag} className="mt-2" />}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="text-sm text-muted-foreground">
                          <p><strong>FPA:</strong> {selectedState.hasFPA ? 'Available' : 'Not Available'}</p>
                          <p><strong>Collab Required:</strong> {selectedState.requiresCollaborativeAgreement ? 'Yes' : 'No'}</p>
                          <p><strong>Rx Authority:</strong> {selectedState.requiresPrescriptiveAuthority ? 'Separate' : 'Included'}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="border-dashed">
                      <CardContent className="py-12 text-center">
                        <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                        <p className="text-muted-foreground">Select a state to view details</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Compliance Tab */}
            <TabsContent value="compliance" className="space-y-6">
              {/* Stats Grid */}
              <div className="grid gap-4 md:grid-cols-4">
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

              {/* Compliance Sub-tabs */}
              <Tabs value={complianceTab} onValueChange={setComplianceTab}>
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
                                  <div key={task.id} className="flex items-center gap-4 p-4 rounded-lg border bg-destructive/5 border-destructive/20">
                                    <Avatar className="h-10 w-10">
                                      <AvatarFallback className="bg-destructive/10 text-destructive text-sm">
                                        {provider ? getInitials(provider.firstName, provider.lastName) : '??'}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                      <span className="font-medium text-foreground">{provider?.firstName} {provider?.lastName}</span>
                                      <p className="text-sm text-muted-foreground truncate">{task.title}</p>
                                    </div>
                                    <Badge variant="destructive" className="text-xs">{daysPastDue} days overdue</Badge>
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

                    <div>
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">Non-Compliant Providers</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {nonCompliantProviders.length > 0 ? (
                            nonCompliantProviders.map(provider => (
                              <div key={provider.id} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 cursor-pointer hover:bg-destructive/10 transition-colors">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="bg-destructive/20 text-destructive text-xs">
                                    {getInitials(provider.firstName, provider.lastName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground">{provider.firstName} {provider.lastName}</p>
                                  <p className="text-xs text-muted-foreground">{provider.complianceStatus?.overdueTasks} overdue</p>
                                </div>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground text-center py-4">All providers are compliant</p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="tasks">
                  <div className="relative max-w-md mb-6">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search compliance tasks..."
                      value={complianceSearchQuery}
                      onChange={(e) => setComplianceSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  <div className="space-y-3">
                    {complianceTasks.map(task => {
                      const provider = providers.find(p => p.id === task.providerId);
                      const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'approved';
                      
                      return (
                        <div key={task.id} className={cn(
                          'flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer group',
                          isOverdue && 'border-destructive/20 bg-destructive/5'
                        )}>
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className="bg-primary/10 text-primary text-sm">
                              {provider ? getInitials(provider.firstName, provider.lastName) : '??'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-foreground">{task.title}</span>
                              {task.complianceTaskType && (
                                <Badge variant="secondary" className="text-xs capitalize">{task.complianceTaskType.replace(/_/g, ' ')}</Badge>
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
                          <StatusBadge status={task.status} size="sm" />
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="providers">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {providers.map(provider => {
                      const status = provider.complianceStatus;
                      const completionPct = status ? Math.round((status.completedTasks / status.totalTasks) * 100) : 0;
                      
                      return (
                        <Card key={provider.id} className={cn(
                          'card-interactive cursor-pointer',
                          status?.isCompliant && 'border-success/30',
                          !status?.isCompliant && status?.overdueTasks && status.overdueTasks > 0 && 'border-destructive/30'
                        )}>
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
                                <p className="font-medium text-foreground">{provider.firstName} {provider.lastName}</p>
                                <p className="text-xs text-muted-foreground">{provider.specialty}</p>
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
                              <Progress value={completionPct} className={cn('h-2', status?.isCompliant && '[&>div]:bg-success')} />
                              {status?.overdueTasks && status.overdueTasks > 0 && (
                                <p className="text-xs text-destructive">{status.overdueTasks} overdue task{status.overdueTasks !== 1 ? 's' : ''}</p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default StateCompliancePage;
