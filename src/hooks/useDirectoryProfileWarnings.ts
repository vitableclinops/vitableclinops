import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AGREEMENT_REFRESH_OPTIONS } from '@/lib/agreementRefresh';
import { agreementMissingDocument } from '@/lib/agreementDocumentRequired';
import { agreementDocumentEvidence } from '@/lib/agreementDocumentEvidence';

export function useDirectoryProfileWarnings(enabled: boolean) {
  return useQuery({
    queryKey: ['directory-collaboration', 'profile-warnings'], enabled,
    ...AGREEMENT_REFRESH_OPTIONS,
    queryFn: async () => {
      const [agreements, links, documents, tasks, logs] = await Promise.all([
        supabase.from('collaborative_agreements').select('id, provider_id, state_abbreviation, physician_name, workflow_status, agreement_document_url, medallion_document_url').range(0, 9999),
        supabase.from('agreement_providers').select('agreement_id, provider_id, is_active, medallion_document_url').range(0, 9999),
        supabase.from('task_documents').select('agreement_id, task_id, file_path').range(0, 9999),
        supabase.from('agreement_tasks').select('id, agreement_id').range(0, 9999),
        supabase.from('agreement_audit_log').select('entity_id, changes, created_at').eq('entity_type', 'agreement').eq('action', 'auto_invalidated').order('created_at', { ascending: false }).range(0, 9999),
      ]);
      for (const result of [agreements, links, documents, tasks, logs]) if (result.error) throw result.error;
      const result = new Map<string, { missing: typeof agreements.data; invalid: (NonNullable<typeof agreements.data>[number] & { reason: string | null; invalidatedAt: string | null })[] }>();
      for (const a of agreements.data ?? []) {
        const participants = (links.data ?? []).filter(p => p.agreement_id === a.id);
        const ids = new Set([a.provider_id, ...participants.filter(p => a.workflow_status === 'invalid' || p.is_active).map(p => p.provider_id)]);
        for (const id of ids) {
          if (!id) continue;
          const warnings = result.get(id) ?? { missing: [], invalid: [] };
          const evidence = agreementDocumentEvidence(a.id, id, a.agreement_document_url || a.medallion_document_url, links.data ?? [], documents.data ?? [], tasks.data ?? []);
          if (agreementMissingDocument(a, evidence)) warnings.missing?.push(a);
          if (a.workflow_status === 'invalid') {
            const entry = (logs.data ?? []).find(l => l.entity_id === a.id);
            const changes = entry?.changes;
            const reason = changes && typeof changes === 'object' && !Array.isArray(changes) && typeof changes.reason === 'string' ? changes.reason : null;
            warnings.invalid.push({ ...a, reason, invalidatedAt: entry?.created_at ?? null });
          }
          result.set(id, warnings);
        }
      }
      return result;
    },
  });
}