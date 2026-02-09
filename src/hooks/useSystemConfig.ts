import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface SystemConfigEntry {
  id: string;
  key: string;
  value: Record<string, any>;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

export function useSystemConfig(key?: string) {
  return useQuery({
    queryKey: ['system-config', key],
    queryFn: async () => {
      if (key) {
        const { data, error } = await supabase
          .from('system_config')
          .select('*')
          .eq('key', key)
          .single();
        if (error) throw error;
        return data as unknown as SystemConfigEntry;
      }
      const { data, error } = await supabase
        .from('system_config')
        .select('*')
        .order('key');
      if (error) throw error;
      return data as unknown as SystemConfigEntry[];
    },
  });
}

export function useMvpMode() {
  const { data } = useSystemConfig('mvp_mode');
  const config = data as SystemConfigEntry | undefined;
  return {
    enabled: config?.value?.enabled ?? true,
    message: config?.value?.message ?? 'This platform is operating in parallel with existing tools.',
  };
}

export function useProhibitedPatterns() {
  const { data } = useSystemConfig('prohibited_data_patterns');
  const config = data as SystemConfigEntry | undefined;
  return (config?.value?.patterns as string[]) ?? ['SSN', 'social security', 'bank account', 'routing number', 'tax id', 'EIN'];
}

export function useComplianceAtRiskDays() {
  const { data } = useSystemConfig('compliance_at_risk_days');
  const config = data as SystemConfigEntry | undefined;
  return (config?.value?.value as number) ?? 30;
}

export function useUpdateSystemConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: Record<string, any> }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('system_config')
        .update({ value, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('key', key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
      toast({ title: 'Configuration updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}
