import { useQuery } from '@tanstack/react-query';
import { AGREEMENT_REFRESH_OPTIONS } from '@/lib/agreementRefresh';
import { supabase } from '@/integrations/supabase/client';
import { isActiveSlotAgreement } from '@/lib/physicianSlots';
import { CONFIRMED_PHYSICIAN_COUNTS_KEY, confirmedPhysicianCount } from '@/lib/confirmedPhysicianCounts';

export interface PhysicianCapacityInfo {
  physicianName: string;
  physicianEmail: string;
  activeProviderCount: number;
  capacityLimit: number | null;
  isAtCapacity: boolean;
  utilization: number | null; // percentage
}

export const usePhysicianCapacity = (
  physicianEmail: string,
  stateAbbreviation: string | undefined,
  _ratioLimitFallback: number | null
) => {
  const query = useQuery({
    queryKey: ['agreements', 'physician-capacity', physicianEmail, stateAbbreviation, _ratioLimitFallback],
    enabled: !!physicianEmail && !!stateAbbreviation,
    ...AGREEMENT_REFRESH_OPTIONS,
    queryFn: async (): Promise<PhysicianCapacityInfo | null> => {
      let capacity: PhysicianCapacityInfo | null = null;
      const setCapacity = (c: PhysicianCapacityInfo | null) => { capacity = c; };
      const setLoading = (_: boolean) => {};
      try {
        setLoading(true);

        // Always fetch the latest ratio from the DB to avoid stale cache
        const { data: stateConfig } = await supabase
          .from('state_compliance_requirements')
          .select('np_md_ratio_limit')
          .eq('state_abbreviation', stateAbbreviation)
          .single();

        // A saved null means unlimited, not a reason to reuse a stale cached limit.
        const ratioLimit = stateConfig ? stateConfig.np_md_ratio_limit : _ratioLimitFallback;
        if (!ratioLimit) {
          setCapacity(null);
          setLoading(false);
          return null;
        }

        // Only currently active, date-valid agreements count toward capacity
        const { data: rawAgreements, error } = await supabase
          .from('collaborative_agreements')
          .select('id, physician_email, physician_name, physician_id, workflow_status, start_date, end_date')
          .ilike('physician_email', physicianEmail)
          .eq('state_abbreviation', stateAbbreviation);

        if (error) throw error;

        const agreements = (rawAgreements ?? []).filter(a =>
          isActiveSlotAgreement({ status: a.workflow_status, start: a.start_date, end: a.end_date })
        );

        // Confirmed physician totals (incl. outside practices) take precedence when saved
        const physicianId = (rawAgreements ?? []).find(a => a.physician_id)?.physician_id ?? null;
        const { data: cfg } = await supabase
          .from('system_config').select('value').eq('key', CONFIRMED_PHYSICIAN_COUNTS_KEY).maybeSingle();
        const confirmed = confirmedPhysicianCount(cfg?.value, physicianId, stateAbbreviation);

        const activeCount = confirmed ?? agreements.length;
        const isAtCapacity = activeCount >= ratioLimit;
        const utilization = Math.round((activeCount / ratioLimit) * 100);

        setCapacity({
          physicianName: agreements?.[0]?.physician_name || physicianEmail,
          physicianEmail,
          activeProviderCount: activeCount,
          capacityLimit: ratioLimit,
          isAtCapacity,
          utilization,
        });
      } catch (err) {
        console.error('Error fetching physician capacity:', err);
        setCapacity(null);
      } finally {
        setLoading(false);
      }

      return capacity;
    },
  });

  return { capacity: query.data ?? null, loading: query.isFetching };
};
