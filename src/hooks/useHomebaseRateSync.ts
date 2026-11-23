import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface HomebaseRateSyncStatus {
  synced_at: string | null;
  counters?: { updated: number; inserted: number; unchanged: number; preserved: number; unmatched: number };
  rows: { provider_id: string; provider: string; role: string | null; previous_rate: number | null; homebase_rate: number | null; status: string; reason: string }[];
}
async function callSync(method: 'GET' | 'POST'): Promise<HomebaseRateSyncStatus> {
  const { data, error } = await supabase.functions.invoke('sync-homebase-rates', { method, ...(method === 'POST' ? { body: {} } : {}) });
  if (error) {
    const details = error instanceof FunctionsHttpError ? await error.context.text() : error.message;
    let message = details;
    try { message = JSON.parse(details).error ?? details; } catch { /* preserve server error */ }
    throw new Error(message);
  }
  return data;
}
export function useHomebaseRateSync(enabled: boolean) {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['homebase-rate-sync'], queryFn: () => callSync('GET'), enabled, refetchInterval: 60_000 });
  const sync = useMutation({
    mutationFn: () => callSync('POST'),
    onSuccess: async data => {
      client.setQueryData(['homebase-rate-sync'], data);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['workbench', 'provider-pay-rates'] }),
        client.invalidateQueries({ queryKey: ['scheduling-source-audit'] }),
      ]);
    },
  });
  return { status, sync };
}