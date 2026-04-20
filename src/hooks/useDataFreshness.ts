import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Tables tracked by the data-freshness indicator.
 * All listed tables must have `synced_at` and `source` columns
 * (added in migration 20260420 + the freshness columns migration).
 */
type FreshnessTable = 'state_sla_attainment' | 'state_leftover_slots' | 'provider_utilization' | 'utilization_daily';

export type FreshnessRow = {
  table: FreshnessTable;
  syncedAt: string | null;
  source: string | null;
};

/**
 * Returns the most-recent `synced_at` + `source` for each requested table.
 * Used by ops pages to show "last synced" footers and stale-data banners.
 */
export function useDataFreshness(tables: FreshnessTable[]) {
  const key = [...tables].sort().join(',');
  return useQuery({
    queryKey: ['data_freshness', key],
    queryFn: async (): Promise<FreshnessRow[]> => {
      const results = await Promise.all(
        tables.map(async (t) => {
          const { data } = await supabase
            .from(t)
            .select('synced_at, source')
            .order('synced_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          const row = data as { synced_at?: string | null; source?: string | null } | null;
          return {
            table: t,
            syncedAt: row?.synced_at ?? null,
            source: row?.source ?? null,
          };
        }),
      );
      return results;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

const HOURS_24_MS = 24 * 60 * 60 * 1000;

export function isStale(syncedAt: string | null): boolean {
  if (!syncedAt) return true;
  return Date.now() - new Date(syncedAt).getTime() > HOURS_24_MS;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function labelForSource(source: string | null): string {
  if (!source) return 'unknown source';
  if (source === 'metabase_sync') return 'Metabase sync';
  if (source === 'csv_manual') return 'manual CSV';
  if (source === 'compute_availability') return 'Homebase forecast';
  return source;
}
