import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  recurrence_rule: string | null;
  parent_event_id: string | null;
  meeting_link: string | null;
  recording_link: string | null;
  newsletter_article_id: string | null;
  status: string;
  attestation_required: boolean;
  attestation_due_days: number;
  total_providers: number;
  completed_attestations: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventAttestation {
  id: string;
  event_id: string;
  provider_id: string;
  provider_name: string;
  provider_email: string | null;
  task_id: string | null;
  status: 'pending' | 'completed' | 'overdue' | 'excused';
  due_at: string;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completion_source: string;
  is_active_at_creation: boolean;
  pod_id: string | null;
  reminder_count: number;
  last_reminder_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  event_type: string;
  starts_at: string;
  ends_at: string;
  timezone?: string;
  recurrence_rule?: string;
  meeting_link?: string;
  recording_link?: string;
  newsletter_article_id?: string;
  attestation_required?: boolean;
  attestation_due_days?: number;
}

export function useCalendarEvents(options?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['calendar-events', options?.startDate, options?.endDate],
    queryFn: async () => {
      let query = supabase
        .from('calendar_events')
        .select('*')
        .order('starts_at', { ascending: true });

      if (options?.startDate) {
        query = query.gte('starts_at', options.startDate);
      }
      if (options?.endDate) {
        query = query.lte('starts_at', options.endDate);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as CalendarEvent[];
    },
  });
}

export function useCalendarEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ['calendar-event', eventId],
    queryFn: async () => {
      if (!eventId) return null;
      
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (error) throw error;
      return data as CalendarEvent;
    },
    enabled: !!eventId,
  });
}

export function useEventAttestations(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event-attestations', eventId],
    queryFn: async () => {
      if (!eventId) return [];
      
      const { data, error } = await supabase
        .from('event_attestations')
        .select('*')
        .eq('event_id', eventId)
        .order('provider_name');

      if (error) throw error;
      return data as EventAttestation[];
    },
    enabled: !!eventId,
  });
}

export function useMyEventAttestations() {
  return useQuery({
    queryKey: ['my-event-attestations'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return [];

      const { data, error } = await supabase
        .from('event_attestations')
        .select(`
          *,
          event:event_id (
            id, title, starts_at, ends_at, recording_link, newsletter_article_id, meeting_link
          )
        `)
        .eq('provider_id', profile.id)
        .neq('status', 'completed')
        .order('due_at', { ascending: true });

      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateEventInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('user_id', user?.id)
        .single();

      const { data, error } = await supabase
        .from('calendar_events')
        .insert({
          ...input,
          created_by: profile?.id,
          updated_by: profile?.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Log activity
      await supabase.from('event_activity_log').insert({
        event_id: data.id,
        activity_type: 'event_created',
        actor_id: profile?.id,
        actor_name: profile?.full_name || user?.email,
        actor_role: 'admin',
        description: `Created event: ${input.title}`,
        metadata: { event_type: input.event_type },
      });

      return data as CalendarEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({ title: 'Event created successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating event', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateCalendarEvent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CalendarEvent> & { id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('user_id', user?.id)
        .single();

      const { data, error } = await supabase
        .from('calendar_events')
        .update({
          ...updates,
          updated_by: profile?.id,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Log activity
      await supabase.from('event_activity_log').insert({
        event_id: id,
        activity_type: 'event_updated',
        actor_id: profile?.id,
        actor_name: profile?.full_name || user?.email,
        actor_role: 'admin',
        description: 'Updated event details',
        metadata: updates,
      });

      return data as CalendarEvent;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-event', data.id] });
      toast({ title: 'Event updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating event', description: error.message, variant: 'destructive' });
    },
  });
}

export function useGenerateAttestationTasks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (eventId: string) => {
      // Get event details
      const { data: event, error: eventError } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      // Validate required fields
      if (!event.recording_link) {
        throw new Error('Recording link is required before generating attestation tasks');
      }
      if (!event.newsletter_article_id) {
        throw new Error('Newsletter article is required before generating attestation tasks');
      }

      // Get active providers
      const { data: providers, error: providersError } = await supabase
        .from('profiles')
        .select('id, full_name, email, pod_id')
        .eq('onboarding_completed', true);

      if (providersError) throw providersError;

      // Filter to only those with provider role
      const { data: providerRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'provider');

      const providerUserIds = new Set(providerRoles?.map(r => r.user_id) || []);
      
      // Get profiles with user_ids to match
      const { data: profilesWithUsers } = await supabase
        .from('profiles')
        .select('id, user_id')
        .in('id', providers?.map(p => p.id) || []);

      const activeProviderIds = new Set(
        profilesWithUsers
          ?.filter(p => p.user_id && providerUserIds.has(p.user_id))
          .map(p => p.id) || []
      );

      const activeProviders = providers?.filter(p => activeProviderIds.has(p.id)) || [];

      const { data: { user } } = await supabase.auth.getUser();
      const { data: actorProfile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('user_id', user?.id)
        .single();

      // Calculate due date
      const eventEnd = new Date(event.ends_at);
      const dueAt = new Date(eventEnd);
      dueAt.setDate(dueAt.getDate() + (event.attestation_due_days || 7));

      let created = 0;
      let skipped = 0;

      for (const provider of activeProviders) {
        // Check if attestation already exists
        const { data: existing } = await supabase
          .from('event_attestations')
          .select('id')
          .eq('event_id', eventId)
          .eq('provider_id', provider.id)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        // Create task
        const { data: task, error: taskError } = await supabase
          .from('agreement_tasks')
          .insert({
            title: `Review Provider All-Hands + Attest`,
            description: `Please review the recording and newsletter from the Provider All-Hands on ${new Date(event.starts_at).toLocaleDateString()}, then attest completion.`,
            category: 'all_hands_attestation',
            status: 'pending',
            priority: 'medium',
            provider_id: provider.id,
            related_event_id: eventId,
            due_date: dueAt.toISOString().split('T')[0],
            is_required: true,
            links_json: {
              recording_link: event.recording_link,
              newsletter_article_id: event.newsletter_article_id,
              meeting_link: event.meeting_link,
            },
          })
          .select()
          .single();

        if (taskError) {
          console.error('Error creating task:', taskError);
          continue;
        }

        // Create attestation record
        const { error: attestError } = await supabase
          .from('event_attestations')
          .insert({
            event_id: eventId,
            provider_id: provider.id,
            provider_name: provider.full_name || 'Unknown',
            provider_email: provider.email,
            task_id: task?.id,
            status: 'pending',
            due_at: dueAt.toISOString(),
            is_active_at_creation: true,
            pod_id: provider.pod_id,
          });

        if (attestError) {
          console.error('Error creating attestation:', attestError);
        } else {
          created++;
        }
      }

      // Update event with counts
      await supabase
        .from('calendar_events')
        .update({
          status: 'completed',
          total_providers: activeProviders.length,
        })
        .eq('id', eventId);

      // Log activity
      await supabase.from('event_activity_log').insert({
        event_id: eventId,
        activity_type: 'tasks_generated',
        actor_id: actorProfile?.id,
        actor_name: actorProfile?.full_name || user?.email,
        actor_role: 'admin',
        description: `Generated ${created} attestation tasks (${skipped} skipped as duplicates)`,
        metadata: { created, skipped, total_providers: activeProviders.length },
      });

      return { created, skipped, total: activeProviders.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      queryClient.invalidateQueries({ queryKey: ['event-attestations'] });
      toast({ 
        title: 'Attestation tasks generated',
        description: `Created ${data.created} tasks for ${data.total} providers`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error generating tasks', description: error.message, variant: 'destructive' });
    },
  });
}

export function useCompleteAttestation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (attestationId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Get the attestation
      const { data: attestation, error: fetchError } = await supabase
        .from('event_attestations')
        .select('*, task_id')
        .eq('id', attestationId)
        .single();

      if (fetchError) throw fetchError;

      const now = new Date().toISOString();

      // Update attestation
      const { error: attestError } = await supabase
        .from('event_attestations')
        .update({
          status: 'completed',
          completed_at: now,
          completed_by_user_id: user?.id,
          completion_source: 'provider_task',
        })
        .eq('id', attestationId);

      if (attestError) throw attestError;

      // Update linked task if exists
      if (attestation.task_id) {
        await supabase
          .from('agreement_tasks')
          .update({
            status: 'completed',
            completed_at: now,
            completed_by: user?.id,
          })
          .eq('id', attestation.task_id);
      }

      // Log activity
      await supabase.from('event_activity_log').insert({
        event_id: attestation.event_id,
        activity_type: 'attestation_completed',
        actor_id: user?.id,
        actor_name: attestation.provider_name,
        actor_role: 'provider',
        description: `${attestation.provider_name} completed attestation`,
      });

      return attestation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-attestations'] });
      queryClient.invalidateQueries({ queryKey: ['my-event-attestations'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      toast({ title: 'Attestation completed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error completing attestation', description: error.message, variant: 'destructive' });
    },
  });
}

export function useGenerateFollowUpTasks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (eventId: string) => {
      // Get incomplete attestations
      const { data: incomplete, error } = await supabase
        .from('event_attestations')
        .select('*')
        .eq('event_id', eventId)
        .in('status', ['pending', 'overdue']);

      if (error) throw error;

      const { data: { user } } = await supabase.auth.getUser();
      const { data: actorProfile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('user_id', user?.id)
        .single();

      let created = 0;

      for (const attestation of incomplete || []) {
        // Create follow-up task
        const { error: taskError } = await supabase
          .from('agreement_tasks')
          .insert({
            title: 'Reminder: Complete All-Hands Attestation',
            description: `Please complete your attestation for the Provider All-Hands. This is a follow-up reminder.`,
            category: 'all_hands_attestation',
            status: 'pending',
            priority: 'high',
            provider_id: attestation.provider_id,
            related_event_id: eventId,
            due_date: new Date().toISOString().split('T')[0],
            is_required: true,
          });

        if (!taskError) {
          created++;
          
          // Update reminder count
          await supabase
            .from('event_attestations')
            .update({
              reminder_count: (attestation.reminder_count || 0) + 1,
              last_reminder_at: new Date().toISOString(),
            })
            .eq('id', attestation.id);
        }
      }

      // Log activity
      await supabase.from('event_activity_log').insert({
        event_id: eventId,
        activity_type: 'follow_up_created',
        actor_id: actorProfile?.id,
        actor_name: actorProfile?.full_name || user?.email,
        actor_role: 'admin',
        description: `Generated ${created} follow-up reminder tasks`,
        metadata: { created, incomplete_count: incomplete?.length || 0 },
      });

      return { created };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['event-attestations'] });
      toast({ 
        title: 'Follow-up tasks created',
        description: `Created ${data.created} reminder tasks`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating follow-ups', description: error.message, variant: 'destructive' });
    },
  });
}
