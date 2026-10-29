import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePcpCoverage } from '@/hooks/usePcpCoverage';
import { useActiveStateAgreementAudit } from '@/hooks/useActiveStateAgreementAudit';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
import { isOffboarded } from '@/lib/employeeVisibility';
import { isTestAccountDirectoryRecord, OUT_OF_SCOPE_PROFILE_IDS } from '@/lib/pcpCoverage';
import { directoryDisplayName } from '@/lib/directoryDisplayName';

export function useRequiredAgreementFlags(enabled: boolean) {
  const coverage = usePcpCoverage(enabled);
  const audit = useActiveStateAgreementAudit(enabled);
  const profiles = useQuery({
    queryKey: ['directory-collaboration', 'flag-profiles'], enabled,
    refetchOnWindowFocus: true, refetchInterval: 60_000,
    queryFn: async () => {
      const result = await supabase.from('profiles').select('id, full_name, first_name, last_name, preferred_name, email, npi_number, profession, credentials, employment_status, directory_visibility, directory_visibility_reason').range(0, 4999);
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  const flags = !audit.data || !coverage.data || !profiles.data ? [] : profiles.data.flatMap(provider => {
    if (isOffboarded(provider.employment_status) || isTestAccountDirectoryRecord(provider) || OUT_OF_SCOPE_PROFILE_IDS[provider.id]) return [];
    const states = coverage.data.statesByProfile.get(provider.id) ?? [];
    return activeStateAgreementFlags(provider, states, audit.data.rules, audit.data.agreements, audit.data.decisions, new Date(), audit.data.authorityEvidence, coverage.data.newlyActiveStatesByProfile?.get(provider.id))
      .map(review => ({ ...review, provider, name: directoryDisplayName(provider) }));
  }).sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state));
  return { flags, loading: profiles.isLoading || audit.isLoading || coverage.isLoading, error: profiles.error || audit.error || coverage.error };
}