import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RefreshCw, Download, Info, ChevronDown, Target } from 'lucide-react';
import { cn, downloadCSV } from '@/lib/utils';

// ── Data hook ─────────────────────────────────────────────────────────────────

function useSlaAggregate() {
  return useQuery({
    queryKey: ['sla_attainment_aggregate'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sla_attainment_aggregate')
        .select('report_date, avg_sla_pct, imported_at')
        .order('report_date', { ascending: true })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as { report_date: string; avg_sla_pct: number; imported_at: string }[];
    },
    staleTime: 5 * 60_000,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slaColor(pct: number) {
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 60) return 'text-yellow-600';
  return 'text-destructive';
}

function slaBg(pct: number) {
  if (pct >= 80) return 'bg-emerald-50 border-emerald-200';
  if (pct >= 60) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}

function slaLabel(pct: number) {
  if (pct >= 80) return 'On Target';
  if (pct >= 60) return 'At Risk';
  return 'Below Target';
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SlaAggregatePage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data = [], isLoading, refetch, isRefetching } = useSlaAggregate();
  const [showGuide, setShowGuide] = useState(false);

  const latest = data[data.length - 1];
  const prev   = data[data.length - 2];

  const trend = useMemo(() => {
    if (data.length < 2) return null;
    const last7  = data.slice(-7);
    const avg    = last7.reduce((s, d) => s + Number(d.avg_sla_pct), 0) / last7.length;
    const prev7  = data.slice(-14, -7);
    const prevAvg = prev7.length
      ? prev7.reduce((s, d) => s + Number(d.avg_sla_pct), 0) / prev7.length
      : null;
    return { avg7: Math.round(avg * 10) / 10, prevAvg: prevAvg ? Math.round(prevAvg * 10) / 10 : null };
  }, [data]);

  const chartData = data.map((d) => ({
    date: d.report_date.slice(5),
    pct: Number(d.avg_sla_pct),
  }));

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />

      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8 space-y-6">

          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">SLA Attainment — Network Average</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Daily network-wide average SLA · updated automatically each morning
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
            </Button>
          </div>

          {/* Guide */}
          <Collapsible open={showGuide} onOpenChange={setShowGuide}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground -mt-2 mb-1 h-7 px-2 text-xs">
                <Info className="h-3.5 w-3.5" />
                How to read this page
                <ChevronDown className={cn('h-3 w-3 transition-transform', showGuide && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Alert className="mb-4 bg-muted/40 border-border">
                <AlertDescription className="text-sm space-y-2">
                  <p className="font-semibold text-foreground">
                    This page shows the network-wide average SLA attainment rate pulled daily from Metabase.
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                    <li><span className="font-medium text-foreground">≥ 80% (On Target)</span> — network meeting SLA commitments</li>
                    <li><span className="font-medium text-foreground">60–79% (At Risk)</span> — SLA at risk; investigate state-level breakdowns in Coverage Hub</li>
                    <li><span className="font-medium text-foreground">&lt; 60% (Below Target)</span> — immediate attention needed; check slot availability and provider coverage</li>
                  </ul>
                  <p className="text-muted-foreground">
                    For state-level SLA breakdown, see <a href="/admin/ops" className="underline text-primary">Coverage Hub</a>.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          {/* Hero KPI */}
          {latest && (
            <Card className={cn('border', slaBg(Number(latest.avg_sla_pct)))}>
              <CardContent className="p-6 flex items-center gap-6">
                <div className="rounded-xl p-4 bg-white shadow-sm">
                  <Target className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    Network SLA — {latest.report_date}
                  </p>
                  <p className={cn('text-5xl font-bold tabular-nums', slaColor(Number(latest.avg_sla_pct)))}>
                    {Number(latest.avg_sla_pct).toFixed(1)}%
                  </p>
                  <p className={cn('text-sm font-medium mt-1', slaColor(Number(latest.avg_sla_pct)))}>
                    {slaLabel(Number(latest.avg_sla_pct))}
                    {prev && (
                      <span className="ml-2 text-muted-foreground font-normal">
                        vs {Number(prev.avg_sla_pct).toFixed(1)}% prior day
                        {' '}
                        ({Number(latest.avg_sla_pct) >= Number(prev.avg_sla_pct) ? '▲' : '▼'}
                        {Math.abs(Number(latest.avg_sla_pct) - Number(prev.avg_sla_pct)).toFixed(1)} pp)
                      </span>
                    )}
                  </p>
                </div>
                {trend && (
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-muted-foreground">7-day avg</p>
                    <p className="text-2xl font-bold tabular-nums">{trend.avg7}%</p>
                    {trend.prevAvg && (
                      <p className="text-xs text-muted-foreground">
                        prev 7d: {trend.prevAvg}%
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Trend chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Daily Network SLA Trend
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    last {chartData.length} days
                  </span>
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => downloadCSV(
                    data.map((d) => ({ date: d.report_date, avg_sla_pct: d.avg_sla_pct })),
                    'sla-network-average.csv'
                  )}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                    <ReferenceLine y={80} stroke="#10b981" strokeDasharray="4 2"
                      label={{ value: '80% target', fontSize: 10, fill: '#10b981' }} />
                    <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="4 2"
                      label={{ value: '60% floor', fontSize: 10, fill: '#f59e0b' }} />
                    <Line type="monotone" dataKey="pct" stroke="#6366f1" strokeWidth={2} dot={false} name="Avg SLA" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Daily history table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : data.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No data yet. Data will appear after the next daily pull (7 AM ET).
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Avg SLA %</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Day-over-Day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data].reverse().map((d, i, arr) => {
                        const pct = Number(d.avg_sla_pct);
                        const prevPct = arr[i + 1] ? Number(arr[i + 1].avg_sla_pct) : null;
                        const delta = prevPct !== null ? pct - prevPct : null;
                        return (
                          <tr key={d.report_date} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-sm">{d.report_date}</td>
                            <td className={cn('px-4 py-2.5 text-right font-bold tabular-nums', slaColor(pct))}>
                              {pct.toFixed(1)}%
                            </td>
                            <td className={cn('px-4 py-2.5 text-sm font-medium', slaColor(pct))}>
                              {slaLabel(pct)}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-muted-foreground font-mono">
                              {delta !== null
                                ? <span className={delta >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pp
                                  </span>
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}
