import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { directoryCollaborationCounts } from '@/lib/directoryCollaboration';

export function useDirectoryCollaboration(enabled: boolean) {
  return useQuery({
    queryKey: ['directory-collaboration'], enabled,
    refetchOnWindowFocus: true, refetchInterval: 60_000,
    queryFn: async () => {
      const [local, participants, medallion, externalProviders, externalAgreements] = await Promise.all([
        supabase.from('collaborative_agreements').select('id, provider_id, physician_id, workflow_status, terminated_at').range(0, 9999),
        supabase.from('agreement_providers').select('agreement_id, provider_id, is_active').range(0, 9999),
        supabase.from('medallion_collab_agreements').select('profile_id, supervisor_profile_id, source_status, local_agreement_id').range(0, 9999),
        supabase.from('external_providers').select('agency_id, external_provider_id, profile_id').range(0, 9999),
        supabase.from('external_agreements').select('agency_id, external_provider_id, supervisor_external_id, collaborative_agreement_status').range(0, 9999),
      ]);
      for (const result of [local, participants, medallion, externalProviders, externalAgreements]) if (result.error) throw result.error;
      const externalIds = new Map((externalProviders.data ?? []).map(p => [`${p.agency_id}:${p.external_provider_id}`, p.profile_id]));
      const agency = (externalAgreements.data ?? []).map(a => ({
        profile_id: externalIds.get(`${a.agency_id}:${a.external_provider_id}`) ?? null,
        supervisor_profile_id: externalIds.get(`${a.agency_id}:${a.supervisor_external_id}`) ?? null,
        source_status: a.collaborative_agreement_status, local_agreement_id: null,
      }));
      return directoryCollaborationCounts(local.data ?? [], participants.data ?? [], [...(medallion.data ?? []), ...agency]);
    },
  });
}