import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, MapPin, Shield, Users, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { allUSStatesSorted } from '@/data/allStates';
import { DemandTagBadge } from '@/components/DemandTagBadge';
import type { ProviderType } from '@/types';

interface StateSelectionStepProps {
  selectedStates: string[];
  onUpdate: (states: string[]) => void;
  providerType?: ProviderType | null;
}

export function StateSelectionStep({ selectedStates, onUpdate, providerType }: StateSelectionStepProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredStates = allUSStatesSorted.filter(state =>
    state.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    state.abbreviation.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleState = (stateAbbr: string) => {
    if (selectedStates.includes(stateAbbr)) {
      onUpdate(selectedStates.filter(s => s !== stateAbbr));
    } else {
      onUpdate([...selectedStates, stateAbbr]);
    }
  };

  const selectAll = () => {
    onUpdate(allUSStatesSorted.map(s => s.abbreviation));
  };

  const clearAll = () => {
    onUpdate([]);
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
          <MapPin className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Select Your States</h2>
        <p className="text-muted-foreground mt-2">
          Choose the states where you want to practice. You can add more later.
        </p>
      </div>

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
          {selectedStates.length} of {allUSStatesSorted.length} states selected
        </Badge>
      </div>

      {/* State grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-h-[400px] overflow-y-auto pr-2">
        {filteredStates.map(state => {
          const isSelected = selectedStates.includes(state.abbreviation);
          
          return (
            <Card
              key={state.abbreviation}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md hover:border-primary/50',
                isSelected && 'ring-2 ring-primary bg-primary/5'
              )}
              onClick={() => toggleState(state.abbreviation)}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleState(state.abbreviation)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">{state.name}</span>
                      <span className="text-xs text-muted-foreground">({state.abbreviation})</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {state.hasFPA && (
                        <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                          FPA
                        </Badge>
                      )}
                      {state.requiresCollaborativeAgreement && (
                        <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                          CA Req
                        </Badge>
                      )}
                      {state.demandTag && (
                        <DemandTagBadge tag={state.demandTag} size="sm" />
                      )}
                    </div>
                  </div>
                  {isSelected && (
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

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-4 border-t">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">FPA</Badge>
          <span>Full Practice Authority</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">CA Req</Badge>
          <span>Collaborative Agreement Required</span>
        </div>
      </div>
    </div>
  );
}
