import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Cake, 
  Trophy, 
  Calendar, 
  CheckCircle2, 
  Copy,
  MessageSquare,
  Loader2
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { useMyMilestoneTasks, useCompleteMilestoneTask, type MilestoneTask } from '@/hooks/useMilestones';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface UpcomingMilestonesWidgetProps {
  className?: string;
  compact?: boolean;
}

export function UpcomingMilestonesWidget({ className, compact = false }: UpcomingMilestonesWidgetProps) {
  const { data: tasks, isLoading } = useMyMilestoneTasks();
  const completeMutation = useCompleteMilestoneTask();
  const { toast } = useToast();

  const handleCopyTemplate = (template: string) => {
    navigator.clipboard.writeText(template);
    toast({ title: 'Template copied to clipboard' });
  };

  const handleComplete = (taskId: string) => {
    completeMutation.mutate({ taskId });
  };

  const getDaysUntil = (date: string) => {
    return differenceInDays(new Date(date), new Date());
  };

  const MilestoneItem = ({ task }: { task: MilestoneTask }) => {
    const daysUntil = getDaysUntil(task.milestone_date);
    const isUrgent = daysUntil <= 1;
    const isBirthday = task.milestone_type === 'birthday';

    return (
      <div className={cn(
        "p-3 border rounded-lg space-y-2",
        isUrgent && "border-warning bg-warning/5"
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={cn(
              "p-2 rounded-lg",
              isBirthday 
                ? "bg-pink-100 text-pink-600 dark:bg-pink-900 dark:text-pink-300"
                : "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300"
            )}>
              {isBirthday ? <Cake className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
            </div>
            <div>
              <p className="font-medium text-sm">{task.provider_name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {task.milestone_type}
              </p>
            </div>
          </div>
          <Badge variant={isUrgent ? "destructive" : "secondary"} className="shrink-0">
            {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days`}
          </Badge>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {format(new Date(task.milestone_date), 'MMMM d, yyyy')}
        </div>

        {!compact && (
          <div className="flex items-center gap-2 pt-1">
            {task.slack_template && (
              <Button 
                size="sm" 
                variant="outline" 
                className="h-7 text-xs"
                onClick={() => handleCopyTemplate(task.slack_template!)}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy Template
              </Button>
            )}
            <Button 
              size="sm" 
              variant="default" 
              className="h-7 text-xs"
              onClick={() => handleComplete(task.id)}
              disabled={completeMutation.isPending}
            >
              {completeMutation.isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              )}
              Mark Done
            </Button>
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cake className="h-5 w-5" />
            Upcoming Milestones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const upcomingTasks = tasks?.slice(0, compact ? 3 : 5) || [];

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cake className="h-5 w-5 text-pink-500" />
            Upcoming Milestones
          </CardTitle>
          {tasks && tasks.length > 0 && (
            <Badge variant="secondary">{tasks.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {upcomingTasks.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No upcoming milestones</p>
          </div>
        ) : (
          <ScrollArea className={compact ? "h-[200px]" : "h-[300px]"}>
            <div className="space-y-3">
              {upcomingTasks.map(task => (
                <MilestoneItem key={task.id} task={task} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
