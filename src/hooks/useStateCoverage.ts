import { useQuery } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import {
  ACCESS_GROWTH_BUFFER_MULTIPLIER,
  computeStateCoverage,
  type CoverageStatus,
  type CoverageShiftInput,
  type InHomeProviderHours,
  type StateCoverageComputedRow,
} from '@/lib/scheduling/coverage';
import {
  dedupeShiftRecommendationRows,
  filterRowsToLatestAcceptedSubmissions,
  type LatestSchedulingSubmission,
  type ShiftRecommendationNaturalIdentity,
} from '@/lib/scheduling/latestSubmissions';

export type StateCoverageRow = StateCoverageComputedRow;
export type { CoverageStatus, InHomeProviderHours };

const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m);

export function useStateCoverage(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'state-coverage', monthStart],
    queryFn: async (): Promise<{
      rows: StateCoverageRow[];
      inHomeHours: number;
      inHomeBreakdown: InHomeProviderHours[];
      otherUnassignedHours: number;
    }> => {
      const [targetsRes, shiftsRes, providersRes, licensesRes, submissionsRes] = await Promise.all([
        clinopsSupabase
          .from('state_demand_targets')
          .select('state, monthly_hours_target')
          .eq('month', monthStart),
        clinopsSupabase
          .from('shift_recommendations')
          .select('id, submission_id, provider_id, target_month, shift_date, start_min, end_min, assigned_state, hours, shift_type, provider_name, publish_status, updated_at, created_at')
          .eq('target_month', monthStart)
          .eq('recommendation', 'publish')
          .range(0, 9999),
        clinopsSupabase
          .from('providers')
          .select('id, name, profession, active')
          .eq('active', true)
          .range(0, 49999),
        clinopsSupabase
          .from('v_provider_state_eligibility')
          .select('provider_id, state, allocation_eligible')
          .eq('allocation_eligible', true)
          .range(0, 49999),
        clinopsSupabase
          .from('schedule_submissions')
          .select('id, provider_id, target_month, decision_status, submitted_at')
          .eq('target_month', monthStart)
          .range(0, 49999),
      ]);

      if (targetsRes.error) throw targetsRes.error;
      if (shiftsRes.error) throw shiftsRes.error;
      if (providersRes.error) throw providersRes.error;
      if (licensesRes.error) throw licensesRes.error;
      if (submissionsRes.error) throw submissionsRes.error;

      const submissions = (submissionsRes.data ?? []) as LatestSchedulingSubmission[];
      const scopedShifts = dedupeShiftRecommendationRows(
        filterRowsToLatestAcceptedSubmissions(
          (shiftsRes.data ?? []) as Array<CoverageShiftInput & ShiftRecommendationNaturalIdentity>,
          submissions,
        ),
      );

      return computeStateCoverage({
        targets: targetsRes.data ?? [],
        shifts: scopedShifts,
        providers: providersRes.data ?? [],
        licenses: (licensesRes.data ?? []).map(row => ({
          provider_id: row.provider_id,
          state: row.state,
          status: row.allocation_eligible ? 'active' : 'inactive',
        })),
        submissions,
        demandMultiplier: ACCESS_GROWTH_BUFFER_MULTIPLIER,
      });
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}
