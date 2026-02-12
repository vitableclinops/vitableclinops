import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Cake, 
  Trophy, 
  Calendar,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { useUpcomingMilestones } from '@/hooks/useMilestones';

interface UpcomingMilestonesWidgetProps {
  className?: string;
  compact?: boolean;
}

export function UpcomingMilestonesWidget({ className, compact = false }: UpcomingMilestonesWidgetProps) {
  const { data: milestones, isLoading } = useUpcomingMilestones(30);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cake className="h-5 w-5" />
            Milestones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const pending = milestones?.filter(m => m.status === 'pending') || [];
  const unassignedCount = pending.filter(m => !m.assigned_to).length;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cake className="h-5 w-5 text-pink-500" />
            Milestones
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {unassignedCount > 0 && (
              <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" />
                {unassignedCount} unassigned
              </Badge>
            )}
            {pending.length > 0 && (
              <Badge variant="secondary">{pending.length}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No upcoming milestones in the next 30 days</p>
          </div>
        ) : (
          <ScrollArea className={compact ? "h-[220px]" : "h-[340px]"}>
            <div className="space-y-2">
              {pending.map(task => {
                const daysUntil = differenceInDays(new Date(task.milestone_date), new Date());
                const isUrgent = daysUntil <= 1;
                const isBirthday = task.milestone_type === 'birthday';

                return (
                  <div
                    key={task.id}
                    className={cn(
                      "flex items-start justify-between gap-2 p-3 border rounded-lg",
                      isUrgent && "border-warning bg-warning/5",
                      !task.assigned_to && "border-dashed border-destructive/30"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "p-1.5 rounded-lg",
                        isBirthday 
                          ? "bg-pink-100 text-pink-600 dark:bg-pink-900 dark:text-pink-300"
                          : "bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-300"
                      )}>
                        {isBirthday ? <Cake className="h-3.5 w-3.5" /> : <Trophy className="h-3.5 w-3.5" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{task.provider_name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          {isBirthday ? 'Birthday' : 'Anniversary'}
                          {' · '}
                          <Calendar className="h-3 w-3" />
                          {format(new Date(task.milestone_date), 'MMM d')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!task.assigned_to && (
                        <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                          Unassigned
                        </Badge>
                      )}
                      <Badge variant={isUrgent ? "destructive" : "secondary"} className="text-[10px]">
                        {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
