import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

interface DayData {
  day: string;
  completed: number;
}

export function TaskCompletionTrend() {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTrend() {
      const today = new Date();
      const sevenDaysAgo = subDays(today, 6);

      const { data: tasks } = await supabase
        .from('agreement_tasks')
        .select('completed_at')
        .not('completed_at', 'is', null)
        .gte('completed_at', startOfDay(sevenDaysAgo).toISOString())
        .lte('completed_at', endOfDay(today).toISOString());

      // Build day buckets
      const buckets: DayData[] = [];
      for (let i = 0; i < 7; i++) {
        const d = subDays(today, 6 - i);
        buckets.push({ day: format(d, 'EEE'), completed: 0 });
      }

      (tasks || []).forEach(t => {
        if (!t.completed_at) return;
        const dayLabel = format(new Date(t.completed_at), 'EEE');
        const bucket = buckets.find(b => b.day === dayLabel);
        if (bucket) bucket.completed++;
      });

      setData(buckets);
      setLoading(false);
    }

    fetchTrend();
  }, []);

  const totalCompleted = data.reduce((sum, d) => sum + d.completed, 0);

  if (loading) {
    return <Skeleton className="h-40 rounded-lg" />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-success" />
          Weekly Completions
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {totalCompleted} task{totalCompleted !== 1 ? 's' : ''} completed this week
        </p>
      </CardHeader>
      <CardContent className="pb-3">
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'hsl(var(--popover-foreground))',
              }}
              formatter={(value: number) => [`${value} completed`, 'Tasks']}
            />
            <Area
              type="monotone"
              dataKey="completed"
              stroke="hsl(var(--success))"
              strokeWidth={2}
              fill="url(#completionGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
