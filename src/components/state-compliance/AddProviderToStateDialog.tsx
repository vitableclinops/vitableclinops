import { stateRequirementSummary } from '@/lib/stateRequirementSummary';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUpdateActivationStatus } from '@/hooks/useProviderStateStatus';
import { usePcpCoverage } from '@/hooks/usePcpCoverage';
import { isOffboarded } from '@/lib/employeeVisibility';
import { SHEET_REQUIREMENTS, REQUIREMENT_LABELS, validRequirementProof } from '@/lib/stateSheetRequirements';
import type { EhrActivationStatus } from '@/hooks/useProviderStateStatus';

export const OTHER_RULES: Record<string, string> = {
  NC: 'Signed Collab Agreement + NCBON registration',
  NY: 'Signed Collab Agreement OR verified independent practice',
  OK: 'Signed Collab Agreement OR verified independent practice',
  WV: 'Signed Collab Agreement OR verified independent practice',
  PA: 'Signed Collab Agreement + "Rx Authority" license designation (file proof) + PALS portal collab confirmed/registration',
  VA: '"Autonomous Practice" + "Rx Authority" License designations OR "Rx Authority" + Signed Collab Agreement',
};

interface StateOption { abbreviation: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: StateOption[];
  defaultState?: string;
}

export function AddProviderToStateDialog({ open, onOpenChange, states, defaultState }: Props) {
  const [providerId, setProviderId] = useState('');
  const [stateAbbr, setStateAbbr] = useState(defaultState ?? '');
  const [search, setSearch] = useState('');
  const [activationOpen, setActivationOpen] = useState(false);
  const [submitted, setSubmitted] = useState<null | { name: string; state: string; stateName: string; queue: { label: string; items: { key: string; label: string; saved: boolean }[] } | null }>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const { data: proofs = [] } = useQuery({
    queryKey: ['add-provider-to-state-proofs', providerId, stateAbbr],
    enabled: !!providerId && !!stateAbbr,
    queryFn: async () => {
      const { data } = await supabase.from('provider_requirement_verifications').select('*')
        .eq('profile_id', providerId).eq('state_abbreviation', stateAbbr);
      return (data ?? []) as any[];
    },
  });

  const requirementQueue = useMemo(() => {
    if (!stateAbbr) return null;
    const cfg = SHEET_REQUIREMENTS[stateAbbr] ?? (OTHER_RULES[stateAbbr] ? { label: OTHER_RULES[stateAbbr], keys: [] as string[] } : null);
    if (!cfg) return null;
    const items = cfg.keys.map((k) => ({
      key: k,
      label: REQUIREMENT_LABELS[k] ?? k,
      saved: proofs.some((p) => p.requirement_key === k && validRequirementProof(p)),
    }));
    if ((cfg as any).agreement || OTHER_RULES[stateAbbr]?.includes('Collab')) items.push({ key: 'collab_agreement', label: 'Signed Collab Agreement', saved: false });
    if (stateAbbr === 'PA') items.push({ key: 'pals_collab_registration', label: REQUIREMENT_LABELS.pals_collab_registration, saved: proofs.some((p) => p.requirement_key === 'pals_collab_registration' && validRequirementProof(p)) });
    return { label: stateRequirementSummary(stateAbbr), items };
  }, [stateAbbr, proofs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? providers.filter((p: any) => p.full_name.toLowerCase().includes(q)) : providers;
  }, [providers, search]);

  const provider = providers.find((p: any) => p.id === providerId) as any;
  const state = states.find((s) => s.abbreviation === stateAbbr);
  const sortedStates = [...states].sort((a, b) => a.name.localeCompare(b.name));

  const { data: coverage } = usePcpCoverage(open);
  const ehrActive = !!providerId && !!stateAbbr && !!coverage?.statesByProfile.get(providerId)?.includes(stateAbbr);
  const alreadyActive = ehrActive || existing?.ehr_activation_status === 'active';

  const updateMutation = useUpdateActivationStatus();
  const submitRequest = async () => {
    if (!provider || !state) return;
    const missing = requirementQueue?.items.filter((i) => !i.saved).map((i) => i.label).join('; ');
    await updateMutation.mutateAsync({
      providerId: provider.id,
      stateAbbreviation: state.abbreviation,
      newStatus: 'activation_requested' as EhrActivationStatus,
      notes: `Added to ${state.abbreviation}. Requirements to verify: ${missing || requirementQueue?.label || 'none saved'}`,
    });
    queryClient.invalidateQueries();
    const name = provider.full_name;
    reset();
    onOpenChange(false);
    navigate(`/admin/states?tab=compliance&scope=licensed&state=${state.abbreviation}&search=${encodeURIComponent(name)}`);
  };

  const reset = () => { setProviderId(''); setStateAbbr(defaultState ?? ''); setSearch(''); };

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
              <Input
                placeholder="Start typing a provider name…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setProviderId(''); }}
              />
              {search.trim() && !providerId && (
                <div className="max-h-56 overflow-y-auto rounded-md border bg-popover">
                  {filtered.length === 0 ? (
                    <p className="p-2 text-sm text-muted-foreground">No matching providers</p>
                  ) : filtered.slice(0, 50).map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={() => { setProviderId(p.id); setSearch(p.full_name); }}
                    >
                      {p.full_name}{p.profession && p.profession !== '-' ? ` · ${p.profession}` : ''}
                    </button>
                  ))}
                </div>
              )}
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
            {alreadyActive && (
              <p className="text-sm font-medium text-destructive">Provider is already active here</p>
            )}
            {requirementQueue && !alreadyActive && providerId && (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Requirements queued for {stateAbbr}</p>
                <p className="text-xs text-muted-foreground">{requirementQueue.label}</p>
                {requirementQueue.items.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {requirementQueue.items.map((i) => (
                      <li key={i.key} className="flex items-start gap-2">
                        <span className={i.saved ? 'text-primary' : 'text-destructive'}>{i.saved ? '✓' : '•'}</span>
                        <span>{i.label}{i.saved ? ' (proof saved)' : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">These are added to the activation request. Anything still missing is flagged on the Compliance tab.</p>
              </div>
            )}
            {existing?.ehr_activation_status && !alreadyActive && (
              <p className="text-sm text-muted-foreground">
                Current status in this state: <span className="font-medium text-foreground">{existing.ehr_activation_status.replace(/_/g, ' ')}</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            <Button disabled={!providerId || !stateAbbr || alreadyActive || updateMutation.isPending} onClick={submitRequest}>
              {updateMutation.isPending ? 'Submitting…' : 'Request to add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!submitted} onOpenChange={(o) => { if (!o) setSubmitted(null); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Requirements to satisfy</DialogTitle>
            <DialogDescription>
              Activation requested for {submitted?.name} in {submitted?.stateName}. Complete these before activating in the EHR.
            </DialogDescription>
          </DialogHeader>
          {submitted?.queue ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{submitted.queue.label}</p>
              <ul className="space-y-1 text-sm">
                {submitted.queue.items.map((i) => (
                  <li key={i.key} className="flex items-start gap-2">
                    <span className={i.saved ? 'text-primary' : 'text-destructive'}>{i.saved ? '✓' : '•'}</span>
                    <span>{i.label}{i.saved ? ' (proof saved)' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No saved requirements for this state.</p>
          )}
          <p className="text-xs text-muted-foreground">This request is now listed on the Compliance tab under "Licensed / requested · not active".</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitted(null)}>Close</Button>
            <Button onClick={() => { const s = submitted!; setSubmitted(null); navigate(`/admin/states?tab=compliance&scope=licensed&state=${s.state}`); }}>
              Open in Compliance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
