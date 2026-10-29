/**
 * Latest successful ID-based PCP telemedicine coverage snapshot, plus the
 * latest refresh attempt so failures are shown without clearing old data.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { addedActiveEhrStates } from '@/lib/prescriptiveAuthorityEvidence';
import {
  matchEhrCoverage, isSnapshotStale,
  type EhrCoverageRow, type EhrIdentity,
} from '@/lib/pcpCoverage';

export interface PcpCoverageData {
  statesByProfile: Map<string, string[]>;
  newlyActiveStatesByProfile?: Map<string, string[]>;
  identities: EhrIdentity[];
  /** When our app last successfully fetched the report. */
  pulledAt: string | null;
  /** Latest change recorded in the warehouse table (separate from our fetch). */
  warehouseLatestChangeAt: string | null;
  stale: boolean;
  lastAttempt: { status: string; at: string; error: string | null } | null;
}

export function usePcpCoverage(enabled: boolean) {
  return useQuery<PcpCoverageData | null>({
    queryKey: ['pcp-coverage-by-id'],
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [snap, profiles, med, runs, ext] = await Promise.all([
        supabase.from('metabase_raw_exports').select('rows, pulled_at')
          .eq('report_key', 'pcp_coverage_by_provider_id')
          .order('pulled_at', { ascending: false }).limit(2),
        supabase.from('profiles').select('id, full_name, npi_number').range(0, 4999),
        supabase.from('medallion_providers').select('profile_id, npi').range(0, 4999),
        supabase.from('sync_runs').select('status, started_at, error_message, details')
          .eq('function_name', 'sync-pcp-coverage')
          .order('started_at', { ascending: false }).limit(20),
        // Agency-imported NPIs are an identity source too; Medallion membership is never required.
        (supabase as any).from('external_providers').select('profile_id, npi').not('profile_id', 'is', null).range(0, 9999),
      ]);
      for (const result of [snap, profiles, med, ext]) if (result.error) throw result.error;
      const runList = (runs.data ?? []).filter((r: any) => (r.details?.mode ?? 'refresh') === 'refresh');
      const lastOk = runList.find((r: any) => r.status === 'success');
      const last = runList[0];
      const latest = snap.data?.[0];
      const previous = snap.data?.[1];
      const rows = (latest?.rows as unknown as EhrCoverageRow[]) ?? [];
      const { identities, statesByProfile } = matchEhrCoverage(
        rows, (profiles.data ?? []) as any, [...(med.data ?? []), ...((ext as any).data ?? [])] as any,
      );
      return {
        statesByProfile,
        newlyActiveStatesByProfile: addedActiveEhrStates(statesByProfile, previous ? matchEhrCoverage(
          previous.rows as unknown as EhrCoverageRow[], profiles.data ?? [], [...(med.data ?? []), ...(ext.data ?? [])],
        ).statesByProfile : undefined),
        identities,
        pulledAt: latest?.pulled_at ?? null,
        warehouseLatestChangeAt: (lastOk as any)?.details?.freshness?.latest_change_at ?? null,
        stale: isSnapshotStale(latest?.pulled_at),
        lastAttempt: last ? { status: last.status, at: last.started_at, error: last.error_message } : null,
      };
    },
  });
}
