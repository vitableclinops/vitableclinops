import { useQuery } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import type { ClinOpsTables } from '@/integrations/supabase/clinopsTypes';

// NOTE on units: state_demand_targets.monthly_visits_target and
// monthly_hours_target both store the SAME number — monthly hours of
// provider availability needed. The "visits" name is legacy. For the July
// 2026 build, adjusted weekly demand is raw Metabase weekly demand × 0.95,
// and monthly hours use exact days-in-month / 7 rather than 4.33.
export type StateDemandRow = ClinOpsTables<'state_demand_targets'>;
export type ServiceLineDemandRow = ClinOpsTables<'service_line_demand_targets'>;

export interface ScheduleDecisionRow {
  id: string;
  jotform_submission_id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  decision_status: string;
  accepted_hours: number | null;
  declined_hours: number | null;
  decision_notes: string | null;
  submitted_at: string;
  decided_at: string | null;
}

export interface MonthlyForecastSummary {
  month: string;
  totalDemandVisits: number;
  totalDemandHours: number;
  totalAcceptedHours: number;
  totalDeclinedHours: number;
  fillRatePct: number | null;
  providerCount: number;
  acceptedCount: number;
  partialCount: number;
  declinedCount: number;
  pendingCount: number;
  costPerVisitProjection: number | null;
}

export interface StateSlaRiskRow {
  state: string;
  status: string;
  flaggedDays: number;
  totalDays: number;
  worstRatio: number | null;
  avgSlaPct: number | null;
}

const monthIso = (month: string) => {
  // Accept "2026-06" or "2026-06-01" — normalize to first-of-month ISO date.
  if (month.length === 7) return `${month}-01`;
  return month;
};

const nextMonthIso = (month: string) => {
  const [y, m] = monthIso(month).split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  return next.toISOString().slice(0, 10);
};

export function useMonthlyDemand(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['clinops', 'state_demand_targets', monthStart],
    queryFn: async (): Promise<StateDemandRow[]> => {
      const { data, error } = await clinopsSupabase
        .from('state_demand_targets')
        .select('*')
        .eq('month', monthStart)
        .order('monthly_visits_target', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useMonthlyServiceLineDemand(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['clinops', 'service_line_demand_targets', monthStart],
    queryFn: async (): Promise<ServiceLineDemandRow[]> => {
      const { data, error } = await clinopsSupabase
        .from('service_line_demand_targets')
        .select('*')
        .eq('month', monthStart)
        .order('service_line', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useMonthlyDecisions(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['clinops', 'schedule_submissions', monthStart],
    queryFn: async (): Promise<ScheduleDecisionRow[]> => {
      const { data, error } = await clinopsSupabase
        .from('schedule_submissions')
        .select(
          'id, jotform_submission_id, provider_id, provider_name, target_month, decision_status, accepted_hours, declined_hours, decision_notes, submitted_at, decided_at',
        )
        .eq('target_month', monthStart)
        .neq('decision_status', 'superseded')
        .order('provider_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScheduleDecisionRow[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useMonthlyCostPerVisit(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['clinops', 'v_monthly_cost_per_visit', monthStart],
    queryFn: async () => {
      const { data, error } = await clinopsSupabase
        .from('v_monthly_cost_per_visit')
        .select('*')
        .eq('month_start', monthStart)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useMonthlySlaRisk(month: string) {
  const monthStart = monthIso(month);
  const nextMonth = nextMonthIso(month);
  return useQuery({
    queryKey: ['clinops', 'sla_daily', monthStart],
    queryFn: async (): Promise<StateSlaRiskRow[]> => {
      const { data, error } = await clinopsSupabase
        .from('sla_daily')
        .select('state, date, ratio, sla_pct, sla_flagged, status')
        .gte('date', monthStart)
        .lt('date', nextMonth)
        .range(0, 9999);
      if (error) throw error;

      const byState = new Map<string, {
        statuses: string[];
        flaggedDays: number;
        totalDays: number;
        worstRatio: number | null;
        slaPctSum: number;
        slaPctCount: number;
      }>();
      for (const row of data ?? []) {
        const state = String(row.state ?? '').trim().toUpperCase();
        if (!state) continue;
        const cur = byState.get(state) ?? {
          statuses: [],
          flaggedDays: 0,
          totalDays: 0,
          worstRatio: null,
          slaPctSum: 0,
          slaPctCount: 0,
        };
        cur.totalDays += 1;
        if (row.status) cur.statuses.push(String(row.status));
        if (row.sla_flagged) cur.flaggedDays += 1;
        const ratio = Number(row.ratio);
        if (Number.isFinite(ratio)) {
          cur.worstRatio = cur.worstRatio == null ? ratio : Math.min(cur.worstRatio, ratio);
        }
        const slaPct = Number(row.sla_pct);
        if (Number.isFinite(slaPct)) {
          cur.slaPctSum += slaPct;
          cur.slaPctCount += 1;
        }
        byState.set(state, cur);
      }

      const severity = (status: string) => {
        const s = status.toLowerCase();
        if (s.includes('critical')) return 4;
        if (s.includes('gap') || s.includes('red')) return 3;
        if (s.includes('watch') || s.includes('risk') || s.includes('yellow')) return 2;
        if (s.includes('ok') || s.includes('green') || s.includes('healthy')) return 1;
        return 0;
      };

      return Array.from(byState.entries())
        .map(([state, v]) => {
          const status =
            [...v.statuses].sort((a, b) => severity(b) - severity(a))[0] ??
            (v.flaggedDays > 0 ? 'flagged' : 'no risk');
          return {
            state,
            status,
            flaggedDays: v.flaggedDays,
            totalDays: v.totalDays,
            worstRatio: v.worstRatio,
            avgSlaPct: v.slaPctCount ? v.slaPctSum / v.slaPctCount : null,
          };
        })
        .sort((a, b) => a.state.localeCompare(b.state));
    },
    staleTime: 5 * 60_000,
  });
}

export function useMonthlyForecastSummary(month: string): {
  summary: MonthlyForecastSummary | null;
  loading: boolean;
} {
  const demand = useMonthlyDemand(month);
  const decisions = useMonthlyDecisions(month);
  const cost = useMonthlyCostPerVisit(month);

  const loading = demand.isLoading || decisions.isLoading || cost.isLoading;

  if (!demand.data || !decisions.data) return { summary: null, loading };

  // Both columns hold the same value (hours of provider availability); we
  // use monthly_hours_target as the canonical figure.
  const totalDemandHours = demand.data.reduce((s, r) => s + Number(r.monthly_hours_target ?? 0), 0);
  const totalDemandVisits = totalDemandHours;

  let totalAcceptedHours = 0;
  let totalDeclinedHours = 0;
  let acceptedCount = 0;
  let partialCount = 0;
  let declinedCount = 0;
  let pendingCount = 0;
  const providerIds = new Set<string>();

  for (const row of decisions.data) {
    totalAcceptedHours += Number(row.accepted_hours ?? 0);
    totalDeclinedHours += Number(row.declined_hours ?? 0);
    if (row.provider_id) providerIds.add(row.provider_id);
    switch (row.decision_status) {
      case 'accepted':
        acceptedCount++;
        break;
      case 'partial':
        partialCount++;
        break;
      case 'declined':
        declinedCount++;
        break;
      default:
        pendingCount++;
    }
  }

  const fillRatePct = totalDemandHours > 0 ? (totalAcceptedHours / totalDemandHours) * 100 : null;

  // Cost-per-visit projection: total accepted hours × blended hourly rate / projected visits.
  // We don't have a network-blended rate handy; surface the prior month's actual if available.
  const costPerVisitProjection = cost.data?.approx_cost_per_completed_visit ?? null;

  const summary: MonthlyForecastSummary = {
    month: monthIso(month),
    totalDemandVisits,
    totalDemandHours,
    totalAcceptedHours,
    totalDeclinedHours,
    fillRatePct,
    providerCount: providerIds.size,
    acceptedCount,
    partialCount,
    declinedCount,
    pendingCount,
    costPerVisitProjection: costPerVisitProjection != null ? Number(costPerVisitProjection) : null,
  };

  return { summary, loading };
}

export const __test = { monthIso, nextMonthIso };
