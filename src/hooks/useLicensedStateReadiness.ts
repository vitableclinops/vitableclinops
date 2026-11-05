import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRequiredAgreementFlags } from '@/hooks/useRequiredAgreementFlags';
import { licensedStateReadiness } from '@/lib/licensedStateReadiness';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
import { directoryDisplayName } from '@/lib/directoryDisplayName';

export function useLicensedStateReadiness() {
  const current = useRequiredAgreementFlags(true);
  const licenses = useQuery({
    queryKey: ['directory-collaboration', 'medallion-readiness-licenses'],
    refetchOnWindowFocus: true, refetchInterval: 60_000,
    queryFn: async () => {
      const result = await supabase.from('medallion_licenses').select('profile_id, state, status, issue_date, expiration_date').range(0, 9999);
      if (result.error) throw result.error;
      return (result.data ?? []).map(l => ({ profileId: l.profile_id, state: l.state ?? '', status: l.status, issue: l.issue_date, expiration: l.expiration_date }));
    },
  });
  const requested = useQuery({
    queryKey: ['directory-collaboration', 'activation-requested-states'],
    refetchOnWindowFocus: true, refetchInterval: 60_000,
    queryFn: async () => {
      const result = await supabase.from('provider_state_status').select('provider_id, state_abbreviation').eq('ehr_activation_status', 'activation_requested');
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  const audit = current.audit;
  const base = licensedStateReadiness(current.profiles, licenses.data ?? [], current.coverage);
  const seen = new Set(base.map(r => `${r.provider.id}:${r.state}`));
  const requestedRows = (requested.data ?? []).flatMap(req => {
    const provider = current.profiles.find((p: any) => p.id === req.provider_id);
    const key = `${req.provider_id}:${req.state_abbreviation}`;
    if (!provider || seen.has(key) || current.coverage?.statesByProfile.get(req.provider_id)?.includes(req.state_abbreviation)) return [];
    seen.add(key);
    return [{ provider, state: req.state_abbreviation, activation: 'requested' as const, activationDetail: 'Activation requested' }];
  });
  const requestedKeys = new Set((requested.data ?? []).map(r => `${r.provider_id}:${r.state_abbreviation}`));
  const rows = [...base, ...requestedRows].map(row => ({
    ...row, activationRequested: requestedKeys.has(`${row.provider.id}:${row.state}`),
    name: directoryDisplayName(row.provider),
    reviews: audit ? activeStateAgreementFlags(row.provider, [row.state], audit.rules, audit.agreements, audit.decisions, new Date(), audit.authorityEvidence, [], audit.requirementProofs, [...audit.sheetLicenses, ...(licenses.data ?? [])]) : [],
  })).sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state));
  return { ...current, rows, loading: current.loading || licenses.isLoading || requested.isLoading, error: current.error || licenses.error };
}