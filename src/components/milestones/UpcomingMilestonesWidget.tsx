import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Cake, 
  Trophy, 
  Calendar, 
  MessageSquare,
} from 'lucide-react';
import { format, differenceInDays, setYear, addYears } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface UpcomingMilestone {
  id: string;
  full_name: string;
  type: 'birthday' | 'anniversary';
  date: Date;
  originalDate: string;
  yearsCount?: number;
}

interface UpcomingMilestonesWidgetProps {
  className?: string;
  compact?: boolean;
}

export function UpcomingMilestonesWidget({ className, compact = false }: UpcomingMilestonesWidgetProps) {
  const { data: milestones, isLoading } = useQuery({
    queryKey: ['provider-milestones-upcoming'],
    queryFn: async () => {
      // Fetch internal providers with birthday or start date
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, date_of_birth, birthday, start_date_on_network, employment_start_date, employment_type, activation_status, employment_status')
        .in('employment_type', ['w2', '1099'])
        .neq('activation_status', 'Terminated')
        .neq('employment_status', 'termed');

      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const results: UpcomingMilestone[] = [];

      for (const p of data || []) {
        const name = p.full_name || 'Unknown Provider';
        const dob = p.date_of_birth || p.birthday;
        const startDate = p.start_date_on_network || p.employment_start_date;

        if (dob) {
          const bday = new Date(dob);
          // Get this year's occurrence
          let nextBday = setYear(bday, today.getFullYear());
          if (nextBday < today) {
            nextBday = addYears(nextBday, 1);
          }
          const daysUntil = differenceInDays(nextBday, today);
          if (daysUntil <= 30) {
            results.push({
              id: p.id + '-birthday',
              full_name: name,
              type: 'birthday',
              date: nextBday,
              originalDate: dob,
            });
          }
        }

        if (startDate) {
          const start = new Date(startDate);
          let nextAnniv = setYear(start, today.getFullYear());
          if (nextAnniv < today) {
            nextAnniv = addYears(nextAnniv, 1);
          }
          const daysUntil = differenceInDays(nextAnniv, today);
          const yearsCount = nextAnniv.getFullYear() - start.getFullYear();
          if (daysUntil <= 30 && yearsCount > 0) {
            results.push({
              id: p.id + '-anniversary',
              full_name: name,
              type: 'anniversary',
              date: nextAnniv,
              originalDate: startDate,
              yearsCount,
            });
          }
        }
      }

      results.sort((a, b) => a.date.getTime() - b.date.getTime());
      return results;
    },
  });

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
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const items = milestones?.slice(0, compact ? 3 : 8) || [];

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Cake className="h-5 w-5 text-pink-500" />
            Upcoming Milestones
          </CardTitle>
          {milestones && milestones.length > 0 && (
            <Badge variant="secondary">{milestones.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No upcoming milestones in the next 30 days</p>
          </div>
        ) : (
          <ScrollArea className={compact ? "h-[200px]" : "h-[300px]"}>
            <div className="space-y-2">
              {items.map(item => {
                const daysUntil = differenceInDays(item.date, new Date());
                const isUrgent = daysUntil <= 1;
                const isBirthday = item.type === 'birthday';

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "p-3 border rounded-lg space-y-1",
                      isUrgent && "border-warning bg-warning/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
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
                          <p className="font-medium text-sm">{item.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {isBirthday ? 'Birthday' : `${item.yearsCount}-year Anniversary`}
                          </p>
                        </div>
                      </div>
                      <Badge variant={isUrgent ? "destructive" : "secondary"} className="shrink-0 text-[10px]">
                        {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground pl-8">
                      <Calendar className="h-3 w-3" />
                      {format(item.date, 'MMM d')}
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
