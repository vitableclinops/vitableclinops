import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Tables } from '@/integrations/supabase/types';

export type Agreement = Tables<'collaborative_agreements'>;
export type ScheduledMeeting = Tables<'supervision_meetings'>;

export interface SupervisedProvider {
  id: string;
  provider_id: string | null;
  provider_name: string;
  provider_email: string;
  provider_npi: string | null;
  agreement_id: string;
  state_abbreviation: string;
  state_name: string;
  is_active: boolean | null;
  chart_review_url: string | null;
  start_date: string | null;
}

export interface PhysicianStats {
  totalAgreements: number;
  activeAgreements: number;
  pendingRenewals: number;
  totalProviders: number;
  activeProviders: number;
  upcomingMeetings: number;
  pendingTasks: number;
}

export const usePhysicianPortal = () => {
  const { profile } = useAuth();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [providers, setProviders] = useState<SupervisedProvider[]>([]);
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [tasks, setTasks] = useState<Tables<'agreement_tasks'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch agreements where this physician is assigned
      const { data: agreementsData, error: agreementsError } = await supabase
        .from('collaborative_agreements')
        .select('*')
        .or(`physician_id.eq.${profile.id},physician_email.eq.${profile.email}`)
        .order('state_name');

      if (agreementsError) throw agreementsError;
      setAgreements(agreementsData || []);

      const agreementIds = (agreementsData || []).map(a => a.id);

      if (agreementIds.length > 0) {
        // Fetch providers under these agreements
        const { data: providersData, error: providersError } = await supabase
          .from('agreement_providers')
          .select('*')
          .in('agreement_id', agreementIds);

        if (providersError) throw providersError;

        // Map providers with their state info from agreements
        const mappedProviders: SupervisedProvider[] = (providersData || []).map(p => {
          const agreement = agreementsData?.find(a => a.id === p.agreement_id);
          return {
            id: p.id,
            provider_id: p.provider_id,
            provider_name: p.provider_name,
            provider_email: p.provider_email,
            provider_npi: p.provider_npi,
            agreement_id: p.agreement_id,
            state_abbreviation: agreement?.state_abbreviation || '',
            state_name: agreement?.state_name || '',
            is_active: p.is_active,
            chart_review_url: p.chart_review_url,
            start_date: p.start_date,
          };
        });
        setProviders(mappedProviders);

        // Fetch meetings for these agreements
        const { data: meetingsData, error: meetingsError } = await supabase
          .from('supervision_meetings')
          .select('*')
          .in('agreement_id', agreementIds)
          .order('scheduled_date', { ascending: true });

        if (meetingsError) throw meetingsError;
        setMeetings(meetingsData || []);

        // Fetch tasks assigned to this physician
        const { data: tasksData, error: tasksError } = await supabase
          .from('agreement_tasks')
          .select('*')
          .or(`physician_id.eq.${profile.id},assigned_to.eq.${profile.id}`)
          .neq('status', 'completed')
          .order('due_date', { ascending: true });

        if (tasksError) throw tasksError;
        setTasks(tasksData || []);
      } else {
        setProviders([]);
        setMeetings([]);
        setTasks([]);
      }
    } catch (err) {
      console.error('Error fetching physician portal data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, profile?.email]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Compute stats
  const stats: PhysicianStats = {
    totalAgreements: agreements.length,
    activeAgreements: agreements.filter(a => a.workflow_status === 'active').length,
    pendingRenewals: agreements.filter(a => a.workflow_status === 'pending_renewal').length,
    totalProviders: providers.length,
    activeProviders: providers.filter(p => p.is_active !== false).length,
    upcomingMeetings: meetings.filter(m => 
      m.status !== 'cancelled' && 
      new Date(m.scheduled_date) >= new Date()
    ).length,
    pendingTasks: tasks.length,
  };

  // Get unique providers (deduplicated by provider_id or email)
  const uniqueProviders = providers.reduce((acc, p) => {
    const key = p.provider_id || p.provider_email;
    if (!acc.find(existing => (existing.provider_id || existing.provider_email) === key)) {
      acc.push(p);
    }
    return acc;
  }, [] as SupervisedProvider[]);

  // Get agreements for a specific provider
  const getAgreementsForProvider = (providerEmail: string) => {
    const providerAgreementIds = providers
      .filter(p => p.provider_email === providerEmail)
      .map(p => p.agreement_id);
    return agreements.filter(a => providerAgreementIds.includes(a.id));
  };

  // Get upcoming meetings
  const upcomingMeetings = meetings.filter(m => 
    m.status !== 'cancelled' && 
    new Date(m.scheduled_date) >= new Date()
  );

  // Get past meetings (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const pastMeetings = meetings.filter(m => {
    const meetingDate = new Date(m.scheduled_date);
    return meetingDate < new Date() && meetingDate >= thirtyDaysAgo;
  });

  return {
    agreements,
    providers,
    uniqueProviders,
    meetings,
    upcomingMeetings,
    pastMeetings,
    tasks,
    stats,
    loading,
    error,
    refetch: fetchData,
    getAgreementsForProvider,
  };
};
