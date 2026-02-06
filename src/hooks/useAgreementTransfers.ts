import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type AgreementTransfer = Tables<'agreement_transfers'>;

interface UseAgreementTransfersOptions {
  status?: string[];
  stateAbbreviation?: string;
  limit?: number;
}

export const useAgreementTransfers = (options: UseAgreementTransfersOptions = {}) => {
  const [transfers, setTransfers] = useState<AgreementTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('agreement_transfers')
        .select('*')
        .order('created_at', { ascending: false });

      if (options.status && options.status.length > 0) {
        query = query.in('status', options.status);
      }

      if (options.stateAbbreviation) {
        query = query.eq('state_abbreviation', options.stateAbbreviation);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTransfers(data || []);
    } catch (error) {
      console.error('Error fetching transfers:', error);
    } finally {
      setLoading(false);
    }
  }, [options.status, options.stateAbbreviation, options.limit]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  return {
    transfers,
    loading,
    refetch: fetchTransfers,
  };
};