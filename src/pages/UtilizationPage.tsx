import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RefreshCw, Download } from 'lucide-react';
import { cn, downloadCSV } from '@/lib/utils';

// ── Tiers ─────────────────────────────────────────────────────────────────────

type Tier = 'high' | 'mid' | 'low';

function getTier(pct: number): Tier {
  if (pct >= 80) return 'high';
  if (pct >= 50) return 'mid';
  return 'low';
}

function TierBadge({ tier }: { tier: Tier }) {
  switch (tier) {
    case 'high': return <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">High</Badge>;
    case 'mid':  return <Badge className="bg-yellow-500 text-white hover:bg-yellow-500">Mid</Badge>;
    case 'low':  return <Badge variant="destructive">Low</Badge>;
  }
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useProviderUtilization() {
  return useQuery({
    queryKey: ['provider_utilization'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_utilization')
        .select('id, provider_name, profile_id, total_timeslots, avg_utilization_pct, window_start, window_end, imported_at')
        .order('avg_utilization_pct', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 5 * 60_000,
  });
}

function useUtilizationDaily() {
  return useQuery({
    queryKey: ['utilization_daily'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('utilization_daily')
        .select('util_date, overall_pct')
        .order('util_date', { ascending: true })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as { util_date: string; overall_pct: number }[];
    },
    staleTime: 5 * 60_000,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function UtilizationPage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const {
    data: providers = [], isLoading: loadingProviders, refetch, isRefetching,
  } = useProviderUtilization();
  const { data: daily = [] } = useUtilizationDaily();

  const [filterProvider, setFilterProvider] = useState('');
  const [tierFilter, setTierFilter] = useState<Tier | 'all'>('all');

  // ── Derived ─────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    if (!providers.length) return { avg: 0, high: 0, mid: 0, low: 0, totalSlots: 0 };
    const avg = providers.reduce((s: number, p: any) => s + (Number(p.avg_utilization_pct) || 0), 0)
      / providers.length;
    return {
      avg: Math.round(avg),
      high: providers.filter((p: any) => getTier(Number(p.avg_utilization_pct) || 0) === 'high').length,
      mid:  providers.filter((p: any) => getTier(Number(p.avg_utilization_pct) || 0) === 'mid').length,
      low:  providers.filter((p: any) => getTier(Number(p.avg_utilization_pct) || 0) === 'low').length,
      totalSlots: providers.reduce((s: number, p: any) => s + (Number(p.total_timeslots) || 0), 0),
    };
  }, [providers]);

  const filtered = useMemo(() => {
    let r = providers as any[];
    if (filterProvider) {
      r = r.filter((p) =>
        p.provider_name.toLowerCase().includes(filterProvider.toLowerCase())
      );
    }
    if (tierFilter !== 'all') {
      r = r.filter((p) => getTier(Number(p.avg_utilization_pct) || 0) === tierFilter);
    }
    return r;
  }, [providers, filterProvider, tierFilter]);

  const chartData = daily.map((d) => ({
    date: d.util_date.slice(5),   // MM-DD
    pct: Number(d.overall_pct),
  }));

  const avgTrend =
    chartData.length
      ? chartData.reduce((s, d) => s + d.pct, 0) / chartData.length
      : 0;

  // ── Render ──────────────────────────────────────────────────────────────────

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
              <h1 className="text-2xl font-bold">Utilization</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Provider utilization snapshots · import via License Optimizer
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
            </Button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Network Avg</p>
                <p className="text-2xl font-bold">{kpis.avg}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Total Slots</p>
                <p className="text-2xl font-bold">{kpis.totalSlots.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">High ≥ 80%</p>
                <p className="text-2xl font-bold text-emerald-600">{kpis.high}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Mid 50–79%</p>
                <p className="text-2xl font-bold text-yellow-600">{kpis.mid}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Low &lt; 50%</p>
                <p className="text-2xl font-bold text-destructive">{kpis.low}</p>
              </CardContent>
            </Card>
          </div>

          {/* Daily trend chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Daily Overall Utilization
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    30-day avg {avgTrend.toFixed(1)}%
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                    <ReferenceLine y={80} stroke="#10b981" strokeDasharray="4 2" label={{ value: '80%', fontSize: 10 }} />
                    <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '50%', fontSize: 10 }} />
                    <Line
                      type="monotone"
                      dataKey="pct"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                      name="Utilization"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Provider table */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 flex-wrap">
              <CardTitle className="text-base flex-1">Provider Utilization</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    downloadCSV(
                      filtered.map((p: any) => ({
                        provider_name: p.provider_name,
                        total_timeslots: p.total_timeslots ?? '',
                        avg_utilization_pct: Number(p.avg_utilization_pct || 0).toFixed(1),
                        tier: getTier(Number(p.avg_utilization_pct) || 0),
                        window_start: p.window_start ?? '',
                        window_end: p.window_end ?? '',
                      })),
                      'provider-utilization.csv'
                    )
                  }
                  disabled={filtered.length === 0}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
                {(['all', 'high', 'mid', 'low'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTierFilter(t)}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                      tierFilter === t
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted border-border'
                    )}
                  >
                    {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
                <input
                  placeholder="Search…"
                  value={filterProvider}
                  onChange={(e) => setFilterProvider(e.target.value)}
                  className="px-3 py-1.5 border rounded text-sm w-36 bg-background"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingProviders ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No utilization data. Upload provider CSV via the License Optimizer.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Provider</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total Slots</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-44">Utilization</th>
                        <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Tier</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Window</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p: any) => {
                        const pct = Number(p.avg_utilization_pct) || 0;
                        return (
                          <tr key={p.id} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-medium">{p.provider_name}</td>
                            <td className="px-4 py-2.5 text-right font-mono">
                              {p.total_timeslots?.toLocaleString() ?? '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <Progress
                                  value={pct}
                                  className="h-1.5 w-24"
                                />
                                <span className="font-mono text-xs w-12 text-right">
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <TierBadge tier={getTier(pct)} />
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {p.window_start && p.window_end
                                ? `${p.window_start} – ${p.window_end}`
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
