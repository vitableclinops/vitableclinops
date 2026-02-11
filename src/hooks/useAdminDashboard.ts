import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Task = Tables<'agreement_tasks'>;

export interface DashboardStats {
  totalInternalProviders: number;
  w2Count: number;
  contractorCount: number;
  agencyCount: number;
  activeAgreements: number;
  draftAgreements: number;
  pendingSetupAgreements: number;
  activeTransfers: number;
  upcomingRenewals: number;
}

export interface DashboardTaskItem {
  id: string;
  title: string;
  status: string;
  category: string;
  state_name: string | null;
  state_abbreviation: string | null;
  assigned_to_name: string | null;
  assigned_to: string | null;
  priority: string | null;
  due_date: string | null;
  provider_id: string | null;
  transfer_id: string | null;
  escalated: boolean | null;
  blocked_reason: string | null;
  description: string | null;
  provider_name?: string;
}

export function useAdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalInternalProviders: 0,
    w2Count: 0,
    contractorCount: 0,
    agencyCount: 0,
    activeAgreements: 0,
    draftAgreements: 0,
    pendingSetupAgreements: 0,
    activeTransfers: 0,
    upcomingRenewals: 0,
  });
  const [actionableTasks, setActionableTasks] = useState<DashboardTaskItem[]>([]);
  const [taskStatusCounts, setTaskStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      // Parallel fetches
      const [
        providerRes,
        agreementRes,
        transferRes,
        taskRes,
        taskCountRes,
        renewalRes,
      ] = await Promise.all([
        // Provider counts by employment type
        supabase
          .from('profiles')
          .select('employment_type')
          .not('employment_type', 'is', null),
        // Agreement counts by workflow status
        supabase
          .from('collaborative_agreements')
          .select('workflow_status'),
        // Active transfers
        supabase
          .from('agreement_transfers')
          .select('id')
          .in('status', ['pending', 'in_progress']),
        // Actionable tasks (not completed)
        supabase
          .from('agreement_tasks')
          .select('id, title, status, category, state_name, state_abbreviation, assigned_to_name, assigned_to, priority, due_date, provider_id, transfer_id, escalated, blocked_reason, description')
          .in('status', ['pending', 'in_progress', 'blocked', 'waiting_on_signature'])
          .order('created_at', { ascending: false })
          .limit(50),
        // Task status counts (all)
        supabase
          .from('agreement_tasks')
          .select('status'),
        // Upcoming renewals (next 90 days)
        supabase
          .from('collaborative_agreements')
          .select('id')
          .eq('workflow_status', 'active')
          .not('next_renewal_date', 'is', null)
          .lt('next_renewal_date', new Date(Date.now() + 90 * 86400000).toISOString()),
      ]);

      // Provider stats
      const providers = providerRes.data || [];
      const w2 = providers.filter(p => p.employment_type === 'w2').length;
      const c1099 = providers.filter(p => p.employment_type === '1099').length;
      const agency = providers.filter(p => p.employment_type === 'agency').length;

      // Agreement stats
      const agreements = agreementRes.data || [];
      const activeAg = agreements.filter(a => a.workflow_status === 'active').length;
      const draftAg = agreements.filter(a => a.workflow_status === 'draft').length;
      const pendingAg = agreements.filter(a => a.workflow_status === 'pending_setup' || a.workflow_status === 'pending_verification').length;

      // Task status counts
      const statusCounts: Record<string, number> = {};
      (taskCountRes.data || []).forEach(t => {
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      });

      setStats({
        totalInternalProviders: w2 + c1099,
        w2Count: w2,
        contractorCount: c1099,
        agencyCount: agency,
        activeAgreements: activeAg,
        draftAgreements: draftAg,
        pendingSetupAgreements: pendingAg,
        activeTransfers: (transferRes.data || []).length,
        upcomingRenewals: (renewalRes.data || []).length,
      });

      // Enrich tasks with provider names where possible
      const tasks = (taskRes.data || []) as DashboardTaskItem[];
      const providerIds = [...new Set(tasks.map(t => t.provider_id).filter(Boolean))] as string[];
      
      if (providerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', providerIds);
        
        const nameMap = new Map((profiles || []).map(p => [p.id, p.full_name]));
        tasks.forEach(t => {
          if (t.provider_id) {
            t.provider_name = nameMap.get(t.provider_id) || undefined;
          }
        });
      }

      // Sort: escalated first, then blocked, then overdue, then by priority
      tasks.sort((a, b) => {
        if (a.escalated && !b.escalated) return -1;
        if (!a.escalated && b.escalated) return 1;
        if ((a.status === 'blocked') !== (b.status === 'blocked')) return a.status === 'blocked' ? -1 : 1;
        const prioOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return (prioOrder[a.priority || 'medium'] || 2) - (prioOrder[b.priority || 'medium'] || 2);
      });

      setActionableTasks(tasks);
      setTaskStatusCounts(statusCounts);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return { stats, actionableTasks, taskStatusCounts, loading, refetch: fetchDashboard };
}
