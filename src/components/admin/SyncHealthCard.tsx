import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusChip, toneForStatus } from '@/components/StatusChip';

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

const STATUS_ICON: Record<SyncRun['status'], typeof CheckCircle2> = {
  success: CheckCircle2,
  partial: AlertTriangle,
  error: XCircle,
  running: Clock,
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
              const Icon = STATUS_ICON[r.status];
              return (
                <StatusChip
                  key={r.function_name}
                  tone={toneForStatus(r.status)}
                  icon={<Icon className="h-3 w-3" />}
                  label={<span className="font-mono text-[11px]">{r.function_name}</span>}
                />
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
                const Icon = STATUS_ICON[r.status];
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.function_name}</td>
                    <td className="px-3 py-2">
                      <StatusChip
                        tone={toneForStatus(r.status)}
                        icon={<Icon className="h-3 w-3" />}
                        label={r.status}
                      />
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
