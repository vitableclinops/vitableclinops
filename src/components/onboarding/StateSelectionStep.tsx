import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Search, MapPin, Shield, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { states } from '@/data/mockData';

interface StateSelectionStepProps {
  selectedStates: string[];
  onUpdate: (states: string[]) => void;
}

export function StateSelectionStep({ selectedStates, onUpdate }: StateSelectionStepProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredStates = states.filter(state =>
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

      {/* Selected states summary */}
      {selectedStates.length > 0 && (
        <div className="flex flex-wrap gap-2 p-4 bg-muted rounded-lg">
          <span className="text-sm font-medium text-muted-foreground mr-2">Selected:</span>
          {selectedStates.map(stateAbbr => {
            const state = states.find(s => s.abbreviation === stateAbbr);
            return (
              <Badge
                key={stateAbbr}
                variant="secondary"
                className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => toggleState(stateAbbr)}
              >
                {state?.name || stateAbbr} ×
              </Badge>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search states..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* State grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-h-[400px] overflow-y-auto pr-2">
        {filteredStates.map(state => {
          const isSelected = selectedStates.includes(state.abbreviation);
          
          return (
            <Card
              key={state.abbreviation}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md',
                isSelected && 'ring-2 ring-primary bg-primary/5'
              )}
              onClick={() => toggleState(state.abbreviation)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleState(state.abbreviation)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{state.name}</span>
                      <span className="text-xs text-muted-foreground">({state.abbreviation})</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {state.hasFPA && (
                        <Badge variant="outline" className="text-xs border-green-200 bg-green-50 text-green-700">
                          <Shield className="h-3 w-3 mr-1" />
                          FPA
                        </Badge>
                      )}
                      {state.requiresCollaborativeAgreement && (
                        <Badge variant="outline" className="text-xs border-amber-200 bg-amber-50 text-amber-700">
                          <Users className="h-3 w-3 mr-1" />
                          CA Req
                        </Badge>
                      )}
                      {state.demandTag && (
                        <Badge variant="outline" className="text-xs">
                          {state.demandTag}
                        </Badge>
                      )}
                    </div>
                  </div>
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
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <p className="text-sm font-medium mb-2">Legend</p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">FPA</Badge>
              Full Practice Authority
            </span>
            <span className="flex items-center gap-1">
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">CA Req</Badge>
              Collaborative Agreement Required
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
