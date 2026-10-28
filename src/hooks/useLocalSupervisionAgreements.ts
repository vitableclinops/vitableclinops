import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useLocalSupervisionAgreements() {
  return useQuery({
    queryKey: ['local-supervision-agreements'],
    queryFn: async () => {
      const { data, error } = await supabase.from('agreement_providers')
        .select('id, provider_id, provider_name, provider_email, collaborative_agreements(id, physician_name, physician_npi, state_abbreviation, workflow_status, start_date, end_date, agreement_document_url, medallion_document_url)')
        .eq('is_active', true);
      if (error) throw error;
      return (data ?? []).flatMap(row => {
        const a = row.collaborative_agreements;
        if (!a) return [];
        return [{
          medallion_agreement_id: `local:${row.id}`, source: 'Directory',
          provider_id: row.provider_id,
          provider: row.provider_name || row.provider_email || '—',
          supervisor_name: a.physician_name, supervisor_npi: a.physician_npi,
          state: a.state_abbreviation, agreement_type: null,
          source_status: a.workflow_status, start_date: a.start_date,
          end_date: a.end_date, document_title: null,
          document_url: a.agreement_document_url || a.medallion_document_url,
          last_returned_at: null, local_agreement_id: a.id, local_match_notes: null,
        }];
      });
    },
  });
}