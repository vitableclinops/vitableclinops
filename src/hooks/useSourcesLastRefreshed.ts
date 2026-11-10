import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Shared timestamp of the last manual "Refresh sources" run. Stored in
 * system_config so every admin sees the same value regardless of which
 * browser pulled the snapshot.
 */
export const SOURCES_LAST_REFRESHED_KEY = 'directory_sources_last_refreshed_at';

export function useSourcesLastRefreshed() {
  const { data, isLoading } = useQuery({
    queryKey: ['system-config', SOURCES_LAST_REFRESHED_KEY],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_config')
        .select('value')
        .eq('key', SOURCES_LAST_REFRESHED_KEY)
        .maybeSingle();
      if (error) throw error;
      return (data?.value as { last_refreshed_at?: string } | null) ?? null;
    },
  });
  return { lastRefreshedAt: data?.last_refreshed_at ?? '', loading: isLoading };
}

/** Persist the refresh time so the rest of the team sees it too. */
export async function recordSourcesRefreshed() {
  const { data: { user } } = await supabase.auth.getUser();
  const value = { last_refreshed_at: new Date().toISOString() };
  const existing = await supabase
    .from('system_config')
    .select('id')
    .eq('key', SOURCES_LAST_REFRESHED_KEY)
    .maybeSingle();
  const result = existing.data
    ? await supabase
        .from('system_config')
        .update({ value, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('key', SOURCES_LAST_REFRESHED_KEY)
    : await supabase
        .from('system_config')
        .insert({
          key: SOURCES_LAST_REFRESHED_KEY,
          value,
          description: 'Timestamp of the last manual Refresh sources run',
          updated_by: user?.id,
        });
  if (result.error) throw result.error;
}

/**
 * Last refresh time for display: starts from the shared stored value and
 * moves to now the moment a refresh finishes, even if the write fails.
 */
export function useDisplayedSourcesRefreshed() {
  const queryClient = useQueryClient();
  const { lastRefreshedAt: stored, loading } = useSourcesLastRefreshed();
  const [lastRefreshedAt, setLastRefreshedAt] = useState('');

  useEffect(() => {
    if (stored) setLastRefreshedAt(stored);
  }, [stored]);

  const markRefreshed = () => {
    const now = new Date().toISOString();
    setLastRefreshedAt(now);
    recordSourcesRefreshed()
      .then(() => queryClient.invalidateQueries({ queryKey: ['system-config', SOURCES_LAST_REFRESHED_KEY] }))
      .catch(() => {
        // The refresh itself succeeded; a failed timestamp write must not
        // undo what the user just saw.
      });
  };

  return { lastRefreshedAt, loading, markRefreshed };
}

export function formatEasternDateTime(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  }) + ' ET';
}
