import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { DemandTagBadge } from '@/components/DemandTagBadge';
import { StateImportDialog } from '@/components/StateImportDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { states as initialStates } from '@/data/mockData';
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
  Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { State, DemandTag } from '@/types';
import { toast } from 'sonner';

type FPAFilter = 'all' | 'fpa' | 'no-fpa';
type CAFilter = 'all' | 'ca-required' | 'no-ca';

const StateConfigPage = () => {
  const [states, setStates] = useState<State[]>(initialStates);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState<State | null>(null);
  const [filterDemand, setFilterDemand] = useState<DemandTag | 'all'>('all');
  const [filterFPA, setFilterFPA] = useState<FPAFilter>('all');
  const [filterCA, setFilterCA] = useState<CAFilter>('all');
  const [importDialogOpen, setImportDialogOpen] = useState(false);

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
      'State',
      'Abbreviation',
      'Demand Tag',
      'Has FPA',
      'Requires Collaborative Agreement',
      'Meeting Cadence',
      'Chart Review Required',
      'Requires Prescriptive Authority',
      'Min Application Fee',
      'Max Application Fee',
      'Min Processing Weeks',
      'Max Processing Weeks'
    ];

    const rows = filteredStates.map(state => [
      state.name,
      state.abbreviation,
      state.demandTag || '',
      state.hasFPA ? 'Yes' : 'No',
      state.requiresCollaborativeAgreement ? 'Yes' : 'No',
      state.collaborativeAgreementRequirements?.meetingCadence || '',
      state.collaborativeAgreementRequirements?.chartReviewRequired ? 'Yes' : 'No',
      state.requiresPrescriptiveAuthority ? 'Yes' : 'No',
      state.applicationFeeRange.min,
      state.applicationFeeRange.max,
      state.processingTimeWeeks.min,
      state.processingTimeWeeks.max
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `state-compliance-data-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImport = (importedStates: Partial<State>[]) => {
    setStates(prevStates => {
      const newStates = [...prevStates];
      importedStates.forEach(imported => {
        const existingIndex = newStates.findIndex(
          s => s.abbreviation.toLowerCase() === imported.abbreviation?.toLowerCase()
        );
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

  // Group states by demand tag
  const criticalStates = states.filter(s => s.demandTag === 'critical');
  const atRiskStates = states.filter(s => s.demandTag === 'at_risk');

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
                State Compliance Directory
              </h1>
              <p className="text-muted-foreground mt-1">
                Centralized regulatory intelligence for all U.S. states.
              </p>
            </div>
            <div className="flex items-center gap-3">
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
          </div>

          {/* Priority states alerts */}
          {(criticalStates.length > 0 || atRiskStates.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2 mb-8">
              {criticalStates.length > 0 && (
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      <div className="flex-1">
                        <p className="font-medium text-foreground">Critical Priority States</p>
                        <p className="text-sm text-muted-foreground">
                          {criticalStates.map(s => s.abbreviation).join(', ')}
                        </p>
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
                        <p className="text-sm text-muted-foreground">
                          {atRiskStates.map(s => s.abbreviation).join(', ')}
                        </p>
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
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={clearAllFilters}
                      className="text-muted-foreground"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Clear filters ({activeFiltersCount})
                    </Button>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  {/* Demand Tag Filter */}
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

                  {/* FPA Filter */}
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

                  {/* CA Filter */}
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
                  <Link
                    key={state.id}
                    to={`/states/${state.abbreviation}`}
                    className="block"
                  >
                    <Card 
                      className={cn(
                        'card-interactive cursor-pointer group h-full',
                        selectedState?.id === state.id && 'ring-2 ring-primary'
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedState(state);
                      }}
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
                                {state.demandTag && (
                                  <DemandTagBadge tag={state.demandTag} size="sm" />
                                )}
                              </div>
                            </div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              console.log('Edit state:', state.id);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Key requirements badges */}
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

                        {/* Stats */}
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
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                    </div>
                    {selectedState.demandTag && (
                      <DemandTagBadge tag={selectedState.demandTag} className="mt-2" />
                    )}
                    {selectedState.demandNotes && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {selectedState.demandNotes}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Collaboration requirements */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Collaboration Requirements
                      </h4>
                      {selectedState.requiresCollaborativeAgreement ? (
                        <div className="space-y-2 text-sm">
                          <Badge variant="outline" className="text-warning border-warning/30">
                            Collaborative Agreement Required
                          </Badge>
                          {selectedState.collaborativeAgreementRequirements && (
                            <div className="mt-3 space-y-2 text-muted-foreground">
                              <p>
                                <span className="font-medium text-foreground">Meeting cadence:</span>{' '}
                                <span className="capitalize">{selectedState.collaborativeAgreementRequirements.meetingCadence}</span>
                              </p>
                              {selectedState.collaborativeAgreementRequirements.chartReviewRequired && (
                                <p>
                                  <span className="font-medium text-foreground">Chart review:</span>{' '}
                                  {selectedState.collaborativeAgreementRequirements.chartReviewFrequency}
                                </p>
                              )}
                              {selectedState.collaborativeAgreementRequirements.supervisoryActivities.length > 0 && (
                                <div>
                                  <span className="font-medium text-foreground">Required activities:</span>
                                  <ul className="list-disc list-inside mt-1">
                                    {selectedState.collaborativeAgreementRequirements.supervisoryActivities.map((activity, i) => (
                                      <li key={i}>{activity}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <Badge className="bg-success/10 text-success border-0">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Not Required
                        </Badge>
                      )}
                    </div>

                    <Separator />

                    {/* FPA */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Full Practice Authority
                      </h4>
                      {selectedState.hasFPA ? (
                        <div className="space-y-2 text-sm">
                          <Badge className="bg-success/10 text-success border-0">
                            FPA Available
                          </Badge>
                          {selectedState.fpaEligibilityCriteria && selectedState.fpaEligibilityCriteria.length > 0 && (
                            <div className="mt-3">
                              <span className="text-xs font-medium text-foreground">Eligibility Criteria:</span>
                              <ul className="list-disc list-inside mt-1 text-muted-foreground">
                                {selectedState.fpaEligibilityCriteria.map((criteria, i) => (
                                  <li key={i}>{criteria}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {selectedState.fpaApplicationRequired && (
                            <p className="text-muted-foreground mt-2">
                              <Info className="h-4 w-4 inline mr-1" />
                              Separate FPA application required
                            </p>
                          )}
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not Available
                        </Badge>
                      )}
                    </div>

                    <Separator />

                    {/* Prescriptive Authority */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Pill className="h-4 w-4" />
                        Prescriptive Authority
                      </h4>
                      {selectedState.requiresPrescriptiveAuthority ? (
                        <div className="space-y-2 text-sm">
                          <Badge variant="outline" className="text-warning border-warning/30">
                            Separate License Required
                          </Badge>
                          {selectedState.prescriptiveAuthorityNotes && (
                            <p className="text-muted-foreground mt-2">
                              {selectedState.prescriptiveAuthorityNotes}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Badge className="bg-success/10 text-success border-0">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Included with NP License
                        </Badge>
                      )}
                    </div>

                    {/* Scope limitations */}
                    {selectedState.scopeLimitations && selectedState.scopeLimitations.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            Scope Limitations
                          </h4>
                          <ul className="list-disc list-inside text-sm text-muted-foreground">
                            {selectedState.scopeLimitations.map((limitation, i) => (
                              <li key={i}>{limitation}</li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}

                    {/* Special considerations */}
                    {selectedState.specialConsiderations && selectedState.specialConsiderations.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                            <Info className="h-4 w-4" />
                            Special Considerations
                          </h4>
                          <ul className="list-disc list-inside text-sm text-muted-foreground">
                            {selectedState.specialConsiderations.map((consideration, i) => (
                              <li key={i}>{consideration}</li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}

                    {/* General notes */}
                    {selectedState.notes && (
                      <>
                        <Separator />
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Notes</h4>
                          <p className="text-sm text-muted-foreground">{selectedState.notes}</p>
                        </div>
                      </>
                    )}

                    {/* Last updated */}
                    {selectedState.lastUpdated && (
                      <p className="text-xs text-muted-foreground pt-4 border-t">
                        Last updated: {new Date(selectedState.lastUpdated).toLocaleDateString()}
                      </p>
                    )}
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
        </div>
      </main>
    </div>
  );
};

export default StateConfigPage;
