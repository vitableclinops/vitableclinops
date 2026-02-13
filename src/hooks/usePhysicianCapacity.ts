import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  const [capacity, setCapacity] = useState<PhysicianCapacityInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!physicianEmail || !stateAbbreviation) {
      setCapacity(null);
      return;
    }

    const fetchCapacity = async () => {
      try {
        setLoading(true);

        // Always fetch the latest ratio from the DB to avoid stale cache
        const { data: stateConfig } = await supabase
          .from('state_compliance_requirements')
          .select('np_md_ratio_limit')
          .eq('state_abbreviation', stateAbbreviation)
          .single();

        const ratioLimit = stateConfig?.np_md_ratio_limit ?? _ratioLimitFallback;
        if (!ratioLimit) {
          setCapacity(null);
          setLoading(false);
          return;
        }

        // Get all active collaborative agreements for this physician in this state
        const { data: agreements, error } = await supabase
          .from('collaborative_agreements')
          .select('id, physician_email, physician_name')
          .eq('physician_email', physicianEmail)
          .eq('state_abbreviation', stateAbbreviation)
          .neq('workflow_status', 'cancelled');

        if (error) throw error;

        const activeCount = agreements?.length ?? 0;
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
    };

    fetchCapacity();
  }, [physicianEmail, stateAbbreviation, _ratioLimitFallback]);

  return { capacity, loading };
};
