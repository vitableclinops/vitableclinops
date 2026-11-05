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
  const audit = current.audit;
  const rows = licensedStateReadiness(current.profiles, licenses.data ?? [], current.coverage).map(row => ({
    ...row, name: directoryDisplayName(row.provider),
    reviews: audit ? activeStateAgreementFlags(row.provider, [row.state], audit.rules, audit.agreements, audit.decisions, new Date(), audit.authorityEvidence, [], audit.requirementProofs, [...audit.sheetLicenses, ...(licenses.data ?? [])]) : [],
  })).sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state));
  return { ...current, rows, loading: current.loading || licenses.isLoading, error: current.error || licenses.error };
}