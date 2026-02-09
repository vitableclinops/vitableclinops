import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Enhancement {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useEnhancements() {
  return useQuery({
    queryKey: ['enhancement-registry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enhancement_registry')
        .select('*')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Enhancement[];
    },
  });
}

export function useCreateEnhancement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (enhancement: Partial<Enhancement>) => {
      const { data, error } = await supabase
        .from('enhancement_registry')
        .insert({
          title: enhancement.title || 'Untitled',
          description: enhancement.description,
          category: enhancement.category || 'general',
          priority: enhancement.priority || 'medium',
          status: enhancement.status || 'proposed',
          requested_by: enhancement.requested_by,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enhancement-registry'] });
      toast({ title: 'Enhancement added to registry' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateEnhancement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Enhancement> & { id: string }) => {
      const { error } = await supabase
        .from('enhancement_registry')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enhancement-registry'] });
      toast({ title: 'Enhancement updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}
