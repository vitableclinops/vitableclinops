import { useQuery } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import { TELEMED_ROLES, buildDailyGaps, dowShares, hoursByDate, type ShiftLike } from '@/lib/gapFinder';

export type GapShift = ShiftLike & { id: string; homebase_employee_id: string | null; employee_name: string | null };

async function fetchShifts(fromIso: string, toIso: string): Promise<GapShift[]> {
  const rows: GapShift[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await clinopsSupabase
      .from('homebase_shifts')
      .select('id,start_at,end_at,scheduled_hours,role,homebase_employee_id,homebase_employees(first_name,last_name)')
      .in('role', TELEMED_ROLES)
      .gte('start_at', fromIso)
      .lt('start_at', toIso)
      .order('start_at')
      .range(offset, offset + 999);
    if (error) throw error;
    for (const r of (data ?? []) as any[]) {
      const e = r.homebase_employees;
      rows.push({ ...r, employee_name: e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : null });
    }
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** month = YYYY-MM-01 */
export function useGapFinder(month: string) {
  return useQuery({
    queryKey: ['gap-finder', month],
    queryFn: async () => {
      const [y, m] = month.split('-').map(Number);
      const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
      // Pad a day either side so Chicago-local dates are complete.
      const shifts = await fetchShifts(`${addDays(month, -1)}T00:00:00Z`, `${addDays(next, 1)}T00:00:00Z`);

      const today = new Date().toISOString().slice(0, 10);
      const historyShifts = await fetchShifts(`${addDays(today, -84)}T00:00:00Z`, `${today}T00:00:00Z`);
      const shares = dowShares(hoursByDate(historyShifts));

      const { data: targets, error } = await clinopsSupabase
        .from('state_demand_targets')
        .select('state,monthly_hours_target,inactive')
        .eq('month', month);
      if (error) throw error;
      const monthlyTarget = (targets ?? []).filter((t) => !t.inactive).reduce((s, t) => s + Number(t.monthly_hours_target ?? 0), 0);

      const { data: run } = await clinopsSupabase
        .from('sync_runs')
        .select('finished_at,status')
        .eq('function_name', 'sync-homebase')
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const days = buildDailyGaps(month, monthlyTarget, hoursByDate(shifts), shares);
      return { days, shifts, monthlyTarget, shares, lastSync: run?.finished_at ?? null, hasTargets: (targets ?? []).length > 0 };
    },
  });
}
