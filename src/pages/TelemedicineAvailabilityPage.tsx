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
import { Progress } from '@/components/ui/progress';
import { RefreshCw, Download, Info, ChevronDown } from 'lucide-react';
import { cn, downloadCSV } from '@/lib/utils';

// ── Data hook ─────────────────────────────────────────────────────────────────

type AvailRow = {
  state_abbreviation: string;
  report_date: string;
  availability_pct: number | null;
  available_count: number | null;
};

function useTelemedicineAvailability() {
  return useQuery({
    queryKey: ['telemedicine_availability'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telemedicine_availability')
        .select('state_abbreviation, report_date, availability_pct, available_count')
        .order('report_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AvailRow[];
    },
    staleTime: 5 * 60_000,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function availBadge(pct: number | null) {
  if (pct === null) return <Badge variant="outline">—</Badge>;
  if (pct >= 80) return <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">High</Badge>;
  if (pct >= 50) return <Badge className="bg-yellow-500 text-white hover:bg-yellow-500">Mid</Badge>;
  return <Badge variant="destructive">Low</Badge>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TelemedicineAvailabilityPage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data = [], isLoading, refetch, isRefetching } = useTelemedicineAvailability();
  const [search, setSearch] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  // Latest snapshot per state
  const latestByState = useMemo(() => {
    const map = new Map<string, AvailRow>();
    for (const row of data) {
      if (!map.has(row.state_abbreviation)) map.set(row.state_abbreviation, row);
    }
    return Array.from(map.values()).sort((a, b) =>
      (b.availability_pct ?? -1) - (a.availability_pct ?? -1)
    );
  }, [data]);

  const kpis = useMemo(() => {
    const withPct = latestByState.filter((r) => r.availability_pct !== null);
    if (!withPct.length) return { avg: null, high: 0, mid: 0, low: 0 };
    const avg = withPct.reduce((s, r) => s + Number(r.availability_pct), 0) / withPct.length;
    return {
      avg: Math.round(avg * 10) / 10,
      high: withPct.filter((r) => Number(r.availability_pct) >= 80).length,
      mid:  withPct.filter((r) => Number(r.availability_pct) >= 50 && Number(r.availability_pct) < 80).length,
      low:  withPct.filter((r) => Number(r.availability_pct) < 50).length,
    };
  }, [latestByState]);

  const latestDate = latestByState[0]?.report_date ?? '—';

  const filtered = useMemo(() => {
    if (!search) return latestByState;
    return latestByState.filter((r) =>
      r.state_abbreviation.toLowerCase().includes(search.toLowerCase())
    );
  }, [latestByState, search]);

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
              <h1 className="text-2xl font-bold">Telemedicine Availability</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Per-state telemedicine availability · latest snapshot: {latestDate}
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
                    Shows telemedicine provider availability by state, pulled daily from the Metabase report
                    <em> rpt_telemedicine_availability_by_state_per_day</em>.
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                    <li><span className="font-medium text-foreground">High (≥ 80%)</span> — strong telemedicine coverage in this state</li>
                    <li><span className="font-medium text-foreground">Mid (50–79%)</span> — partial coverage; may need reinforcement</li>
                    <li><span className="font-medium text-foreground">Low (&lt; 50%)</span> — limited telemedicine availability; coordinate with ops</li>
                  </ul>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Network Avg</p>
                <p className="text-2xl font-bold">
                  {kpis.avg !== null ? `${kpis.avg}%` : '—'}
                </p>
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

          {/* State table */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 flex-wrap">
              <CardTitle className="text-base flex-1">Availability by State</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={() => downloadCSV(
                    filtered.map((r) => ({
                      state: r.state_abbreviation,
                      report_date: r.report_date,
                      availability_pct: r.availability_pct ?? '',
                      available_count: r.available_count ?? '',
                    })),
                    'telemedicine-availability.csv'
                  )}
                  disabled={filtered.length === 0}
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
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
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-52">Availability</th>
                        <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Level</th>
                        {filtered.some((r) => r.available_count !== null) && (
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Count</th>
                        )}
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">As of</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const pct = r.availability_pct !== null ? Number(r.availability_pct) : null;
                        return (
                          <tr key={r.state_abbreviation} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-semibold">{r.state_abbreviation}</td>
                            <td className="px-4 py-2.5">
                              {pct !== null ? (
                                <div className="flex items-center gap-2">
                                  <Progress value={pct} className="h-1.5 w-24" />
                                  <span className="font-mono text-xs w-12">{pct.toFixed(1)}%</span>
                                </div>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-center">{availBadge(pct)}</td>
                            {filtered.some((r) => r.available_count !== null) && (
                              <td className="px-4 py-2.5 text-right font-mono">
                                {r.available_count ?? '—'}
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.report_date}</td>
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
