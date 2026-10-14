/**
 * Reads the latest synced PCP State Coverage export (Metabase question 2940)
 * from metabase_raw_exports and exposes it as a canonical-name → states map.
 *
 * The data is pulled daily by the sync-metabase edge function using the saved
 * Metabase login; this hook only reads the latest stored snapshot and labels
 * it with its pull date so stale data is visible rather than misleading.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { buildPcpCoverageMap, type PcpCoverageRow } from '@/lib/pcpCoverage';

export interface PcpCoverageData {
  byName: Map<string, string[]>;
  pulledDate: string | null;
  rowCount: number;
}

export function usePcpCoverage(enabled: boolean) {
  return useQuery<PcpCoverageData | null>({
    queryKey: ['pcp-coverage-latest'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('metabase_raw_exports')
        .select('rows, row_count, pulled_date')
        .eq('report_key', 'pcp_state_coverage')
        .order('pulled_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        byName: buildPcpCoverageMap((data.rows as unknown as PcpCoverageRow[]) ?? []),
        pulledDate: data.pulled_date,
        rowCount: data.row_count ?? 0,
      };
    },
  });
}
