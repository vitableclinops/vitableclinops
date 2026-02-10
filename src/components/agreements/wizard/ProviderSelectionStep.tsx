import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, X, UserPlus, Users, Search, Check } from 'lucide-react';
import type { AgreementFormData } from '../AgreementWizard';

interface ProviderSelectionStepProps {
  formData: AgreementFormData;
  updateFormData: (updates: Partial<AgreementFormData>) => void;
}

export const ProviderSelectionStep = ({ formData, updateFormData }: ProviderSelectionStepProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualProvider, setManualProvider] = useState({ name: '', email: '', npi: '' });

  const { data: dbProviders = [], isLoading } = useQuery({
    queryKey: ['profiles-for-agreement'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, email, npi_number, profession')
        .order('full_name');
      if (error) throw error;
      return data || [];
    },
  });

  const filteredProviders = dbProviders.filter(p => {
    const query = searchQuery.toLowerCase();
    const name = (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`).toLowerCase();
    return name.includes(query) || (p.email || '').toLowerCase().includes(query);
  });

  const isProviderSelected = (providerId: string) => {
    return formData.providers.some(p => p.id === providerId);
  };

  const toggleProvider = (provider: typeof dbProviders[0]) => {
    const isSelected = isProviderSelected(provider.id);
    if (isSelected) {
      updateFormData({
        providers: formData.providers.filter(p => p.id !== provider.id),
      });
    } else {
      const displayName = provider.full_name || `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || provider.email;
      updateFormData({
        providers: [
          ...formData.providers,
          {
            id: provider.id,
            name: displayName,
            email: provider.email,
            npi: provider.npi_number || undefined,
          },
        ],
      });
    }
  };

  const addManualProvider = () => {
    if (manualProvider.name && manualProvider.email) {
      updateFormData({
        providers: [
          ...formData.providers,
          {
            name: manualProvider.name,
            email: manualProvider.email,
            npi: manualProvider.npi || undefined,
          },
        ],
      });
      setManualProvider({ name: '', email: '', npi: '' });
      setShowManualAdd(false);
    }
  };

  const removeProvider = (index: number) => {
    updateFormData({
      providers: formData.providers.filter((_, i) => i !== index),
    });
  };

  const getInitials = (provider: typeof dbProviders[0]) => {
    if (provider.first_name && provider.last_name) {
      return `${provider.first_name[0]}${provider.last_name[0]}`;
    }
    if (provider.full_name) {
      const parts = provider.full_name.split(' ');
      return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : parts[0][0];
    }
    return provider.email[0]?.toUpperCase() || '?';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Add providers to this agreement in {formData.selectedState?.abbreviation}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowManualAdd(!showManualAdd)}
        >
          <UserPlus className="h-4 w-4 mr-1" />
          Add New
        </Button>
      </div>

      {/* Manual add form */}
      {showManualAdd && (
        <Card className="p-4 space-y-3">
          <h4 className="font-medium text-sm">Add Provider Manually</h4>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="manual-name" className="text-xs">Name *</Label>
                <Input
                  id="manual-name"
                  placeholder="Full name"
                  value={manualProvider.name}
                  onChange={(e) => setManualProvider(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="manual-email" className="text-xs">Email *</Label>
                <Input
                  id="manual-email"
                  type="email"
                  placeholder="email@example.com"
                  value={manualProvider.email}
                  onChange={(e) => setManualProvider(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="manual-npi" className="text-xs">NPI (optional)</Label>
                <Input
                  id="manual-npi"
                  placeholder="1234567890"
                  value={manualProvider.npi}
                  onChange={(e) => setManualProvider(prev => ({ ...prev, npi: e.target.value }))}
                  maxLength={10}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={addManualProvider} disabled={!manualProvider.name || !manualProvider.email}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Selected providers */}
      {formData.providers.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary">{formData.providers.length} selected</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {formData.providers.map((provider, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm"
              >
                <span>{provider.name}</span>
                <button
                  onClick={() => removeProvider(index)}
                  className="hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search existing providers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Provider list */}
      <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading providers...</div>
        ) : (
          filteredProviders.map((provider) => {
            const isSelected = isProviderSelected(provider.id);
            const displayName = provider.full_name || `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || provider.email;
            return (
              <Card
                key={provider.id}
                onClick={() => toggleProvider(provider)}
                className={`p-3 cursor-pointer transition-all ${
                  isSelected 
                    ? 'ring-2 ring-primary bg-primary/5' 
                    : 'hover:bg-accent/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <span className="text-sm font-medium">
                        {getInitials(provider)}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">{displayName}</p>
                      <p className="text-xs text-muted-foreground">{provider.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {provider.profession && (
                      <Badge variant="outline" className="text-xs capitalize">
                        {provider.profession}
                      </Badge>
                    )}
                    {isSelected && (
                      <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-4 w-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}

        {!isLoading && filteredProviders.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No providers found</p>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowManualAdd(true)}
            >
              Add a provider manually
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
