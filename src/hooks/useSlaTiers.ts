import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  SLA_TIER_BY_STATE,
  type SlaTier,
  type SlaTierRule,
} from '@/constants/slaTiers';

/**
 * Reads the state-level SLA rules in force today from
 * public.sla_tier_by_state_current.
 *
 * Prefer this over the static SLA_TIER_BY_STATE map wherever an async read
 * is possible: the table is the source of truth, and a tier change made
 * there should take effect without a deploy. The static map is used only as
 * a fallback when the query fails, so a transient outage degrades to
 * last-known-good rules rather than to no rules at all.
 */

export interface SlaTierRuleWithSource extends SlaTierRule {
  effectiveFrom: string | null;
  source: string | null;
}

type CurrentRow = {
  state: string | null;
  sla_tier: string | null;
  horizon_days: number | null;
  physician_only: boolean | null;
  min_slots_window: number | null;
  min_slots_sameday: number | null;
  effective_from: string | null;
  source: string | null;
};

function staticFallback(): Record<string, SlaTierRuleWithSource> {
  return Object.fromEntries(
    Object.entries(SLA_TIER_BY_STATE).map(([state, rule]) => [state, {
      ...rule,
      effectiveFrom: null,
      source: 'static-fallback',
    }]),
  );
}

function isSlaTier(value: string | null): value is SlaTier {
  return value === 'same_day' || value === 'next_day' || value === 'within_48h';
}

export function useSlaTiers() {
  return useQuery({
    queryKey: ['sla_tier_by_state_current'],
    queryFn: async (): Promise<{
      rules: Record<string, SlaTierRuleWithSource>;
      usedFallback: boolean;
    }> => {
      const { data, error } = await supabase
        .from('sla_tier_by_state_current')
        .select('state, sla_tier, horizon_days, physician_only, min_slots_window, min_slots_sameday, effective_from, source');

      if (error || !data || data.length === 0) {
        return { rules: staticFallback(), usedFallback: true };
      }

      const rules: Record<string, SlaTierRuleWithSource> = {};
      for (const row of data as CurrentRow[]) {
        const state = row.state?.trim().toUpperCase();
        if (!state || !isSlaTier(row.sla_tier)) continue;

        const horizon = row.horizon_days;
        rules[state] = {
          state,
          tier: row.sla_tier,
          horizonDays: (horizon === 0 || horizon === 1 || horizon === 2) ? horizon : 2,
          physicianOnly: row.physician_only ?? false,
          minSlotsWindow: row.min_slots_window,
          minSlotsSameDay: row.min_slots_sameday,
          effectiveFrom: row.effective_from,
          source: row.source,
        };
      }

      // An empty or unparseable result set is worse than the static map.
      if (Object.keys(rules).length === 0) {
        return { rules: staticFallback(), usedFallback: true };
      }

      return { rules, usedFallback: false };
    },
    // SLA rules change on the order of months, so this can be cached hard.
    staleTime: 15 * 60_000,
  });
}
