import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ActivationActionDialog } from '@/components/activation/ActivationActionDialog';
import { isOffboarded } from '@/lib/employeeVisibility';
import type { EhrActivationStatus } from '@/hooks/useProviderStateStatus';

interface StateOption { abbreviation: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: StateOption[];
}

export function AddProviderToStateDialog({ open, onOpenChange, states }: Props) {
  const [providerId, setProviderId] = useState('');
  const [stateAbbr, setStateAbbr] = useState('');
  const [search, setSearch] = useState('');
  const [activationOpen, setActivationOpen] = useState(false);

  const { data: providers = [] } = useQuery({
    queryKey: ['add-provider-to-state-profiles'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, profession, employment_status, activation_status')
        .order('full_name');
      if (error) throw error;
      return (data ?? []).filter((p: any) => p.full_name && !isOffboarded(p.employment_status));
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['add-provider-to-state-status', providerId, stateAbbr],
    enabled: !!providerId && !!stateAbbr,
    queryFn: async () => {
      const { data } = await supabase
        .from('provider_state_status')
        .select('ehr_activation_status, readiness_status, readiness_reason')
        .eq('provider_id', providerId)
        .eq('state_abbreviation', stateAbbr)
        .maybeSingle();
      return data;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? providers.filter((p: any) => p.full_name.toLowerCase().includes(q)) : providers;
  }, [providers, search]);

  const provider = providers.find((p: any) => p.id === providerId) as any;
  const state = states.find((s) => s.abbreviation === stateAbbr);
  const sortedStates = [...states].sort((a, b) => a.name.localeCompare(b.name));

  const reset = () => { setProviderId(''); setStateAbbr(''); setSearch(''); };

  return (
    <>
      <Dialog open={open && !activationOpen} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Provider to State</DialogTitle>
            <DialogDescription>Choose a provider and state to start the activation steps.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input placeholder="Search providers…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {filtered.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}{p.profession && p.profession !== '-' ? ` · ${p.profession}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Select value={stateAbbr} onValueChange={setStateAbbr}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {sortedStates.map((s) => (
                    <SelectItem key={s.abbreviation} value={s.abbreviation}>{s.name} ({s.abbreviation})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {existing?.ehr_activation_status && (
              <p className="text-sm text-muted-foreground">
                Current status in this state: <span className="font-medium text-foreground">{existing.ehr_activation_status.replace(/_/g, ' ')}</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            <Button disabled={!providerId || !stateAbbr} onClick={() => setActivationOpen(true)}>
              Start activation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {provider && state && (
        <ActivationActionDialog
          open={activationOpen}
          onOpenChange={(o) => {
            setActivationOpen(o);
            if (!o) { reset(); onOpenChange(false); }
          }}
          providerId={provider.id}
          providerName={provider.full_name}
          stateAbbreviation={state.abbreviation}
          stateName={state.name}
          currentStatus={(existing?.ehr_activation_status as EhrActivationStatus) || 'inactive'}
          readinessStatus={existing?.readiness_status || 'not_ready'}
          readinessReason={existing?.readiness_reason || 'Requirements for this state have not been reviewed yet'}
          actionType="request_activation"
        />
      )}
    </>
  );
}
