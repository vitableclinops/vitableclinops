import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StateCompliance {
  id: string;
  state_abbreviation: string;
  state_name: string;
  ca_meeting_cadence: string | null;
  ca_required: boolean;
  collab_requirement_type: string | null;
  rxr_required: string | null;
  nlc: boolean;
  np_md_ratio: string | null;
  licenses: string | null;
  fpa_status: string | null;
  knowledge_base_url: string | null;
  steps_to_confirm_eligibility: string | null;
}

export const useStateCompliance = (stateAbbreviation?: string) => {
  const [data, setData] = useState<StateCompliance | null>(null);
  const [allData, setAllData] = useState<StateCompliance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('state_compliance_requirements')
        .select('*')
        .order('state_name');

      if (stateAbbreviation) {
        query = query.eq('state_abbreviation', stateAbbreviation);
        const { data: result, error: err } = await query.single();
        if (err) throw err;
        setData(result);
      } else {
        const { data: result, error: err } = await query;
        if (err) throw err;
        setAllData(result || []);
      }
      
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch state compliance data');
    } finally {
      setLoading(false);
    }
  }, [stateAbbreviation]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refetch function for manual refresh after updates
  const refetch = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // Get compliance data for a specific state from allData
  const getStateCompliance = useCallback((abbr: string) => {
    return allData.find(c => c.state_abbreviation === abbr) || null;
  }, [allData]);

  return { 
    data, 
    allData, 
    loading, 
    error, 
    refetch,
    getStateCompliance,
  };
};
