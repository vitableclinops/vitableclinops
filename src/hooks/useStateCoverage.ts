import { useQuery } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';

export type StateCoverageRow = {
  state: string;
  needed: number;
  filled: number;
  leftover: number;
  pct_filled: number;
};

const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m);

export function useStateCoverage(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'state-coverage', monthStart],
    queryFn: async (): Promise<{ rows: StateCoverageRow[]; unassignedHours: number }> => {
      const [targetsRes, shiftsRes] = await Promise.all([
        clinopsSupabase
          .from('state_demand_targets')
          .select('state, monthly_hours_target')
          .eq('month', monthStart),
        clinopsSupabase
          .from('shift_recommendations')
          .select('assigned_state, hours, recommendation')
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
      let unassignedHours = 0;
      for (const s of shiftsRes.data ?? []) {
        const hrs = Number(s.hours ?? 0);
        if (!s.assigned_state) {
          unassignedHours += hrs;
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
      return { rows, unassignedHours };
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}
