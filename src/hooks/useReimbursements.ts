import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ReimbursementRequest {
  id: string;
  provider_id: string;
  provider_name: string;
  state_abbreviation: string;
  license_application_id: string | null;
  application_fee_amount: number | null;
  application_fee_receipt_url: string | null;
  admin_hours_spent: number | null;
  hourly_rate: number;
  admin_time_total: number | null;
  total_reimbursement: number | null;
  status: string;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  processed_at: string | null;
  processed_by: string | null;
  description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface UseReimbursementsOptions {
  providerId?: string;
  status?: string[];
}

export const useReimbursements = (options: UseReimbursementsOptions = {}) => {
  const [requests, setRequests] = useState<ReimbursementRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('reimbursement_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (options.providerId) {
        query = query.eq('provider_id', options.providerId);
      }
      if (options.status?.length) {
        query = query.in('status', options.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRequests((data || []) as ReimbursementRequest[]);
    } catch (error) {
      console.error('Error fetching reimbursements:', error);
    } finally {
      setLoading(false);
    }
  }, [options.providerId, options.status]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const createRequest = async (request: Partial<ReimbursementRequest>) => {
    try {
      const { data, error } = await supabase
        .from('reimbursement_requests')
        .insert([request as any])
        .select()
        .single();
      if (error) throw error;
      setRequests(prev => [data as ReimbursementRequest, ...prev]);
      toast({ title: 'Reimbursement submitted', description: 'Your request has been submitted for review.' });
      return data;
    } catch (error) {
      console.error('Error creating reimbursement:', error);
      toast({ title: 'Error', description: 'Failed to submit reimbursement.', variant: 'destructive' });
      throw error;
    }
  };

  const updateRequest = async (id: string, updates: Partial<ReimbursementRequest>) => {
    try {
      const { data, error } = await supabase
        .from('reimbursement_requests')
        .update(updates as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      setRequests(prev => prev.map(r => r.id === id ? data as ReimbursementRequest : r));
      return data;
    } catch (error) {
      console.error('Error updating reimbursement:', error);
      toast({ title: 'Error', description: 'Failed to update reimbursement.', variant: 'destructive' });
      throw error;
    }
  };

  const approveRequest = async (id: string, reviewerId: string, notes?: string) => {
    return updateRequest(id, {
      status: 'approved',
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes || null,
    } as any);
  };

  const rejectRequest = async (id: string, reviewerId: string, notes: string) => {
    return updateRequest(id, {
      status: 'rejected',
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes,
    } as any);
  };

  const markProcessed = async (id: string, processedById: string) => {
    return updateRequest(id, {
      status: 'processed',
      processed_by: processedById,
      processed_at: new Date().toISOString(),
    } as any);
  };

  return {
    requests,
    loading,
    refetch: fetchRequests,
    createRequest,
    updateRequest,
    approveRequest,
    rejectRequest,
    markProcessed,
  };
};
