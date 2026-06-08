import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import type { ClinOpsTables, ClinOpsViews } from '@/integrations/supabase/clinopsTypes';
import {
  dedupeShiftRecommendationRows,
  filterRowsToLatestSubmissions,
  type LatestSchedulingSubmission,
} from '@/lib/scheduling/latestSubmissions';
import {
  attachHomebaseConfirmations,
  type HomebaseEmployeeLike,
  type HomebaseShiftConfirmation,
  type HomebaseShiftLike,
  type WithHomebaseConfirmation,
} from '@/lib/scheduling/homebaseConfirmation';

type BaseShiftRecommendation = ClinOpsTables<'shift_recommendations'>;
type BaseProviderShiftSummary = ClinOpsViews<'v_provider_shift_summary'>;

export type ShiftRecommendation = WithHomebaseConfirmation<BaseShiftRecommendation>;
export type ProviderShiftSummary = BaseProviderShiftSummary & {
  homebase_published_count: number;
  homebase_unpublished_count: number;
  homebase_unscheduled_count: number;
  homebase_missing_count: number;
  homebase_last_synced_at: string | null;
};
export interface HomebaseDateWindow {
  startDate: string;
  endDate: string;
}

const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m);
const nextDayIso = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
};

export function useProviderShiftSummary(month: string, homebaseWindow?: HomebaseDateWindow) {
  const monthStart = monthIso(month);
  const homebaseStart = homebaseWindow?.startDate ?? monthStart;
  const homebaseEnd = homebaseWindow?.endDate ?? monthEndIso(monthStart);
  return useQuery({
    queryKey: ['clinops', 'v_provider_shift_summary', monthStart, homebaseStart, homebaseEnd],
    queryFn: async (): Promise<ProviderShiftSummary[]> => {
      const summaryQuery = clinopsSupabase
        .from('v_provider_shift_summary')
        .select('*')
        .eq('target_month', monthStart);
      const recommendationsQuery = clinopsSupabase
        .from('shift_recommendations')
        .select('*')
        .eq('target_month', monthStart)
        .eq('recommendation', 'publish')
        .range(0, 9999);
      const submissionsQuery = clinopsSupabase
        .from('schedule_submissions')
        .select('id, provider_id, target_month, decision_status, submitted_at')
        .eq('target_month', monthStart)
        .range(0, 9999);

      const [summaryRes, recommendationsRes, submissionsRes, homebase] = await Promise.all([
        summaryQuery,
        recommendationsQuery,
        submissionsQuery,
        fetchHomebaseRowsForWindow({ startDate: homebaseStart, endDate: homebaseEnd }),
      ]);
      if (summaryRes.error) throw summaryRes.error;
      if (recommendationsRes.error) throw recommendationsRes.error;
      if (submissionsRes.error) throw submissionsRes.error;

      const currentRecommendations = dedupeShiftRecommendationRows(
        filterRowsToLatestSubmissions(
          recommendationsRes.data ?? [],
          (submissionsRes.data ?? []) as LatestSchedulingSubmission[],
        ),
      );
      const confirmedRows = attachHomebaseConfirmations(
        currentRecommendations,
        homebase.shifts,
        homebase.employees,
      );
      const homebaseCounts = summarizeHomebaseByProvider(confirmedRows);

      return (summaryRes.data ?? []).map(row => ({
        ...row,
        ...emptyHomebaseSummary(),
        ...(homebaseCounts.get(providerSummaryKey(row)) ?? {}),
      }));
    },
    staleTime: 60_000,
  });
}

export function useShiftRecommendations(month: string, providerId?: string | null, homebaseWindow?: HomebaseDateWindow) {
  const monthStart = monthIso(month);
  const homebaseStart = homebaseWindow?.startDate ?? monthStart;
  const homebaseEnd = homebaseWindow?.endDate ?? monthEndIso(monthStart);
  return useQuery({
    queryKey: ['clinops', 'shift_recommendations', monthStart, providerId ?? 'all', homebaseStart, homebaseEnd],
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
      const currentRecommendations = dedupeShiftRecommendationRows(
        filterRowsToLatestSubmissions(
          shiftsRes.data ?? [],
          (submissionsRes.data ?? []) as LatestSchedulingSubmission[],
        ),
      );
      const homebase = await fetchHomebaseRowsForWindow({ startDate: homebaseStart, endDate: homebaseEnd });
      return attachHomebaseConfirmations(
        currentRecommendations,
        homebase.shifts,
        homebase.employees,
      );
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useRefreshHomebaseMonth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (windowOrMonth: string | HomebaseDateWindow) => {
      const body = typeof windowOrMonth === 'string'
        ? { month: monthIso(windowOrMonth) }
        : { start_date: windowOrMonth.startDate, end_date: windowOrMonth.endDate };
      const { data, error } = await clinopsSupabase.functions.invoke('sync-homebase', {
        body,
      });
      if (error) throw error;
      return data as {
        ok?: boolean;
        shifts_synced?: number;
        employees_synced?: number;
        locations_synced?: number;
        sync_window?: { mode?: string; startDate?: string; endDate?: string };
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinops', 'shift_recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['clinops', 'v_provider_shift_summary'] });
    },
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

function monthEndIso(monthStart: string) {
  const [year, month] = monthIso(monthStart).split('-').map(Number);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
}

async function fetchHomebaseRowsForWindow(window: HomebaseDateWindow): Promise<{
  shifts: HomebaseShiftLike[];
  employees: HomebaseEmployeeLike[];
}> {
  try {
    if (!isIsoDate(window.startDate) || !isIsoDate(window.endDate) || window.startDate > window.endDate) {
      return { shifts: [], employees: [] };
    }

    const { data: shifts, error: shiftsError } = await clinopsSupabase
      .from('homebase_shifts')
      .select('homebase_id, homebase_employee_id, published, scheduled, start_at, end_at, synced_at')
      .gte('start_at', window.startDate)
      .lt('start_at', nextDayIso(window.endDate))
      .range(0, 49999);
    if (shiftsError) throw shiftsError;

    const employeeIds = Array.from(new Set(
      (shifts ?? [])
        .map(shift => shift.homebase_employee_id)
        .filter((id): id is string => Boolean(id)),
    ));

    if (employeeIds.length === 0) {
      return { shifts: shifts ?? [], employees: [] };
    }

    const { data: employees, error: employeesError } = await clinopsSupabase
      .from('homebase_employees')
      .select('id, profile_id')
      .in('id', employeeIds)
      .range(0, 49999);
    if (employeesError) throw employeesError;

    return {
      shifts: shifts ?? [],
      employees: employees ?? [],
    };
  } catch (err) {
    // Keep the shift plan usable even if Homebase sync tables are temporarily unavailable.
    console.warn('[useShiftRecommendations] Homebase confirmation lookup failed', err);
    return { shifts: [], employees: [] };
  }
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function summarizeHomebaseByProvider(rows: ShiftRecommendation[]) {
  const counts = new Map<string, ReturnType<typeof emptyHomebaseSummary>>();
  for (const row of rows) {
    const key = providerSummaryKey(row);
    if (!key) continue;
    const current = counts.get(key) ?? emptyHomebaseSummary();
    incrementHomebaseSummary(current, row.homebase_confirmation);
    counts.set(key, current);
  }
  return counts;
}

function providerSummaryKey(row: { provider_id: string | null; provider_name?: string | null }) {
  return row.provider_id ?? row.provider_name ?? null;
}

function emptyHomebaseSummary() {
  return {
    homebase_published_count: 0,
    homebase_unpublished_count: 0,
    homebase_unscheduled_count: 0,
    homebase_missing_count: 0,
    homebase_last_synced_at: null as string | null,
  };
}

function incrementHomebaseSummary(
  summary: ReturnType<typeof emptyHomebaseSummary>,
  confirmation: HomebaseShiftConfirmation,
) {
  if (confirmation.status === 'published') summary.homebase_published_count++;
  if (confirmation.status === 'unpublished') summary.homebase_unpublished_count++;
  if (confirmation.status === 'unscheduled') summary.homebase_unscheduled_count++;
  if (confirmation.status === 'not_found') summary.homebase_missing_count++;
  if (confirmation.synced_at && (!summary.homebase_last_synced_at || confirmation.synced_at > summary.homebase_last_synced_at)) {
    summary.homebase_last_synced_at = confirmation.synced_at;
  }
}
