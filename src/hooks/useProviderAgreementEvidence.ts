import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AGREEMENT_REFRESH_OPTIONS } from '@/lib/agreementRefresh';

export function useProviderAgreementEvidence(profileId: string) {
  return useQuery({
    queryKey: ['directory-collaboration', 'provider-evidence', profileId],
    ...AGREEMENT_REFRESH_OPTIONS,
    queryFn: async () => {
      const [direct, participants] = await Promise.all([
        supabase.from('collaborative_agreements').select('id, physician_name, state_abbreviation, agreement_document_url, medallion_document_url').eq('provider_id', profileId),
        supabase.from('agreement_providers').select('medallion_document_url, collaborative_agreements(id, physician_name, state_abbreviation, agreement_document_url, medallion_document_url)').eq('provider_id', profileId),
      ]);
      if (direct.error) throw direct.error;
      if (participants.error) throw participants.error;
      const agreements = new Map((direct.data ?? []).map(a => [a.id, { ...a, participantDocuments: [] as string[] }]));
      for (const p of participants.data ?? []) {
        const a = p.collaborative_agreements;
        if (!a) continue;
        const saved = agreements.get(a.id) ?? { ...a, participantDocuments: [] as string[] };
        if (p.medallion_document_url) saved.participantDocuments.push(p.medallion_document_url);
        agreements.set(a.id, saved);
      }
      const ids = [...agreements.keys()];
      if (!ids.length) return [];
      const { data: tasks, error: taskError } = await supabase.from('agreement_tasks').select('id').in('agreement_id', ids);
      if (taskError) throw taskError;
      const taskIds = (tasks ?? []).map(t => t.id);
      const [documents, taskDocuments] = await Promise.all([
        supabase.from('task_documents').select('id, agreement_id, task_id, file_name, file_path').in('agreement_id', ids),
        taskIds.length ? supabase.from('task_documents').select('id, agreement_id, task_id, file_name, file_path').in('task_id', taskIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (documents.error) throw documents.error;
      if (taskDocuments.error) throw taskDocuments.error;
      const evidence = [...agreements.values()].flatMap(a => [...new Set([a.agreement_document_url, a.medallion_document_url, ...a.participantDocuments].filter((s): s is string => !!s))].map(reference => ({ id: `${a.id}:${reference}`, label: `${a.state_abbreviation} — ${a.physician_name ?? 'Collaborative agreement'}`, reference })));
      const uniqueDocs = new Map([...(documents.data ?? []), ...(taskDocuments.data ?? [])].map(d => [d.id, d]));
      return [...evidence, ...[...uniqueDocs.values()].map(d => ({ id: d.id, label: d.file_name, reference: d.file_path }))];
    },
  });
}