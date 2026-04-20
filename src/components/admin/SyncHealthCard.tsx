import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type SyncRun = {
  id: string;
  function_name: string;
  status: 'running' | 'success' | 'partial' | 'error';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  rows_processed: number | null;
  rows_failed: number | null;
  error_message: string | null;
  last_alerted_at: string | null;
};

const STATUS_BADGE: Record<SyncRun['status'], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  success: { label: 'success', cls: 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400', Icon: CheckCircle2 },
  partial: { label: 'partial',  cls: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30 dark:text-yellow-400', Icon: AlertTriangle },
  error:   { label: 'error',    cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400', Icon: XCircle },
  running: { label: 'running',  cls: 'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400', Icon: Clock },
};

/**
 * Unified sync-health card for System Settings.
 * Surfaces the last 20 runs across every nightly job tracked in `sync_runs`.
 */
export function SyncHealthCard() {
  const { data: runs = [], isLoading } = useQuery<SyncRun[]>({
    queryKey: ['sync_runs', 'recent'],
    queryFn: async () => {
      // Generic table not yet in generated types — cast through any
      const { data, error } = await (supabase as any)
        .from('sync_runs')
        .select('id, function_name, status, started_at, finished_at, duration_ms, rows_processed, rows_failed, error_message, last_alerted_at')
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as SyncRun[];
    },
    refetchInterval: 60_000,
  });

  // Latest status per function for the summary strip
  const latestPerFn = new Map<string, SyncRun>();
  for (const r of runs) {
    if (!latestPerFn.has(r.function_name)) latestPerFn.set(r.function_name, r);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Nightly Sync Health
        </CardTitle>
        <CardDescription>
          Status of background data jobs that feed the Ops, Utilization, and Compliance views.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Latest-status strip */}
        {latestPerFn.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {Array.from(latestPerFn.values()).map((r) => {
              const meta = STATUS_BADGE[r.status];
              return (
                <Badge key={r.function_name} variant="outline" className={cn('gap-1.5', meta.cls)}>
                  <meta.Icon className="h-3 w-3" />
                  <span className="font-mono text-[11px]">{r.function_name}</span>
                </Badge>
              );
            })}
          </div>
        )}

        {/* Recent runs table */}
        <ScrollArea className="h-[320px] rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Function</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium text-right">Duration</th>
                <th className="px-3 py-2 font-medium text-right">Rows</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && runs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No sync runs recorded yet — first nightly cycle will populate this.
                </td></tr>
              )}
              {runs.map((r) => {
                const meta = STATUS_BADGE[r.status];
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.function_name}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={cn('gap-1', meta.cls)}>
                        <meta.Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {r.rows_processed?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px] truncate" title={r.error_message ?? undefined}>
                      {r.error_message ?? (r.last_alerted_at ? '✓ alerted' : '')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
