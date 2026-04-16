import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { RefreshCw, Download, Info, ChevronDown } from 'lucide-react';
import { cn, downloadCSV } from '@/lib/utils';

// ── Data hook ─────────────────────────────────────────────────────────────────

type CoverageRow = {
  state_abbreviation: string;
  report_date: string;
  pcp_count: number | null;
  coverage_pct: number | null;
};

function usePCPCoverage() {
  return useQuery({
    queryKey: ['pcp_state_coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pcp_state_coverage')
        .select('state_abbreviation, report_date, pcp_count, coverage_pct')
        .order('report_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as CoverageRow[];
    },
    staleTime: 5 * 60_000,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PCPCoveragePage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data = [], isLoading, refetch, isRefetching } = usePCPCoverage();
  const [search, setSearch] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [sortBy, setSortBy] = useState<'state' | 'count' | 'pct'>('count');

  // Latest row per state
  const latestByState = useMemo(() => {
    const map = new Map<string, CoverageRow>();
    for (const row of data) {
      if (!map.has(row.state_abbreviation)) map.set(row.state_abbreviation, row);
    }
    return Array.from(map.values());
  }, [data]);

  const kpis = useMemo(() => {
    const totalPCPs = latestByState.reduce((s, r) => s + (r.pcp_count ?? 0), 0);
    const statesCovered = latestByState.filter((r) => (r.pcp_count ?? 0) > 0).length;
    const withPct = latestByState.filter((r) => r.coverage_pct !== null);
    const avgCoverage = withPct.length
      ? withPct.reduce((s, r) => s + Number(r.coverage_pct), 0) / withPct.length
      : null;
    return { totalPCPs, statesCovered, avgCoverage: avgCoverage ? Math.round(avgCoverage * 10) / 10 : null };
  }, [latestByState]);

  const latestDate = data[0]?.report_date ?? '—';

  const filtered = useMemo(() => {
    let rows = latestByState;
    if (search) rows = rows.filter((r) => r.state_abbreviation.toLowerCase().includes(search.toLowerCase()));
    return [...rows].sort((a, b) => {
      if (sortBy === 'state') return a.state_abbreviation.localeCompare(b.state_abbreviation);
      if (sortBy === 'count') return (b.pcp_count ?? -1) - (a.pcp_count ?? -1);
      return (b.coverage_pct ?? -1) - (a.coverage_pct ?? -1);
    });
  }, [latestByState, search, sortBy]);

  const chartData = [...latestByState]
    .filter((r) => r.pcp_count !== null)
    .sort((a, b) => (b.pcp_count ?? 0) - (a.pcp_count ?? 0))
    .slice(0, 20)
    .map((r) => ({ state: r.state_abbreviation, count: r.pcp_count }));

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
              <h1 className="text-2xl font-bold">PCP State Coverage</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Primary care provider counts by state · latest snapshot: {latestDate}
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
                    Shows PCP (Primary Care Provider) counts and coverage per state, pulled daily from Metabase.
                  </p>
                  <p className="text-muted-foreground">
                    Use this alongside <a href="/admin/ops" className="underline text-primary">Coverage Hub</a> to
                    understand whether states with low SLA attainment are also understaffed on PCPs.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Total PCPs</p>
                <p className="text-2xl font-bold">{kpis.totalPCPs.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">States Covered</p>
                <p className="text-2xl font-bold">{kpis.statesCovered}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Avg Coverage</p>
                <p className="text-2xl font-bold">
                  {kpis.avgCoverage !== null ? `${kpis.avgCoverage}%` : '—'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Bar chart — top states by PCP count */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top States by PCP Count</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="state" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" name="PCPs" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* State table */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 flex-wrap">
              <CardTitle className="text-base flex-1">Coverage by State</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={() => downloadCSV(
                    filtered.map((r) => ({
                      state: r.state_abbreviation,
                      pcp_count: r.pcp_count ?? '',
                      coverage_pct: r.coverage_pct ?? '',
                      report_date: r.report_date,
                    })),
                    'pcp-state-coverage.csv'
                  )}
                  disabled={filtered.length === 0}
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
                {(['state', 'count', 'pct'] as const).map((s) => (
                  <button key={s} onClick={() => setSortBy(s)}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                      sortBy === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted border-border'
                    )}>
                    {s === 'state' ? 'A–Z' : s === 'count' ? 'By Count' : 'By Coverage'}
                  </button>
                ))}
                <input
                  placeholder="Filter state…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 border rounded text-sm w-32 bg-background"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No data yet. Data will appear after the next daily pull (7 AM ET).
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">State</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">PCP Count</th>
                        {filtered.some((r) => r.coverage_pct !== null) && (
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Coverage %</th>
                        )}
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">As of</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.state_abbreviation} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 font-semibold">{r.state_abbreviation}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold">
                            {r.pcp_count?.toLocaleString() ?? '—'}
                          </td>
                          {filtered.some((r) => r.coverage_pct !== null) && (
                            <td className="px-4 py-2.5 text-right font-mono">
                              {r.coverage_pct !== null
                                ? <span className={Number(r.coverage_pct) >= 80 ? 'text-emerald-600' : Number(r.coverage_pct) >= 50 ? 'text-yellow-600' : 'text-destructive'}>
                                    {Number(r.coverage_pct).toFixed(1)}%
                                  </span>
                                : '—'}
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.report_date}</td>
                        </tr>
                      ))}
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
