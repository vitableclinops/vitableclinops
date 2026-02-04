import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, ComplianceStatus } from '@/types';

interface ComplianceStatusCardProps {
  status: ComplianceStatus;
  tasks?: Task[];
  className?: string;
}

export function ComplianceStatusCard({ status, tasks = [], className }: ComplianceStatusCardProps) {
  const completionPercentage = status.totalTasks > 0 
    ? Math.round((status.completedTasks / status.totalTasks) * 100) 
    : 100;

  const complianceTasks = tasks.filter(t => t.category === 'compliance');
  const overdueTasks = complianceTasks.filter(t => 
    t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'approved'
  );
  const upcomingTasks = complianceTasks.filter(t => 
    t.dueDate && 
    new Date(t.dueDate) >= new Date() && 
    t.status !== 'approved'
  ).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

  return (
    <Card className={cn(
      'transition-all',
      status.isCompliant && 'border-success/30',
      !status.isCompliant && status.overdueTasks > 0 && 'border-destructive/30',
      className
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Compliance Status
          </CardTitle>
          {status.isCompliant ? (
            <Badge className="bg-success text-success-foreground">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Compliant
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Non-Compliant
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Completion</span>
            <span className="font-medium">{status.completedTasks} / {status.totalTasks} tasks</span>
          </div>
          <Progress 
            value={completionPercentage} 
            className={cn(
              'h-2',
              status.isCompliant && '[&>div]:bg-success'
            )}
          />
        </div>
        
        {/* Overdue tasks */}
        {overdueTasks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-destructive font-medium">
              <AlertTriangle className="h-4 w-4" />
              {overdueTasks.length} Overdue
            </div>
            <div className="space-y-2">
              {overdueTasks.slice(0, 2).map(task => (
                <div 
                  key={task.id}
                  className="flex items-center justify-between p-2 rounded-md bg-destructive/5 border border-destructive/20"
                >
                  <span className="text-sm truncate flex-1">{task.title}</span>
                  {task.externalContentUrl && (
                    <ExternalLink className="h-4 w-4 text-muted-foreground ml-2" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Upcoming tasks */}
        {upcomingTasks.length > 0 && overdueTasks.length === 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Next Due: {status.nextDueDate && new Date(status.nextDueDate).toLocaleDateString()}
            </div>
            <div className="space-y-2">
              {upcomingTasks.slice(0, 2).map(task => (
                <div 
                  key={task.id}
                  className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                >
                  <span className="text-sm truncate flex-1">{task.title}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {task.dueDate && new Date(task.dueDate).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {status.isCompliant && overdueTasks.length === 0 && upcomingTasks.length === 0 && (
          <div className="text-center py-2">
            <CheckCircle2 className="h-8 w-8 mx-auto text-success mb-2" />
            <p className="text-sm text-muted-foreground">All compliance tasks complete</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
