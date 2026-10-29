import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { physicianSlots, type SlotAgreement } from '@/lib/physicianSlots';

export function usePhysicianSlots() {
  return useQuery({
    queryKey: ['directory-collaboration', 'physician-slots'],
    refetchOnWindowFocus: true, refetchInterval: 60_000,
    queryFn: async () => {
      const [local, participants, med, ext, externalPeople, people, rules] = await Promise.all([
        supabase.from('collaborative_agreements').select('id, physician_id, physician_name, physician_npi, physician_email, provider_id, state_abbreviation, workflow_status, terminated_at, start_date, end_date').range(0, 9999),
        supabase.from('agreement_providers').select('agreement_id, provider_id, is_active').range(0, 9999),
        supabase.from('medallion_collab_agreements').select('profile_id, supervisor_profile_id, supervisor_name, supervisor_npi, supervisor_medallion_id, state, source_status, local_agreement_id, start_date, end_date').range(0, 9999),
        supabase.from('external_agreements').select('agency_id, external_provider_id, supervisor_external_id, supervisor_name, supervisor_npi, supervision_state, collaborative_agreement_status, supervision_start_date, supervision_end_date').range(0, 9999),
        supabase.from('external_providers').select('agency_id, external_provider_id, profile_id').range(0, 9999),
        supabase.from('profiles').select('id, full_name, profession, credentials, employment_status, npi_number').range(0, 9999),
        supabase.from('state_compliance_requirements').select('state_abbreviation, np_md_ratio, np_md_ratio_limit'),
      ]);
      for (const res of [local, participants, med, ext, externalPeople, people, rules]) if (res.error) throw res.error;
      const profiles = people.data ?? [];
      const npiIds = new Map<string, string[]>();
      for (const p of profiles) if (p.npi_number) npiIds.set(p.npi_number, [...(npiIds.get(p.npi_number) ?? []), p.id]);
      const identity = (id: string | null, npi: string | null, fallback: string) => {
        const ids = npi ? npiIds.get(npi) : undefined;
        const profileId = id || (ids?.length === 1 ? ids[0] : null);
        return { physicianId: profileId, physicianKey: profileId ? `profile:${profileId}` : npi ? `npi:${npi}` : fallback };
      };
      const rows: SlotAgreement[] = (local.data ?? []).map(a => ({
        ...identity(a.physician_id, a.physician_npi, a.physician_email ? `email:${a.physician_email.toLowerCase()}` : `local:${a.id}`),
        physicianName: a.physician_name ?? 'Unassigned physician', state: a.state_abbreviation,
        providerIds: [a.provider_id, ...(participants.data ?? []).filter(p => p.agreement_id === a.id && p.is_active).map(p => p.provider_id)].filter((id): id is string => Boolean(id)),
        status: a.workflow_status, terminated: a.terminated_at, start: a.start_date, end: a.end_date,
      }));
      const localIds = new Set((local.data ?? []).map(a => a.id));
      for (const a of med.data ?? []) {
        if (a.local_agreement_id && localIds.has(a.local_agreement_id)) continue;
        rows.push({ ...identity(a.supervisor_profile_id, a.supervisor_npi, a.supervisor_medallion_id ? `med:${a.supervisor_medallion_id}` : ''),
          physicianName: a.supervisor_name ?? 'Unassigned physician', state: a.state ?? '', providerIds: a.profile_id ? [a.profile_id] : [],
          status: a.source_status, start: a.start_date, end: a.end_date });
      }
      const externalIds = new Map((externalPeople.data ?? []).map(p => [`${p.agency_id}:${p.external_provider_id}`, p.profile_id]));
      for (const a of ext.data ?? []) rows.push({
        ...identity(externalIds.get(`${a.agency_id}:${a.supervisor_external_id}`) ?? null, a.supervisor_npi, a.supervisor_external_id ? `agency:${a.agency_id}:${a.supervisor_external_id}` : ''),
        physicianName: a.supervisor_name ?? 'Unassigned physician', state: a.supervision_state ?? '',
        providerIds: [externalIds.get(`${a.agency_id}:${a.external_provider_id}`)].filter((id): id is string => Boolean(id)),
        status: a.collaborative_agreement_status, start: a.supervision_start_date, end: a.supervision_end_date,
      });
      return physicianSlots(rows, profiles, rules.data ?? []);
    },
  });
}