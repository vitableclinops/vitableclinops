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
  const [archivedTasks, setArchivedTasks] = useState<DashboardTaskItem[]>([]);
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
        milestoneProfilesRes,
        archivedRes,
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
        // Providers with milestone dates for task creation
        supabase
          .from('profiles')
          .select('id, full_name, date_of_birth, birthday, start_date_on_network, employment_start_date, employment_type, pod_id')
          .in('employment_type', ['w2', '1099'])
          .neq('activation_status', 'Terminated')
          .neq('employment_status', 'termed'),
        // Archived tasks
        supabase
          .from('agreement_tasks')
          .select('id, title, status, category, state_name, state_abbreviation, assigned_to_name, assigned_to, priority, due_date, provider_id, transfer_id, escalated, blocked_reason, description, archived_reason, archived_at')
          .eq('status', 'archived' as any)
          .order('archived_at', { ascending: false })
          .limit(50),
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

      // Generate milestone tasks from provider profiles
      const milestoneProfiles = milestoneProfilesRes.data || [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Fetch pod leads for assignment
      const podIds = [...new Set(milestoneProfiles.map(p => p.pod_id).filter(Boolean))] as string[];
      let podLeadMap = new Map<string, { id: string | null; name: string | null }>();
      if (podIds.length > 0) {
        const { data: pods } = await supabase
          .from('pods')
          .select('id, pod_lead_id, pod_lead_name')
          .in('id', podIds);
        (pods || []).forEach(pod => {
          podLeadMap.set(pod.id, { id: pod.pod_lead_id, name: pod.pod_lead_name });
        });
      }

      // Check which milestone tasks already exist
      const currentYear = today.getFullYear();
      const { data: existingMilestones } = await supabase
        .from('milestone_tasks')
        .select('provider_id, milestone_type, milestone_year')
        .eq('milestone_year', currentYear)
        .in('status', ['pending', 'completed']);

      const existingSet = new Set(
        (existingMilestones || []).map(m => `${m.provider_id}-${m.milestone_type}-${m.milestone_year}`)
      );

      const milestonesToCreate: any[] = [];

      for (const p of milestoneProfiles) {
        const name = p.full_name || 'Unknown Provider';
        const dob = p.date_of_birth || p.birthday;
        const startDate = p.start_date_on_network || p.employment_start_date;
        const podLead = p.pod_id ? podLeadMap.get(p.pod_id) : null;

        if (dob) {
          const bday = new Date(dob);
          let nextBday = new Date(bday);
          nextBday.setFullYear(today.getFullYear());
          if (nextBday < today) nextBday.setFullYear(today.getFullYear() + 1);
          
          const daysUntil = Math.floor((nextBday.getTime() - today.getTime()) / 86400000);
          const taskYear = nextBday.getFullYear();
          const key = `${p.id}-birthday-${taskYear}`;

          if (daysUntil <= 14 && !existingSet.has(key)) {
            milestonesToCreate.push({
              provider_id: p.id,
              provider_name: name,
              milestone_type: 'birthday',
              milestone_date: nextBday.toISOString().split('T')[0],
              milestone_year: taskYear,
              title: `Wish ${name} a Happy Birthday`,
              due_date: nextBday.toISOString().split('T')[0],
              assigned_to: podLead?.id || null,
              assigned_to_name: podLead?.name || null,
              pod_id: p.pod_id || null,
              status: 'pending',
              slack_template: `🎂 Happy Birthday, ${name}! Wishing you a wonderful day! 🎉`,
            });
            existingSet.add(key);
          }
        }

        if (startDate) {
          const start = new Date(startDate);
          let nextAnniv = new Date(start);
          nextAnniv.setFullYear(today.getFullYear());
          if (nextAnniv < today) nextAnniv.setFullYear(today.getFullYear() + 1);
          
          const yearsCount = nextAnniv.getFullYear() - start.getFullYear();
          const daysUntil = Math.floor((nextAnniv.getTime() - today.getTime()) / 86400000);
          const taskYear = nextAnniv.getFullYear();
          const key = `${p.id}-anniversary-${taskYear}`;

          if (daysUntil <= 14 && yearsCount > 0 && !existingSet.has(key)) {
            milestonesToCreate.push({
              provider_id: p.id,
              provider_name: name,
              milestone_type: 'anniversary',
              milestone_date: nextAnniv.toISOString().split('T')[0],
              milestone_year: taskYear,
              title: `Wish ${name} a Happy ${yearsCount}-Year Anniversary`,
              due_date: nextAnniv.toISOString().split('T')[0],
              assigned_to: podLead?.id || null,
              assigned_to_name: podLead?.name || null,
              pod_id: p.pod_id || null,
              status: 'pending',
              slack_template: `🏆 Congratulations ${name} on ${yearsCount} year${yearsCount > 1 ? 's' : ''} with us! Thank you for your dedication! 🎉`,
            });
            existingSet.add(key);
          }
        }
      }

      // Batch insert new milestone tasks
      if (milestonesToCreate.length > 0) {
        await supabase.from('milestone_tasks').insert(milestonesToCreate);
      }

      // Now fetch pending milestone tasks and merge into actionable tasks
      const { data: pendingMilestones } = await supabase
        .from('milestone_tasks')
        .select('*')
        .eq('status', 'pending')
        .order('due_date', { ascending: true })
        .limit(20);

      const milestoneTasks: DashboardTaskItem[] = (pendingMilestones || []).map(m => ({
        id: m.id,
        title: m.title,
        status: 'pending',
        category: 'milestone' as any,
        state_name: null,
        state_abbreviation: null,
        assigned_to_name: m.assigned_to_name,
        assigned_to: m.assigned_to,
        priority: 'medium',
        due_date: m.due_date,
        provider_id: m.provider_id,
        transfer_id: null,
        escalated: false,
        blocked_reason: null,
        description: m.description,
        provider_name: m.provider_name,
      }));

      const allTasks = [...tasks, ...milestoneTasks];

      // Sort: escalated first, then blocked, then overdue, then by priority
      allTasks.sort((a, b) => {
        if (a.escalated && !b.escalated) return -1;
        if (!a.escalated && b.escalated) return 1;
        if ((a.status === 'blocked') !== (b.status === 'blocked')) return a.status === 'blocked' ? -1 : 1;
        const prioOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return (prioOrder[a.priority || 'medium'] || 2) - (prioOrder[b.priority || 'medium'] || 2);
      });

      setActionableTasks(allTasks);
      setArchivedTasks((archivedRes.data || []) as DashboardTaskItem[]);
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

  return { stats, actionableTasks, archivedTasks, taskStatusCounts, loading, refetch: fetchDashboard };
}
