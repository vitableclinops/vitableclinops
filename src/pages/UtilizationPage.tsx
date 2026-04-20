import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RefreshCw, Download, Info, ChevronDown, DollarSign } from 'lucide-react';
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

type SyncStatus = {
  source: 'metabase_sync' | 'csv_manual' | null;
  syncedAt: string | null;
};

/**
 * Freshest row across provider_utilization: tells ops whether the data on
 * screen came from the nightly Metabase sync or a manual CSV upload, and when.
 */
function useProviderUtilizationSyncStatus() {
  return useQuery({
    queryKey: ['provider_utilization_sync_status'],
    queryFn: async (): Promise<SyncStatus> => {
      const { data } = await supabase
        .from('provider_utilization')
        .select('source, synced_at')
        .order('synced_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const row = data as { source?: string | null; synced_at?: string | null } | null;
      return {
        source: (row?.source as SyncStatus['source']) ?? null,
        syncedAt: row?.synced_at ?? null,
      };
    },
    staleTime: 5 * 60_000,
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
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
  const { data: syncStatus } = useProviderUtilizationSyncStatus();

  const [filterProvider, setFilterProvider] = useState('');
  const [tierFilter, setTierFilter] = useState<Tier | 'all'>('all');
  const [showGuide, setShowGuide] = useState(false);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    if (!providers.length) return { avg: 0, high: 0, mid: 0, low: 0, totalSlots: 0, filledSlots: 0 };
    const avg = providers.reduce((s: number, p: any) => s + (Number(p.avg_utilization_pct) || 0), 0)
      / providers.length;
    const totalSlots = providers.reduce((s: number, p: any) => s + (Number(p.total_timeslots) || 0), 0);
    const filledSlots = Math.round(totalSlots * (avg / 100));
    return {
      avg: Math.round(avg),
      high: providers.filter((p: any) => getTier(Number(p.avg_utilization_pct) || 0) === 'high').length,
      mid:  providers.filter((p: any) => getTier(Number(p.avg_utilization_pct) || 0) === 'mid').length,
      low:  providers.filter((p: any) => getTier(Number(p.avg_utilization_pct) || 0) === 'low').length,
      totalSlots,
      filledSlots,
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
                Provider utilization snapshots · auto-synced nightly from Metabase
              </p>
              {syncStatus && syncStatus.syncedAt && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={syncStatus.source === 'metabase_sync' ? 'secondary' : 'outline'}>
                    {syncStatus.source === 'metabase_sync' ? 'Metabase sync' : 'Manual CSV'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    last updated {formatRelative(syncStatus.syncedAt)}
                  </span>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
            </Button>
          </div>

          {/* How to use guide */}
          <Collapsible open={showGuide} onOpenChange={setShowGuide}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground -mt-2 mb-1 h-7 px-2 text-xs">
                <Info className="h-3.5 w-3.5" />
                How to use this page
                <ChevronDown className={cn('h-3 w-3 transition-transform', showGuide && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Alert className="mb-4 bg-muted/40 border-border">
                <AlertDescription className="text-sm space-y-3">
                  <p className="font-semibold text-foreground">Purpose: track how efficiently providers are filling their scheduled slots, identify under-utilized providers, and report cost-per-visit metrics for leadership.</p>
                  <p className="font-medium text-foreground">How to get data in:</p>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">Export from Metabase</span>
                      {' '}— run the <em>provider utilization by window</em> question. CSV needs:{' '}
                      <code className="bg-muted px-1 rounded text-xs">Provider</code>,{' '}
                      <code className="bg-muted px-1 rounded text-xs">Total Timeslots</code>,{' '}
                      <code className="bg-muted px-1 rounded text-xs">Avg Utilization %</code>.
                      For the daily trend chart, also export the <em>daily overall utilization rate</em> question.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Upload via License Optimizer</span>
                      {' '}— go to{' '}
                      <a href="/admin/license-optimizer" className="underline text-primary">License Optimizer → Upload data files</a>
                      {' '}and include both files in the bulk upload. Come back here after clicking Recompute.
                    </li>
                  </ol>
                  <p className="font-medium text-foreground">Reading the data:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                    <li><span className="font-medium text-foreground">High tier (≥ 80%)</span> — provider is well-utilized. At risk of burnout if consistently at 95%+.</li>
                    <li><span className="font-medium text-foreground">Mid tier (50–79%)</span> — room to grow. Consider adding states or increasing schedule density.</li>
                    <li><span className="font-medium text-foreground">Low tier ({'<'} 50%)</span> — significant underutilization. Investigate: wrong state mix, low demand in their states, schedule gaps. These providers are the highest-cost-per-visit contributors.</li>
                  </ul>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Cost per visit context:</span>
                    {' '}A provider paid for 40h/week at 40% utilization has ~2× the effective cost per visit vs. one at 80%. Use the "Implied Cost/Visit" card to track this at the network level. The target is to keep network utilization above 70% to maintain competitive cost per visit.
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">For leadership:</span>
                    {' '}"Network Avg" utilization and the daily trend chart are the headline metrics. Filter to "Low" tier to generate the underutilization watchlist. Export the table for weekly ops reviews. Compare against prior periods by re-uploading historical CSVs.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

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

          {/* Cost per visit context card */}
          {kpis.avg > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-5 flex items-start gap-4">
                <div className="rounded-lg p-2 bg-primary">
                  <DollarSign className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Cost-Per-Visit Efficiency</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    At <span className="font-semibold text-foreground">{kpis.avg}%</span> network utilization,
                    {' '}approximately <span className="font-semibold text-foreground">{kpis.filledSlots.toLocaleString()}</span> of{' '}
                    <span className="font-semibold text-foreground">{kpis.totalSlots.toLocaleString()}</span> scheduled slots are filled.
                    {kpis.avg < 70 ? (
                      <span className="text-destructive font-medium">
                        {' '}Network is below the 70% efficiency target — unfilled capacity is inflating cost per visit.
                        Focus on the Low tier providers below.
                      </span>
                    ) : kpis.avg < 80 ? (
                      <span className="text-yellow-600 font-medium">
                        {' '}Approaching the 80% high-efficiency threshold. Continue optimizing state mix for Low-tier providers.
                      </span>
                    ) : (
                      <span className="text-emerald-600 font-medium">
                        {' '}Above 80% — strong cost-per-visit efficiency. Monitor for provider burnout at this level.
                      </span>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

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
