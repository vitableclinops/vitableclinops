import { useQuery } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';

export type StateCoverageRow = {
  state: string;
  needed: number;
  filled: number;
  leftover: number;
  pct_filled: number;
};

export type InHomeProviderHours = {
  provider_name: string;
  hours: number;
  shifts: number;
};

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
      const [targetsRes, shiftsRes] = await Promise.all([
        clinopsSupabase
          .from('state_demand_targets')
          .select('state, monthly_hours_target')
          .eq('month', monthStart),
        clinopsSupabase
          .from('shift_recommendations')
          .select('assigned_state, hours, shift_type, provider_name')
          .eq('target_month', monthStart)
          .eq('recommendation', 'publish')
          .range(0, 9999),
      ]);

      if (targetsRes.error) throw targetsRes.error;
      if (shiftsRes.error) throw shiftsRes.error;

      const needed = new Map<string, number>();
      for (const t of targetsRes.data ?? []) {
        needed.set(t.state, Number(t.monthly_hours_target ?? 0));
      }

      const filled = new Map<string, number>();
      let inHomeHours = 0;
      let otherUnassignedHours = 0;
      const inHomeByProvider = new Map<string, { hours: number; shifts: number }>();

      for (const s of shiftsRes.data ?? []) {
        const hrs = Number(s.hours ?? 0);
        const isInHome = s.shift_type === 'in_home_clinic';

        if (isInHome) {
          inHomeHours += hrs;
          const key = s.provider_name ?? 'Unknown';
          const cur = inHomeByProvider.get(key) ?? { hours: 0, shifts: 0 };
          cur.hours += hrs;
          cur.shifts += 1;
          inHomeByProvider.set(key, cur);
          if (s.assigned_state) {
            filled.set(s.assigned_state, (filled.get(s.assigned_state) ?? 0) + hrs);
          }
          continue;
        }

        if (!s.assigned_state) {
          otherUnassignedHours += hrs;
          continue;
        }
        filled.set(s.assigned_state, (filled.get(s.assigned_state) ?? 0) + hrs);
      }

      const allStates = new Set<string>([...needed.keys(), ...filled.keys()]);
      const rows: StateCoverageRow[] = Array.from(allStates).map(state => {
        const need = needed.get(state) ?? 0;
        const fill = filled.get(state) ?? 0;
        return {
          state,
          needed: need,
          filled: fill,
          leftover: need - fill,
          pct_filled: need > 0 ? Math.min(999, (fill / need) * 100) : fill > 0 ? 999 : 0,
        };
      });

      rows.sort((a, b) => a.state.localeCompare(b.state));

      const inHomeBreakdown: InHomeProviderHours[] = Array.from(
        inHomeByProvider.entries(),
      )
        .map(([provider_name, v]) => ({ provider_name, hours: v.hours, shifts: v.shifts }))
        .sort((a, b) => b.hours - a.hours);

      return { rows, inHomeHours, inHomeBreakdown, otherUnassignedHours };
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}
