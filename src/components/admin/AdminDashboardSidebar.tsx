import { ActiveTransfersWidget } from '@/components/agreements/ActiveTransfersWidget';
import { UpcomingMilestonesWidget } from '@/components/milestones/UpcomingMilestonesWidget';
import { TaskCompletionTrend } from '@/components/admin/TaskCompletionTrend';
import { StaleTaskAlerts } from '@/components/admin/StaleTaskAlerts';
import { useGenerateMilestoneTasks } from '@/hooks/useMilestones';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Cake, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardTaskItem } from '@/hooks/useAdminDashboard';

interface AdminDashboardSidebarProps {
  taskStatusCounts: Record<string, number>;
  tasks?: DashboardTaskItem[];
}

export function AdminDashboardSidebar({ taskStatusCounts, tasks = [] }: AdminDashboardSidebarProps) {
  const generateMilestones = useGenerateMilestoneTasks();

  return (
    <div className="space-y-6">
      <TaskCompletionTrend />
      <StaleTaskAlerts tasks={tasks} />
      <ActiveTransfersWidget />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Task Status Distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.entries(taskStatusCounts).map(([status, count]) => (
            <div key={status} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  status === 'completed' && "bg-success",
                  status === 'pending' && "bg-muted-foreground",
                  status === 'in_progress' && "bg-primary",
                  status === 'blocked' && "bg-warning",
                  status === 'waiting_on_signature' && "bg-warning",
                )} />
                <span className="text-sm capitalize">{status.replace(/_/g, ' ')}</span>
              </div>
              <span className="text-sm font-medium">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <UpcomingMilestonesWidget />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cake className="h-4 w-4 text-pink-500" />
            Milestone Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Scan all providers and generate upcoming birthday & anniversary tasks for pod leads.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => generateMilestones.mutate()}
            disabled={generateMilestones.isPending}
          >
            {generateMilestones.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Generate Milestone Tasks
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
