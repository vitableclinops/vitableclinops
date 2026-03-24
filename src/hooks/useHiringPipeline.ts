import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type HiringStage = 'request_to_ds' | 'candidates_provided' | 'interview' | 'hiring_decision' | 'onboarding' | 'started';

export interface HiringCandidate {
  id: string;
  candidate_name: string;
  role: string | null;
  covered_states: string[] | null;
  stage: HiringStage;
  status: string;
  source: string;
  source_context: any[];
  ds_request_date: string | null;
  candidates_provided_date: string | null;
  interview_date: string | null;
  interview_completed: boolean;
  hiring_decision: string | null;
  hiring_decision_date: string | null;
  onboarding_start_date: string | null;
  first_shift_date: string | null;
  notes: string | null;
  slack_thread_url: string | null;
  notion_page_id: string | null;
  created_at: string;
  updated_at: string;
}

export const STAGE_CONFIG: Record<HiringStage, { label: string; color: string; order: number }> = {
  request_to_ds: { label: 'Request to DS', color: 'bg-blue-100 text-blue-800 border-blue-200', order: 0 },
  candidates_provided: { label: 'Candidates Provided', color: 'bg-purple-100 text-purple-800 border-purple-200', order: 1 },
  interview: { label: 'Interview', color: 'bg-amber-100 text-amber-800 border-amber-200', order: 2 },
  hiring_decision: { label: 'Hiring Decision', color: 'bg-orange-100 text-orange-800 border-orange-200', order: 3 },
  onboarding: { label: 'Onboarding', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', order: 4 },
  started: { label: 'Started', color: 'bg-green-100 text-green-800 border-green-200', order: 5 },
};

export function useHiringPipeline() {
  const [candidates, setCandidates] = useState<HiringCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('hiring_candidates')
      .select('*')
      .eq('status', 'active')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching candidates:', error);
      toast.error('Failed to load hiring pipeline');
    } else {
      setCandidates((data || []) as unknown as HiringCandidate[]);
    }
    setLoading(false);
  }, []);

  const syncFromSlack = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-hiring-pipeline', {
        body: { daysBack: 60 },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`Synced ${data.candidates?.length || 0} candidates from ${data.messagesProcessed || 0} messages`);
        setLastSyncAt(new Date().toISOString());
        await fetchCandidates();
      } else {
        toast.error(data?.error || 'Sync failed');
      }
    } catch (e: any) {
      console.error('Sync error:', e);
      toast.error('Failed to sync from Slack: ' + (e.message || 'Unknown error'));
    } finally {
      setSyncing(false);
    }
  }, [fetchCandidates]);

  const updateCandidate = useCallback(async (id: string, updates: Partial<HiringCandidate>) => {
    const { error } = await supabase
      .from('hiring_candidates')
      .update(updates as any)
      .eq('id', id);

    if (error) {
      toast.error('Failed to update candidate');
      return false;
    }
    await fetchCandidates();
    return true;
  }, [fetchCandidates]);

  const archiveCandidate = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('hiring_candidates')
      .update({ status: 'archived' } as any)
      .eq('id', id);

    if (error) {
      toast.error('Failed to archive candidate');
      return false;
    }
    toast.success('Candidate archived');
    await fetchCandidates();
    return true;
  }, [fetchCandidates]);

  const addCandidate = useCallback(async (candidate: Partial<HiringCandidate>) => {
    const { error } = await supabase
      .from('hiring_candidates')
      .insert({
        candidate_name: candidate.candidate_name || 'New Candidate',
        role: candidate.role || null,
        covered_states: candidate.covered_states || [],
        stage: candidate.stage || 'request_to_ds',
        status: 'active',
        source: 'manual',
        notes: candidate.notes || null,
      } as any);

    if (error) {
      toast.error('Failed to add candidate');
      return false;
    }
    toast.success('Candidate added');
    await fetchCandidates();
    return true;
  }, [fetchCandidates]);

  // Auto-fetch on mount
  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  // Auto-sync on mount
  useEffect(() => {
    syncFromSlack();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stageCounts = candidates.reduce((acc, c) => {
    acc[c.stage] = (acc[c.stage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    candidates,
    loading,
    syncing,
    lastSyncAt,
    stageCounts,
    fetchCandidates,
    syncFromSlack,
    updateCandidate,
    archiveCandidate,
    addCandidate,
  };
}
