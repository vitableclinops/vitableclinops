import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface MilestoneTask {
  id: string;
  provider_id: string;
  provider_name: string;
  provider_email: string | null;
  milestone_type: 'birthday' | 'anniversary';
  milestone_date: string;
  milestone_year: number;
  assigned_to: string | null;
  assigned_to_name: string | null;
  pod_id: string | null;
  status: 'pending' | 'completed' | 'skipped';
  title: string;
  description: string | null;
  slack_template: string | null;
  due_date: string;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
}

export interface Pod {
  id: string;
  name: string;
  description: string | null;
  pod_lead_id: string | null;
  pod_lead_name: string | null;
  pod_lead_email: string | null;
  slack_channel: string | null;
  created_at: string;
}

export function useUpcomingMilestones(days: number = 14) {
  return useQuery({
    queryKey: ['upcoming-milestones', days],
    queryFn: async () => {
      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + days);

      const { data, error } = await supabase
        .from('milestone_tasks')
        .select('*')
        .gte('milestone_date', today.toISOString().split('T')[0])
        .lte('milestone_date', endDate.toISOString().split('T')[0])
        .eq('status', 'pending')
        .order('milestone_date', { ascending: true });

      if (error) throw error;
      return data as MilestoneTask[];
    },
  });
}

export function useMyMilestoneTasks() {
  return useQuery({
    queryKey: ['my-milestone-tasks'],
    queryFn: async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (!profile) return [];

      const { data, error } = await supabase
        .from('milestone_tasks')
        .select('*')
        .eq('assigned_to', profile.id)
        .eq('status', 'pending')
        .order('due_date', { ascending: true });

      if (error) throw error;
      return data as MilestoneTask[];
    },
  });
}

export function useCompleteMilestoneTask() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ taskId, notes }: { taskId: string; notes?: string }) => {
      const { data: user } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from('milestone_tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user.user?.id,
        })
        .eq('id', taskId);

      if (error) throw error;

      // Log the completion
      await supabase.from('milestone_audit_log').insert({
        milestone_task_id: taskId,
        action: 'task_completed',
        actor_id: user.user?.id,
        actor_name: user.user?.user_metadata?.full_name || user.user?.email,
        details: { notes },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upcoming-milestones'] });
      queryClient.invalidateQueries({ queryKey: ['my-milestone-tasks'] });
      toast({ title: 'Milestone task completed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}

export function usePods() {
  return useQuery({
    queryKey: ['pods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pods')
        .select('*')
        .order('name');

      if (error) throw error;
      return data as Pod[];
    },
  });
}

export function useCreatePod() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (pod: Omit<Pod, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('pods')
        .insert(pod)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pods'] });
      toast({ title: 'Pod created successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating pod', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateProviderMilestoneSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      profileId,
      dateOfBirth,
      startDateOnNetwork,
      milestoneVisibility,
      podId,
    }: {
      profileId: string;
      dateOfBirth?: string | null;
      startDateOnNetwork?: string | null;
      milestoneVisibility?: string;
      podId?: string | null;
    }) => {
      const updates: any = {};
      if (dateOfBirth !== undefined) updates.date_of_birth = dateOfBirth;
      if (startDateOnNetwork !== undefined) updates.start_date_on_network = startDateOnNetwork;
      if (milestoneVisibility !== undefined) updates.milestone_visibility = milestoneVisibility;
      if (podId !== undefined) updates.pod_id = podId;

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', profileId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast({ title: 'Milestone settings updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating settings', description: error.message, variant: 'destructive' });
    },
  });
}
