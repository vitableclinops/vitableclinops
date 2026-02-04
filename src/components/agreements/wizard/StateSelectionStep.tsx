import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { allUSStates } from '@/data/allStates';
import { Search, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import type { AgreementFormData } from '../AgreementWizard';
import type { State } from '@/types';

interface StateSelectionStepProps {
  formData: AgreementFormData;
  updateFormData: (updates: Partial<AgreementFormData>) => void;
}

export const StateSelectionStep = ({ formData, updateFormData }: StateSelectionStepProps) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter only states that require collaborative agreements
  const statesRequiringCA = useMemo(() => {
    return allUSStates.filter(state => state.requiresCollaborativeAgreement);
  }, []);

  const filteredStates = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return statesRequiringCA.filter(
      state =>
        state.name.toLowerCase().includes(query) ||
        state.abbreviation.toLowerCase().includes(query)
    );
  }, [statesRequiringCA, searchQuery]);

  const handleSelectState = (state: State) => {
    updateFormData({ 
      selectedState: state,
      // Pre-fill meeting cadence from state requirements
      meetingCadence: state.collaborativeAgreementRequirements?.meetingCadence as any || 'monthly',
      chartReviewRequired: state.collaborativeAgreementRequirements?.chartReviewRequired || false,
      chartReviewFrequency: state.collaborativeAgreementRequirements?.chartReviewFrequency || '',
    });
  };

  const getDemandBadgeVariant = (tag: string) => {
    switch (tag) {
      case 'critical': return 'destructive';
      case 'at_risk': return 'default';
      case 'watch': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search states..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm">
        <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
        <p className="text-muted-foreground">
          Showing {statesRequiringCA.length} states that require collaborative agreements. 
          States with Full Practice Authority (FPA) don't need agreements.
        </p>
      </div>

      {/* States grid */}
      <div className="grid grid-cols-2 gap-3 max-h-[350px] overflow-y-auto pr-2">
        {filteredStates.map((state) => {
          const isSelected = formData.selectedState?.id === state.id;
          const requirements = state.collaborativeAgreementRequirements;

          return (
            <Card
              key={state.id}
              onClick={() => handleSelectState(state)}
              className={`p-3 cursor-pointer transition-all hover:shadow-md ${
                isSelected 
                  ? 'ring-2 ring-primary bg-primary/5' 
                  : 'hover:bg-accent/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{state.abbreviation}</span>
                    <span className="text-sm text-muted-foreground truncate">{state.name}</span>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                  </div>
                  
                  <div className="flex flex-wrap gap-1 mt-2">
                    {state.demandTag && (
                      <Badge variant={getDemandBadgeVariant(state.demandTag)} className="text-xs capitalize">
                        {state.demandTag.replace('_', ' ')}
                      </Badge>
                    )}
                    {requirements?.chartReviewRequired && (
                      <Badge variant="outline" className="text-xs">
                        Chart Review
                      </Badge>
                    )}
                  </div>

                  {requirements?.meetingCadence && (
                    <p className="text-xs text-muted-foreground mt-1 capitalize">
                      {requirements.meetingCadence} meetings
                    </p>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filteredStates.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mb-2" />
          <p>No states found matching "{searchQuery}"</p>
        </div>
      )}

      {/* Selected state details */}
      {formData.selectedState && (
        <Card className="p-4 bg-primary/5 border-primary/20">
          <h4 className="font-medium mb-2">
            Selected: {formData.selectedState.name} ({formData.selectedState.abbreviation})
          </h4>
          {formData.selectedState.notes && (
            <p className="text-sm text-muted-foreground">{formData.selectedState.notes}</p>
          )}
          {formData.selectedState.collaborativeAgreementRequirements?.supervisoryActivities && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Required Activities:</p>
              <div className="flex flex-wrap gap-1">
                {formData.selectedState.collaborativeAgreementRequirements.supervisoryActivities.map((activity, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {activity}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
