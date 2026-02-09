import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Agency {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const useAgencies = () => {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAgencies = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('agencies')
        .select('*')
        .order('name');
      if (error) throw error;
      setAgencies((data || []) as Agency[]);
    } catch (error) {
      console.error('Error fetching agencies:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgencies();
  }, [fetchAgencies]);

  const createAgency = async (agency: Partial<Agency>) => {
    try {
      const { data, error } = await supabase
        .from('agencies')
        .insert([agency as any])
        .select()
        .single();
      if (error) throw error;
      setAgencies(prev => [...prev, data as Agency]);
      toast({ title: 'Agency created', description: `${(data as Agency).name} has been added.` });
      return data;
    } catch (error) {
      console.error('Error creating agency:', error);
      toast({ title: 'Error', description: 'Failed to create agency.', variant: 'destructive' });
      throw error;
    }
  };

  const updateAgency = async (id: string, updates: Partial<Agency>) => {
    try {
      const { data, error } = await supabase
        .from('agencies')
        .update(updates as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      setAgencies(prev => prev.map(a => a.id === id ? data as Agency : a));
      return data;
    } catch (error) {
      console.error('Error updating agency:', error);
      toast({ title: 'Error', description: 'Failed to update agency.', variant: 'destructive' });
      throw error;
    }
  };

  return { agencies, loading, refetch: fetchAgencies, createAgency, updateAgency };
};
