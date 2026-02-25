import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type AgreementTask = Tables<'agreement_tasks'>;
type AgreementTaskInsert = TablesInsert<'agreement_tasks'>;

interface UseAgreementTasksOptions {
  agreementId?: string;
  providerId?: string;
  status?: AgreementTask['status'][];
  limit?: number;
}

export const useAgreementTasks = (options: UseAgreementTasksOptions = {}) => {
  const [tasks, setTasks] = useState<AgreementTask[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('agreement_tasks')
        .select('*')
        .neq('status', 'archived')
        .order('due_date', { ascending: true, nullsFirst: false });

      if (options.agreementId) {
        query = query.eq('agreement_id', options.agreementId);
      }

      if (options.providerId) {
        query = query.eq('provider_id', options.providerId);
      }

      if (options.status && options.status.length > 0) {
        query = query.in('status', options.status);
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [options.agreementId, options.providerId, options.status, options.limit]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = async (task: AgreementTaskInsert) => {
    try {
      const { data, error } = await supabase
        .from('agreement_tasks')
        .insert([task])
        .select()
        .single();

      if (error) throw error;

      setTasks(prev => [...prev, data]);
      toast({
        title: 'Task created',
        description: 'The task has been created successfully.',
      });
      return data;
    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        title: 'Error',
        description: 'Failed to create task.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const updateTask = async (id: string, updates: Partial<AgreementTask>) => {
    try {
      const { data, error } = await supabase
        .from('agreement_tasks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setTasks(prev => prev.map(t => t.id === id ? data : t));
      return data;
    } catch (error) {
      console.error('Error updating task:', error);
      toast({
        title: 'Error',
        description: 'Failed to update task.',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const completeTask = async (id: string, completedBy: string) => {
    return updateTask(id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: completedBy,
    });
  };

  // Generate tasks for a new agreement and auto-link providers
  const generateAgreementTasks = async (
    agreementId: string,
    stateAbbreviation: string,
    stateName: string,
    providerId: string | null,
    physicianId: string | null
  ) => {
    const baseTasks: AgreementTaskInsert[] = [
      {
        agreement_id: agreementId,
        provider_id: providerId,
        physician_id: physicianId,
        title: 'Prepare agreement documents',
        description: 'Prepare and finalize the collaborative agreement document for signatures',
        category: 'agreement_creation',
        status: 'pending',
        priority: 'high',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'agreement_creation',
        state_abbreviation: stateAbbreviation,
        state_name: stateName,
      },
      {
        agreement_id: agreementId,
        provider_id: providerId,
        physician_id: physicianId,
        title: 'Send for signature',
        description: 'Send the agreement to all parties for electronic signature',
        category: 'signature',
        status: 'pending',
        priority: 'high',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'agreement_creation',
        state_abbreviation: stateAbbreviation,
        state_name: stateName,
        requires_upload: true,
      },
      {
        agreement_id: agreementId,
        provider_id: providerId,
        physician_id: physicianId,
        title: 'Schedule first supervision meeting',
        description: 'Set up the initial collaborative meeting based on state cadence requirements',
        category: 'supervision_meeting',
        status: 'pending',
        priority: 'medium',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'agreement_creation',
        state_abbreviation: stateAbbreviation,
        state_name: stateName,
      },
      {
        agreement_id: agreementId,
        provider_id: providerId,
        physician_id: physicianId,
        title: 'Schedule first supervision meeting',
        description: 'Set up the initial collaborative meeting based on state cadence requirements',
        category: 'supervision_meeting',
        status: 'pending',
        priority: 'medium',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'agreement_creation',
        state_abbreviation: stateAbbreviation,
        state_name: stateName,
      },
    ];

    try {
      const { data, error } = await supabase
        .from('agreement_tasks')
        .insert(baseTasks)
        .select();

      if (error) throw error;

      // Auto-link providers to each created task
      if (data && data.length > 0) {
        const links: { task_id: string; provider_id: string; role_label: string }[] = [];
        for (const task of data) {
          if (providerId) {
            links.push({ task_id: task.id, provider_id: providerId, role_label: 'NP' });
          }
          if (physicianId) {
            links.push({ task_id: task.id, provider_id: physicianId, role_label: 'Physician' });
          }
        }
        if (links.length > 0) {
          await supabase.from('task_linked_providers').insert(links);
        }
      }

      setTasks(prev => [...prev, ...(data || [])]);
      return data;
    } catch (error) {
      console.error('Error generating tasks:', error);
      throw error;
    }
  };

  // Generate termination tasks
  const generateTerminationTasks = async (
    agreementId: string,
    stateAbbreviation: string,
    stateName: string,
    providerId: string | null,
    physicianId: string | null
  ) => {
    const terminationTasks: AgreementTaskInsert[] = [
      {
        agreement_id: agreementId,
        provider_id: providerId,
        physician_id: physicianId,
        title: 'Upload executed termination agreement',
        description: 'Upload the signed termination agreement document',
        category: 'document',
        status: 'pending',
        priority: 'high',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'agreement_termination',
        state_abbreviation: stateAbbreviation,
        state_name: stateName,
        requires_upload: true,
      },
      {
        agreement_id: agreementId,
        provider_id: providerId,
        physician_id: physicianId,
        title: 'Document termination completion',
        description: 'Complete all termination documentation and update provider credentialing status',
        category: 'termination',
        status: 'pending',
        priority: 'high',
        assigned_role: 'admin',
        is_auto_generated: true,
        auto_trigger: 'agreement_termination',
        state_abbreviation: stateAbbreviation,
        state_name: stateName,
      },
    ];

    try {
      const { data, error } = await supabase
        .from('agreement_tasks')
        .insert(terminationTasks)
        .select();

      if (error) throw error;

      // Auto-link providers to termination tasks
      if (data && data.length > 0) {
        const links: { task_id: string; provider_id: string; role_label: string }[] = [];
        for (const task of data) {
          if (providerId) {
            links.push({ task_id: task.id, provider_id: providerId, role_label: 'NP' });
          }
          if (physicianId) {
            links.push({ task_id: task.id, provider_id: physicianId, role_label: 'Physician' });
          }
        }
        if (links.length > 0) {
          await supabase.from('task_linked_providers').insert(links);
        }
      }

      setTasks(prev => [...prev, ...(data || [])]);
      return data;
    } catch (error) {
      console.error('Error generating termination tasks:', error);
      throw error;
    }
  };

  return {
    tasks,
    loading,
    refetch: fetchTasks,
    createTask,
    updateTask,
    completeTask,
    generateAgreementTasks,
    generateTerminationTasks,
  };
};
