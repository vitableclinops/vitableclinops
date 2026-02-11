import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileText, AlertTriangle, Shield, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { initiateLicensureApplication, useStateTemplates } from '@/hooks/useLicensureApplications';
import { getCollabRequirementType } from '@/constants/stateRestrictions';
import { allUSStatesSorted } from '@/data/allStates';

interface InitiateLicensureDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedProviderId?: string;
  preselectedProviderName?: string;
  preselectedProviderEmail?: string;
  preselectedState?: string;
}

interface ProviderOption {
  id: string;
  full_name: string;
  email: string;
  profession: string | null;
}

export function InitiateLicensureDialog({
  open, onClose, onSuccess,
  preselectedProviderId, preselectedProviderName, preselectedProviderEmail,
  preselectedState,
}: InitiateLicensureDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState(preselectedProviderId || '');
  const [selectedState, setSelectedState] = useState(preselectedState || '');
  const [designationType, setDesignationType] = useState('initial_license');
  const [saving, setSaving] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);

  const { templates } = useStateTemplates(selectedState || undefined);

  // Fetch providers for the dropdown
  useEffect(() => {
    if (!open) return;
    if (preselectedProviderId) return;
    
    const fetchProviders = async () => {
      setLoadingProviders(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, profession')
        .order('full_name');
      setProviders((data || []) as ProviderOption[]);
      setLoadingProviders(false);
    };
    fetchProviders();
  }, [open, preselectedProviderId]);

  useEffect(() => {
    if (open) {
      setSelectedProviderId(preselectedProviderId || '');
      setSelectedState(preselectedState || '');
      setDesignationType('initial_license');
    }
  }, [open, preselectedProviderId, preselectedState]);

  const selectedProvider = preselectedProviderId
    ? { id: preselectedProviderId, full_name: preselectedProviderName || '', email: preselectedProviderEmail || '' }
    : providers.find(p => p.id === selectedProviderId);

  const stateName = allUSStatesSorted.find(s => s.abbreviation === selectedState)?.name || selectedState;
  const caType = selectedState ? getCollabRequirementType(selectedState) : null;
  const matchingTemplate = templates.find(t => t.designation_type === designationType);

  const handleInitiate = async () => {
    if (!selectedProvider || !selectedState) return;
    setSaving(true);
    try {
      await initiateLicensureApplication({
        providerId: selectedProvider.id,
        providerName: selectedProvider.full_name,
        providerEmail: selectedProvider.email,
        stateAbbr: selectedState,
        stateName,
        designationType,
        designationLabel: matchingTemplate?.designation_label || (designationType === 'initial_license' ? 'NP License' : designationType.replace(/_/g, ' ')),
        templateId: matchingTemplate?.id,
        templateSteps: matchingTemplate?.steps,
        caRequirementType: caType || undefined,
        kbArticleId: matchingTemplate?.kb_article_id || undefined,
        initiatedBy: profile?.id || '',
      });

      toast({ title: 'Licensure application initiated', description: `${selectedProvider.full_name} — ${stateName}` });
      onSuccess();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Initiate Licensure Application
          </DialogTitle>
          <DialogDescription>
            Assign a state license application to a provider. They'll receive step-by-step guidance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider select */}
          {!preselectedProviderId && (
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider…" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name} ({p.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {preselectedProviderId && (
            <div className="space-y-1">
              <Label>Provider</Label>
              <p className="text-sm font-medium">{preselectedProviderName}</p>
            </div>
          )}

          {/* State select */}
          {!preselectedState ? (
            <div className="space-y-2">
              <Label>State</Label>
              <Select value={selectedState} onValueChange={setSelectedState}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a state…" />
                </SelectTrigger>
                <SelectContent>
                  {allUSStatesSorted.map(s => (
                    <SelectItem key={s.abbreviation} value={s.abbreviation}>
                      {s.name} ({s.abbreviation})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>State</Label>
              <p className="text-sm font-medium">{stateName} ({selectedState})</p>
            </div>
          )}

          {/* Designation type */}
          {templates.length > 1 && (
            <div className="space-y-2">
              <Label>Designation</Label>
              <Select value={designationType} onValueChange={setDesignationType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.designation_type} value={t.designation_type}>
                      {t.designation_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Template info */}
          {matchingTemplate && (
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <p className="text-sm font-medium">Template: {matchingTemplate.designation_label}</p>
              {matchingTemplate.estimated_fee && (
                <p className="text-sm text-muted-foreground">Est. fee: ${matchingTemplate.estimated_fee}</p>
              )}
              {matchingTemplate.estimated_timeline && (
                <p className="text-sm text-muted-foreground">Timeline: {matchingTemplate.estimated_timeline}</p>
              )}
              <p className="text-sm text-muted-foreground">{matchingTemplate.steps?.length || 0} steps</p>
            </div>
          )}

          {/* CA awareness */}
          {selectedState && caType && (
            <Alert variant={caType === 'always' ? 'destructive' : 'default'}>
              <Info className="h-4 w-4" />
              <AlertDescription>
                {caType === 'always' && (
                  <>A collaborative agreement is <strong>always required</strong> in {stateName}. One will need to be set up after license approval.</>
                )}
                {caType === 'conditional' && (
                  <>A collaborative agreement may be <strong>conditionally required</strong> in {stateName} depending on the provider's practice status.</>
                )}
                {caType === 'never' && (
                  <>No collaborative agreement is required in {stateName}. This is a full practice authority state.</>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleInitiate} disabled={saving || !selectedProvider || !selectedState}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Initiate Application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
