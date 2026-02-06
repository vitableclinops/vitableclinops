import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Search, MapPin, Check, Ban, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { allUSStatesSorted } from '@/data/allStates';
import { useAuth } from '@/hooks/useAuth';
import { isNPProhibitedState, getCollabRequirementType } from '@/constants/stateRestrictions';
import type { ProviderType } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PendingApplication {
  stateAbbr: string;
  submittedDate?: string;
  expectedTimeline?: string;
  notes?: string;
}

interface StateSelectionStepProps {
  selectedStates: string[];
  onUpdate: (states: string[]) => void;
  providerType?: ProviderType | null;
  pendingApplications?: PendingApplication[];
  onPendingApplicationsUpdate?: (applications: PendingApplication[]) => void;
  showPendingOption?: boolean;
}

export function StateSelectionStep({ 
  selectedStates, 
  onUpdate, 
  providerType,
  pendingApplications = [],
  onPendingApplicationsUpdate,
  showPendingOption = true,
}: StateSelectionStepProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isApplyingForNew, setIsApplyingForNew] = useState(pendingApplications.length > 0);
  const { hasRole } = useAuth();
  
  const isProvider = hasRole('provider') && !hasRole('admin') && !hasRole('leadership');
  const isNPProvider = providerType === 'nurse_practitioner';

  // Get states that are prohibited for NPs
  const prohibitedStates = useMemo(() => {
    if (!isNPProvider) return new Set<string>();
    return new Set(allUSStatesSorted
      .filter(s => isNPProhibitedState(s.abbreviation))
      .map(s => s.abbreviation));
  }, [isNPProvider]);

  const filteredStates = allUSStatesSorted.filter(state =>
    state.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    state.abbreviation.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleState = (stateAbbr: string) => {
    // Prevent selecting prohibited states for NPs
    if (prohibitedStates.has(stateAbbr)) return;
    
    if (selectedStates.includes(stateAbbr)) {
      onUpdate(selectedStates.filter(s => s !== stateAbbr));
    } else {
      onUpdate([...selectedStates, stateAbbr]);
    }
  };

  const togglePendingApplication = (stateAbbr: string) => {
    if (!onPendingApplicationsUpdate) return;
    
    // Prevent prohibited states for NPs
    if (prohibitedStates.has(stateAbbr)) return;
    
    const exists = pendingApplications.some(p => p.stateAbbr === stateAbbr);
    if (exists) {
      onPendingApplicationsUpdate(pendingApplications.filter(p => p.stateAbbr !== stateAbbr));
    } else {
      onPendingApplicationsUpdate([...pendingApplications, { stateAbbr }]);
    }
  };

  const selectAll = () => {
    const selectableStates = allUSStatesSorted
      .filter(s => !prohibitedStates.has(s.abbreviation))
      .map(s => s.abbreviation);
    onUpdate(selectableStates);
  };

  const clearAll = () => {
    onUpdate([]);
  };

  const getCollabBadge = (stateAbbr: string) => {
    const type = getCollabRequirementType(stateAbbr);
    switch (type) {
      case 'always':
        return (
          <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
            Collab Required
          </Badge>
        );
      case 'conditional':
        return (
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">
            FPA Review
          </Badge>
        );
      default:
        return null;
    }
  };

  const pendingStateAbbrs = new Set(pendingApplications.map(p => p.stateAbbr));
  const selectableCount = allUSStatesSorted.filter(s => !prohibitedStates.has(s.abbreviation)).length;

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <MapPin className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Select States Where You Are Licensed</h2>
        <p className="text-muted-foreground mt-2">
          Choose the states where you currently hold an active license. You can add more later.
        </p>
      </div>

      {isNPProvider && prohibitedStates.size > 0 && (
        <Alert variant="destructive">
          <Ban className="h-4 w-4" />
          <AlertDescription>
            Some states do not allow NPs to practice independently. These states are disabled below.
          </AlertDescription>
        </Alert>
      )}

      {/* Search and bulk actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search states..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={selectAll}
            className="text-primary hover:underline"
          >
            Select All
          </button>
          <span className="text-muted-foreground">|</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Selected count */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="font-normal">
          {selectedStates.length} of {selectableCount} states selected
        </Badge>
        {pendingApplications.length > 0 && (
          <Badge variant="outline" className="font-normal">
            {pendingApplications.length} pending application{pendingApplications.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* State grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-h-[400px] overflow-y-auto pr-2">
        {filteredStates.map(state => {
          const isSelected = selectedStates.includes(state.abbreviation);
          const isProhibited = prohibitedStates.has(state.abbreviation);
          const isPendingApp = pendingStateAbbrs.has(state.abbreviation);
          
          return (
            <Card
              key={state.abbreviation}
              className={cn(
                'transition-all',
                isProhibited 
                  ? 'opacity-50 cursor-not-allowed bg-muted' 
                  : 'cursor-pointer hover:shadow-md hover:border-primary/50',
                isSelected && !isProhibited && 'ring-2 ring-primary bg-primary/5',
                isPendingApp && !isSelected && 'ring-2 ring-blue-500/50 bg-blue-50'
              )}
              onClick={() => !isProhibited && toggleState(state.abbreviation)}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  {isProhibited ? (
                    <Ban className="h-4 w-4 text-destructive mt-0.5" />
                  ) : (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleState(state.abbreviation)}
                      className="mt-0.5"
                      disabled={isProhibited}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "font-medium text-sm",
                        isProhibited ? "text-muted-foreground" : "text-foreground"
                      )}>
                        {state.name}
                      </span>
                      <span className="text-xs text-muted-foreground">({state.abbreviation})</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {isProhibited ? (
                        <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                          NPs cannot practice
                        </Badge>
                      ) : (
                        <>
                          {state.hasFPA && (
                            <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                              FPA
                            </Badge>
                          )}
                          {getCollabBadge(state.abbreviation)}
                          {/* Only show demand tags to admin/leadership */}
                          {!isProvider && state.demandTag && state.demandTag !== 'stable' && (
                            <Badge 
                              variant="outline" 
                              className={cn(
                                "text-xs",
                                state.demandTag === 'critical' && "bg-destructive/10 text-destructive border-destructive/30",
                                state.demandTag === 'at_risk' && "bg-orange-500/10 text-orange-600 border-orange-500/30",
                                state.demandTag === 'watch' && "bg-yellow-500/10 text-yellow-600 border-yellow-500/30"
                              )}
                            >
                              {state.demandTag === 'at_risk' ? 'At Risk' : state.demandTag}
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {isSelected && !isProhibited && (
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredStates.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No states found matching "{searchQuery}"</p>
        </div>
      )}

      {/* Pending Applications Section */}
      {showPendingOption && onPendingApplicationsUpdate && (
        <div className="border-t pt-6 space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="applying-new"
              checked={isApplyingForNew}
              onCheckedChange={setIsApplyingForNew}
            />
            <Label htmlFor="applying-new" className="text-sm font-medium">
              Are you currently applying for licenses in additional states?
            </Label>
          </div>

          {isApplyingForNew && (
            <div className="space-y-3 pl-4 border-l-2 border-blue-200">
              <p className="text-sm text-muted-foreground">
                Select any states where you have pending license applications. These will be tracked separately from your active licenses.
              </p>
              <div className="flex flex-wrap gap-2">
                {allUSStatesSorted
                  .filter(s => !prohibitedStates.has(s.abbreviation) && !selectedStates.includes(s.abbreviation))
                  .map(state => {
                    const isPending = pendingStateAbbrs.has(state.abbreviation);
                    return (
                      <Badge
                        key={state.abbreviation}
                        variant={isPending ? "default" : "outline"}
                        className={cn(
                          "cursor-pointer transition-colors",
                          isPending ? "bg-blue-600" : "hover:bg-muted"
                        )}
                        onClick={() => togglePendingApplication(state.abbreviation)}
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        {state.abbreviation}
                      </Badge>
                    );
                  })}
              </div>
              {pendingApplications.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Pending applications will be tracked but won't trigger collaboration workflows until the license is verified.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-4 border-t">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">FPA</Badge>
          <span>Full Practice Authority</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">Collab Required</Badge>
          <span>Collaborative Agreement Always Required</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">FPA Review</Badge>
          <span>Requires Admin Review</span>
        </div>
      </div>
    </div>
  );
}
