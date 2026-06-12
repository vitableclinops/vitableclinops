import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type ReconciliationResolution =
  | 'ignored'
  | 'accept_homebase'
  | 'accept_lovable'
  | 'acknowledged'
  | 'pending_admin_approval'
  | 'mapped_employee';

export interface ReconciliationOverrideRow {
  id: string;
  issue_key: string;
  issue_type: string;
  resolution: ReconciliationResolution;
  note: string | null;
  date_key: string;
  provider_id: string | null;
  approved_shift_id: string | null;
  homebase_shift_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const useReconciliationOverrides = (
  startDate: string,
  endDate: string,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['schedule_reconciliation_overrides', startDate, endDate],
    enabled,
    queryFn: async (): Promise<Map<string, ReconciliationOverrideRow>> => {
      const { data, error } = await supabase
        .from('schedule_reconciliation_overrides')
        .select('*')
        .gte('date_key', startDate)
        .lte('date_key', endDate);
      if (error) throw error;
      const map = new Map<string, ReconciliationOverrideRow>();
      for (const row of (data ?? []) as ReconciliationOverrideRow[]) {
        map.set(row.issue_key, row);
      }
      return map;
    },
    staleTime: 15_000,
  });

export interface ApplyOverrideInput {
  issue_key: string;
  issue_type: string;
  resolution: ReconciliationResolution;
  note?: string | null;
  date_key: string;
  provider_id?: string | null;
  approved_shift_id?: string | null;
  homebase_shift_id?: string | null;
}

export const useApplyReconciliationOverride = () => {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async (input: ApplyOverrideInput) => {
      const payload = {
        ...input,
        note: input.note ?? null,
        provider_id: input.provider_id ?? null,
        approved_shift_id: input.approved_shift_id ?? null,
        homebase_shift_id: input.homebase_shift_id ?? null,
        created_by: profile?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('schedule_reconciliation_overrides')
        .upsert(payload, { onConflict: 'issue_key' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_reconciliation_overrides'] });
    },
  });
};

export const useRemoveReconciliationOverride = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (issue_key: string) => {
      const { error } = await supabase
        .from('schedule_reconciliation_overrides')
        .delete()
        .eq('issue_key', issue_key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule_reconciliation_overrides'] });
    },
  });
};

export const useLinkHomebaseEmployee = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ homebase_name, profile_id }: { homebase_name: string; profile_id: string }) => {
      const { error } = await supabase
        .from('provider_name_mappings')
        .upsert({ homebase_name, profile_id }, { onConflict: 'homebase_name' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider_name_mappings'] });
    },
  });
};

export const useProviderProfilesForLink = () =>
  useQuery({
    queryKey: ['profiles_for_link'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, credentials')
        .order('full_name', { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });