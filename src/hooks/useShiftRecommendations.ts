import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import type { ClinOpsTables, ClinOpsViews } from '@/integrations/supabase/clinopsTypes';
import {
  dedupeShiftRecommendationRows,
  filterRowsToLatestSubmissions,
  type LatestSchedulingSubmission,
} from '@/lib/scheduling/latestSubmissions';

export type ShiftRecommendation = ClinOpsTables<'shift_recommendations'>;
export type ProviderShiftSummary = ClinOpsViews<'v_provider_shift_summary'>;

const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m);

export function useProviderShiftSummary(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['clinops', 'v_provider_shift_summary', monthStart],
    queryFn: async (): Promise<ProviderShiftSummary[]> => {
      const { data, error } = await clinopsSupabase
        .from('v_provider_shift_summary')
        .select('*')
        .eq('target_month', monthStart);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useShiftRecommendations(month: string, providerId?: string | null) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['clinops', 'shift_recommendations', monthStart, providerId ?? 'all'],
    queryFn: async (): Promise<ShiftRecommendation[]> => {
      let q = clinopsSupabase
        .from('shift_recommendations')
        .select('*')
        .eq('target_month', monthStart)
        .order('shift_date', { ascending: true })
        .order('start_min', { ascending: true });
      if (providerId) q = q.eq('provider_id', providerId);
      let submissionsQuery = clinopsSupabase
        .from('schedule_submissions')
        .select('id, provider_id, target_month, decision_status, submitted_at')
        .eq('target_month', monthStart);
      if (providerId) submissionsQuery = submissionsQuery.eq('provider_id', providerId);
      const [shiftsRes, submissionsRes] = await Promise.all([
        q.range(0, 9999),
        submissionsQuery.range(0, 9999),
      ]);
      if (shiftsRes.error) throw shiftsRes.error;
      if (submissionsRes.error) throw submissionsRes.error;
      return dedupeShiftRecommendationRows(
        filterRowsToLatestSubmissions(
          shiftsRes.data ?? [],
          (submissionsRes.data ?? []) as LatestSchedulingSubmission[],
        ),
      );
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useUpdateShiftStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      publish_status: 'pending' | 'published_to_homebase' | 'confirmed' | 'cancelled';
      homebase_shift_id?: string | null;
    }) => {
      const patch: Record<string, unknown> = {
        publish_status: args.publish_status,
        published_at:
          args.publish_status === 'published_to_homebase' ? new Date().toISOString() : null,
      };
      if (args.homebase_shift_id !== undefined) {
        patch.homebase_shift_id = args.homebase_shift_id;
      }
      const { error } = await clinopsSupabase
        .from('shift_recommendations')
        .update(patch)
        .eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinops', 'shift_recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['clinops', 'v_provider_shift_summary'] });
    },
  });
}

export const formatTime = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const SHIFT_TYPE_LABEL: Record<string, string> = {
  virtual_recurring: 'Recurring virtual',
  virtual_oneoff: 'One-off virtual',
  in_home_clinic: 'In-home / clinic',
};
