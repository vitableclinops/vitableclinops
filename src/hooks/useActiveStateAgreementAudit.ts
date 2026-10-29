import { isDocumentExemptPhysician } from '@/lib/directShiftsPhysicians';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { StateAgreement } from '@/lib/activeStateAgreementFlags';
import { agreementDocumentEvidence } from '@/lib/agreementDocumentEvidence';

export function useActiveStateAgreementAudit(enabled: boolean) {
  return useQuery({
    queryKey: ['directory-collaboration', 'active-state-audit'], enabled,
    refetchOnWindowFocus: true, refetchInterval: 60_000,
    queryFn: async () => {
      const [local, participants, med, ext, people, rules, decisions, documents, tasks] = await Promise.all([
        supabase.from('collaborative_agreements').select('id, provider_id, physician_name, state_abbreviation, workflow_status, terminated_at, agreement_document_url, medallion_document_url, start_date, end_date').range(0, 9999),
        supabase.from('agreement_providers').select('agreement_id, provider_id, is_active, medallion_document_url').range(0, 9999),
        supabase.from('medallion_collab_agreements').select('profile_id, state, source_status, local_agreement_id, document_id, start_date, end_date').range(0, 9999),
        supabase.from('external_agreements').select('agency_id, external_provider_id, supervision_state, collaborative_agreement_status, document_reference, supervision_start_date, supervision_end_date').range(0, 9999),
        supabase.from('external_providers').select('agency_id, external_provider_id, profile_id').range(0, 9999),
        supabase.from('state_compliance_requirements').select('state_abbreviation, collab_requirement_type, ca_required'),
        supabase.from('provider_state_collab_decisions').select('profile_id, state_abbreviation, decision').range(0, 9999),
        supabase.from('task_documents').select('agreement_id, task_id, file_path').range(0, 9999),
        supabase.from('agreement_tasks').select('id, agreement_id').range(0, 9999),
      ]);
      for (const result of [local, participants, med, ext, people, rules, decisions, documents, tasks]) if (result.error) throw result.error;
      const agreements: StateAgreement[] = [];
      const localById = new Map((local.data ?? []).map(a => [a.id, a]));
      for (const a of local.data ?? []) {
        if (a.terminated_at) continue;
        const record = { documentExempt: isDocumentExemptPhysician(a.physician_name), state: a.state_abbreviation, status: a.workflow_status, document: a.agreement_document_url || a.medallion_document_url, start: a.start_date, end: a.end_date };
        const documentFor = (profileId: string | null) => agreementDocumentEvidence(a.id, profileId, record.document, participants.data ?? [], documents.data ?? [], tasks.data ?? []);
        agreements.push({ ...record, profileId: a.provider_id, document: documentFor(a.provider_id) });
        for (const p of participants.data ?? []) if (p.agreement_id === a.id && p.is_active) agreements.push({ ...record, profileId: p.provider_id, document: documentFor(p.provider_id) });
      }
      for (const a of med.data ?? []) {
        if (a.local_agreement_id && localById.has(a.local_agreement_id)) continue;
        agreements.push({ profileId: a.profile_id, state: a.state ?? '', status: a.source_status, document: a.document_id, start: a.start_date, end: a.end_date });
      }
      const ids = new Map((people.data ?? []).map(p => [`${p.agency_id}:${p.external_provider_id}`, p.profile_id]));
      for (const a of ext.data ?? []) agreements.push({ profileId: ids.get(`${a.agency_id}:${a.external_provider_id}`) ?? null, state: a.supervision_state ?? '', status: a.collaborative_agreement_status, document: a.document_reference, start: a.supervision_start_date, end: a.supervision_end_date });
      return { agreements, rules: rules.data ?? [], decisions: decisions.data ?? [] };
    },
  });
}