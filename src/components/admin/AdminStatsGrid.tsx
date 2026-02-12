import { StatCard } from '@/components/StatCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, FileText, ArrowRightLeft, ListChecks, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DashboardStats } from '@/hooks/useAdminDashboard';

interface AdminStatsGridProps {
  stats: DashboardStats;
  loading: boolean;
  totalTasks: number;
  unassignedCount: number;
  blockedCount: number;
  escalatedCount: number;
  completedCount: number;
}

export function AdminStatsGrid({ stats, loading, totalTasks, unassignedCount, blockedCount, escalatedCount, completedCount }: AdminStatsGridProps) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-8">
      <StatCard
        title="Internal Providers"
        value={stats.totalInternalProviders}
        subtitle={`${stats.w2Count} W2 · ${stats.contractorCount} 1099`}
        icon={Users}
        variant="default"
      />
      <StatCard
        title="Active Agreements"
        value={stats.activeAgreements}
        subtitle={`${stats.draftAgreements} draft · ${stats.pendingSetupAgreements} pending`}
        icon={FileText}
        variant="default"
      />
      <StatCard
        title="Active Transfers"
        value={stats.activeTransfers}
        subtitle="In progress"
        icon={ArrowRightLeft}
        variant={stats.activeTransfers > 0 ? 'warning' : 'default'}
      />
      <StatCard
        title="Open Tasks"
        value={totalTasks}
        subtitle={`${unassignedCount} unassigned`}
        icon={ListChecks}
        variant={unassignedCount > 0 ? 'warning' : 'default'}
      />
      <StatCard
        title="Blocked"
        value={blockedCount}
        subtitle={`${escalatedCount} escalated`}
        icon={AlertTriangle}
        variant={blockedCount > 0 ? 'danger' : 'default'}
      />
      <StatCard
        title="Completed"
        value={completedCount}
        subtitle="Total tasks done"
        icon={CheckCircle2}
        variant="success"
      />
    </div>
  );
}
