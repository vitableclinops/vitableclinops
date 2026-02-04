import { useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { DemandTagBadge } from '@/components/DemandTagBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { states } from '@/data/mockData';
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
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { State, DemandTag } from '@/types';

const StateConfigPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState<State | null>(null);
  const [filterDemand, setFilterDemand] = useState<DemandTag | 'all'>('all');

  const filteredStates = states.filter(state => {
    const matchesSearch = state.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      state.abbreviation.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDemand = filterDemand === 'all' || state.demandTag === filterDemand;
    return matchesSearch && matchesDemand;
  });

  // Group states by demand tag
  const criticalStates = states.filter(s => s.demandTag === 'critical');
  const atRiskStates = states.filter(s => s.demandTag === 'at_risk');

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar 
        userRole="admin"
        userName="Sarah Chen"
        userEmail="sarah.chen@example.com"
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
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add State
            </Button>
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
              <div className="flex items-center gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search states..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant={filterDemand === 'all' ? 'secondary' : 'ghost'} 
                    size="sm"
                    onClick={() => setFilterDemand('all')}
                  >
                    All
                  </Button>
                  <Button 
                    variant={filterDemand === 'critical' ? 'secondary' : 'ghost'} 
                    size="sm"
                    onClick={() => setFilterDemand('critical')}
                    className="text-destructive"
                  >
                    Critical
                  </Button>
                  <Button 
                    variant={filterDemand === 'at_risk' ? 'secondary' : 'ghost'} 
                    size="sm"
                    onClick={() => setFilterDemand('at_risk')}
                    className="text-warning"
                  >
                    At Risk
                  </Button>
                </div>
              </div>

              {/* States grid */}
              <div className="grid gap-4 md:grid-cols-2">
                {filteredStates.map(state => (
                  <Card 
                    key={state.id} 
                    className={cn(
                      'card-interactive cursor-pointer group',
                      selectedState?.id === state.id && 'ring-2 ring-primary'
                    )}
                    onClick={() => setSelectedState(state)}
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
