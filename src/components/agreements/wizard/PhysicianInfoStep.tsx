import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserRound, Mail, Hash, Info, AlertCircle, Search, Check, ChevronDown, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useStateCompliance } from '@/hooks/useStateCompliance';
import { usePhysicianCapacity } from '@/hooks/usePhysicianCapacity';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AgreementFormData } from '../AgreementWizard';

interface PhysicianInfoStepProps {
  formData: AgreementFormData;
  updateFormData: (updates: Partial<AgreementFormData>) => void;
}

export const PhysicianInfoStep = ({ formData, updateFormData }: PhysicianInfoStepProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);

  const { getStateCompliance } = useStateCompliance();
  const stateCompliance = formData.selectedState ?
    getStateCompliance(formData.selectedState.abbreviation) : null;
  const { capacity, loading: capacityLoading } = usePhysicianCapacity(
    formData.physicianEmail,
    formData.selectedState?.abbreviation,
    stateCompliance?.np_md_ratio_limit ?? null
  );

  const { data: physicians = [], isLoading } = useQuery({
    queryKey: ['physician-profiles-for-wizard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, email, npi_number, profession, credentials')
        .in('profession', ['MD', 'DO', 'physician'])
        .order('full_name');
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = physicians.filter(p => {
    const q = searchQuery.toLowerCase();
    const name = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`).toLowerCase();
    return name.includes(q) || (p.email || '').toLowerCase().includes(q);
  });

  const selectedPhysician = physicians.find(p => p.id === formData.physicianId);

  const selectPhysician = (physician: typeof physicians[0]) => {
    const displayName = physician.full_name ||
      `${physician.first_name || ''} ${physician.last_name || ''}`.trim() ||
      physician.email;
    updateFormData({
      physicianId: physician.id,
      physicianName: displayName,
      physicianEmail: physician.email || '',
      physicianNpi: physician.npi_number || '',
    });
    setOpen(false);
    setSearchQuery('');
  };

  const clearSelection = () => {
    updateFormData({ physicianId: null, physicianName: '', physicianEmail: '', physicianNpi: '' });
    setManualMode(false);
  };

  return (
    <div className="space-y-6">
      {/* Info card */}
      <Card className="p-4 bg-muted/50 border-muted">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h4 className="font-medium text-sm">Collaborating Physician</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Select the physician from the directory who will supervise NPs in{' '}
              <strong>{formData.selectedState?.name || 'the selected state'}</strong>.
              They must be in the provider directory first.
            </p>
          </div>
        </div>
      </Card>

      {!manualMode ? (
        <div className="space-y-4">
          {/* Directory picker */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <UserRound className="h-4 w-4" />
              Select Physician from Directory <span className="text-destructive">*</span>
            </Label>

            {selectedPhysician ? (
              <Card className="p-3 ring-2 ring-primary bg-primary/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Check className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{formData.physicianName}</p>
                      <p className="text-xs text-muted-foreground">{formData.physicianEmail}</p>
                      {formData.physicianNpi && (
                        <p className="text-xs text-muted-foreground">NPI: {formData.physicianNpi}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedPhysician.profession && (
                      <Badge variant="outline" className="text-xs">{selectedPhysician.profession}</Badge>
                    )}
                    <Button variant="ghost" size="sm" onClick={clearSelection} className="text-muted-foreground h-7">
                      Change
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between h-10 font-normal"
                  >
                    <span className="text-muted-foreground">Search physician directory...</span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[480px] p-0" align="start">
                  <div className="p-3 border-b">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto">
                    {isLoading ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">Loading physicians...</div>
                    ) : filtered.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        No physicians found matching "{searchQuery}"
                      </div>
                    ) : (
                      filtered.map((physician) => {
                        const displayName = physician.full_name ||
                          `${physician.first_name || ''} ${physician.last_name || ''}`.trim() ||
                          physician.email;
                        return (
                          <button
                            key={physician.id}
                            onClick={() => selectPhysician(physician)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent text-left transition-colors"
                          >
                            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <span className="text-xs font-medium">
                                {displayName.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{displayName}</p>
                              <p className="text-xs text-muted-foreground truncate">{physician.email}</p>
                              {physician.npi_number && (
                                <p className="text-xs text-muted-foreground">NPI: {physician.npi_number}</p>
                              )}
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">
                              {physician.profession || 'Physician'}
                            </Badge>
                          </button>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Capacity Warning */}
          {!capacityLoading && capacity && capacity.isAtCapacity && (
            <Alert variant="destructive" className="border-destructive/50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>{capacity.physicianName}</strong> has reached the NP:MD supervision capacity limit for {formData.selectedState?.name} ({capacity.activeProviderCount}/{capacity.capacityLimit} NPs). No new agreements can be created until a provider is removed or transferred.
              </AlertDescription>
            </Alert>
          )}

          {/* Manual escape hatch */}
          <div className="pt-2 border-t">
            <button
              onClick={() => setManualMode(true)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Physician not in directory? Enter manually (not recommended)
            </button>
          </div>
        </div>
      ) : (
        /* Manual entry fallback */
        <div className="space-y-4">
          <Alert className="border-warning/50 bg-warning/5">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertDescription className="text-warning-foreground">
              <strong>Manual entry bypasses profile linking.</strong> This agreement will not be connected to a directory profile, which means it may show as "Unknown" and cannot be navigated from the physician's profile page. Please{' '}
              <strong>create the physician in the Provider Directory first</strong>, then return here to select them.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="physician-name" className="flex items-center gap-2">
              <UserRound className="h-4 w-4" />
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="physician-name"
              placeholder="Dr. Jane Smith"
              value={formData.physicianName}
              onChange={(e) => updateFormData({ physicianName: e.target.value, physicianId: null })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="physician-email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Address <span className="text-destructive">*</span>
            </Label>
            <Input
              id="physician-email"
              type="email"
              placeholder="jane.smith@hospital.com"
              value={formData.physicianEmail}
              onChange={(e) => updateFormData({ physicianEmail: e.target.value, physicianId: null })}
            />
          </div>

          {!capacityLoading && capacity && capacity.isAtCapacity && (
            <Alert variant="destructive" className="border-destructive/50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>{capacity.physicianName}</strong> has reached the NP:MD supervision capacity limit for {formData.selectedState?.name}.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="physician-npi" className="flex items-center gap-2">
              <Hash className="h-4 w-4" />
              NPI Number <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="physician-npi"
              placeholder="1234567890"
              value={formData.physicianNpi}
              onChange={(e) => updateFormData({ physicianNpi: e.target.value })}
              maxLength={10}
            />
          </div>

          <Button variant="outline" size="sm" onClick={() => { clearSelection(); setManualMode(false); }}>
            ← Back to directory search
          </Button>
        </div>
      )}

      {/* State-specific requirements reminder */}
      {formData.selectedState?.collaborativeAgreementRequirements && (
        <Card className="p-4 border-primary/20 bg-primary/5">
          <h4 className="font-medium text-sm mb-2">
            {formData.selectedState.abbreviation} Requirements
          </h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              • Meeting Cadence:{' '}
              <span className="capitalize font-medium">
                {formData.selectedState.collaborativeAgreementRequirements.meetingCadence}
              </span>
            </li>
            {formData.selectedState.collaborativeAgreementRequirements.chartReviewRequired && (
              <li>
                • Chart Review:{' '}
                <span className="font-medium">
                  {formData.selectedState.collaborativeAgreementRequirements.chartReviewFrequency}
                </span>
              </li>
            )}
            {formData.selectedState.prescriptiveAuthorityNotes && (
              <li>• {formData.selectedState.prescriptiveAuthorityNotes}</li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
};
