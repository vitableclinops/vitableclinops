import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CONFIRMED_PHYSICIAN_COUNTS_KEY } from '@/lib/confirmedPhysicianCounts';

export function useConfirmedPhysicianCounts() {
  return useQuery({
    queryKey: ['system-config', CONFIRMED_PHYSICIAN_COUNTS_KEY],
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('system_config').select('value').eq('key', CONFIRMED_PHYSICIAN_COUNTS_KEY).maybeSingle();
      if (error) throw error;
      return data?.value ?? {};
    },
  });
}