import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { Upload, RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, Download, Info, ChevronDown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, downloadCSV } from '@/lib/utils';
import { slaTargetDailyRounded } from '@/lib/metrics';

const LINE_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

// ── Business logic ─────────────────────────────────────────────────────────────

/** Hours needed = visits × 0.5h × 1.5 buffer */
function hoursNeeded(visits: number) {
  return Math.round(visits * 0.75 * 10) / 10;
}

// Daily SLA target formula lives in `@/lib/metrics` so Ops Dashboard and this
// page are guaranteed to display the same number. Aliased for call-site
// readability only.
const slaTargetDaily = slaTargetDailyRounded;

// ── Data hook ─────────────────────────────────────────────────────────────────

interface ForecastRow {
  id: string;
  state_abbreviation: string;
  week_start: string;
  projected_visits: number;
}

function useDemandForecast() {
  return useQuery({
    queryKey: ['demand_forecast'],
    queryFn: async (): Promise<ForecastRow[]> => {
      const { data, error } = await supabase
        .from('demand_forecast')
        .select('id, state_abbreviation, week_start, projected_visits')
        .order('week_start', { ascending: true })
        .order('state_abbreviation', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ForecastRow[];
    },
    staleTime: 5 * 60_000,
  });
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function parseCSV(text: string) {
  const [header, ...dataLines] = text.trim().split('\n');
  const delim =
    (header.match(/\t/g) || []).length >= (header.match(/,/g) || []).length ? '\t' : ',';
  const cols = header.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
  return dataLines.map((line) => {
    const vals = line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']));
  });
}

function colVal(row: Record<string, string>, ...keywords: string[]): string | undefined {
  for (const kw of keywords) {
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(kw.toLowerCase()));
    if (key && row[key] !== '') return row[key];
  }
  return undefined;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DemandForecastPage() {
  const { profile, roles } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data: rows = [], isLoading, refetch, isRefetching } = useDemandForecast();
  const [uploading, setUploading] = useState(false);
  const [filterState, setFilterState] = useState('');
  const [selectedWeek, setSelectedWeek] = useState<string>('all');
  const [showGuide, setShowGuide] = useState(false);

  // ── CSV import ──────────────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);

    try {
      for (const file of files) {
        const raw = await file.text();
        const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const dataRows = parseCSV(text);

        const importRows = dataRows.map((r, i) => ({
          state:      colVal(r, 'state')               ?? Object.values(r)[0] ?? '',
          week_start: colVal(r, 'week', 'date', 'period') ?? Object.values(r)[1] ?? '',
          visits:     colVal(r, 'visit', 'demand', 'projected', 'forecast') ?? Object.values(r)[2] ?? '0',
        })).filter((r) => r.state && r.week_start);

        const { data: result, error } = await supabase.functions.invoke(
          'import-demand-forecast',
          { body: { rows: importRows } }
        );
        if (error) throw error;
        toast({
          title: `${file.name}`,
          description: `${result.inserted ?? '?'} rows imported${result.errors?.length ? `, ${result.errors.length} skipped` : ''}`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['demand_forecast'] });
    } catch (err: any) {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  const weeks = useMemo(
    () => [...new Set(rows.map((r) => r.week_start))].sort(),
    [rows]
  );

  const latestWeek = weeks[weeks.length - 1] ?? null;

  // Default to latest week once data loads
  useEffect(() => {
    if (latestWeek && selectedWeek === 'all') setSelectedWeek(latestWeek);
  }, [latestWeek]); // eslint-disable-line react-hooks/exhaustive-deps

  const latestRows = useMemo(
    () => (latestWeek ? rows.filter((r) => r.week_start === latestWeek) : []),
    [rows, latestWeek]
  );

  const kpis = useMemo(() => {
    const totalVisits = latestRows.reduce((s, r) => s + r.projected_visits, 0);
    const peak = [...latestRows].sort((a, b) => b.projected_visits - a.projected_visits)[0];
    return {
      states: latestRows.length,
      totalVisits,
      totalHours: hoursNeeded(totalVisits),
      peakState: peak?.state_abbreviation ?? '—',
    };
  }, [latestRows]);

  // Network totals by week for bar chart (last 8 weeks)
  const chartData = useMemo(() => {
    return weeks.slice(-8).map((w) => {
      const wRows = rows.filter((r) => r.week_start === w);
      const visits = wRows.reduce((s, r) => s + r.projected_visits, 0);
      return {
        week: w.slice(5),         // MM-DD
        visits,
        hours: hoursNeeded(visits),
      };
    });
  }, [rows, weeks]);

  // Week-over-week delta lookup
  const priorWeek = weeks.length >= 2 ? weeks[weeks.length - 2] : null;
  const priorMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!priorWeek) return m;
    rows.filter((r) => r.week_start === priorWeek).forEach((r) => {
      m.set(r.state_abbreviation, r.projected_visits);
    });
    return m;
  }, [rows, priorWeek]);

  const filtered = useMemo(() => {
    let r = rows;
    if (selectedWeek !== 'all') r = r.filter((row) => row.week_start === selectedWeek);
    if (filterState) r = r.filter((row) =>
      row.state_abbreviation.toLowerCase().includes(filterState.toLowerCase())
    );
    return r;
  }, [rows, filterState, selectedWeek]);

  // Top states by latest week for trend chart
  const topStates = useMemo(() => {
    return [...latestRows]
      .sort((a, b) => b.projected_visits - a.projected_visits)
      .slice(0, 10)
      .map((r) => r.state_abbreviation);
  }, [latestRows]);

  // Trend chart: last 8 weeks × top states
  const trendData = useMemo(() => {
    return weeks.slice(-8).map((w) => {
      const entry: Record<string, any> = { week: w.slice(5) };
      const wRows = rows.filter((r) => r.week_start === w);
      topStates.forEach((st) => {
        const match = wRows.find((r) => r.state_abbreviation === st);
        entry[st] = match?.projected_visits ?? null;
      });
      return entry;
    });
  }, [rows, weeks, topStates]);

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
              <h1 className="text-2xl font-bold">Demand Forecast</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Weekly demand projections per state · upload Metabase CSV to refresh
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
              </Button>
              <label>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  multiple
                  className="hidden"
                  onChange={handleImport}
                  disabled={uploading}
                />
                <Button variant="outline" size="sm" asChild disabled={uploading}>
                  <span className="cursor-pointer">
                    {uploading
                      ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      : <Upload className="h-4 w-4 mr-2" />}
                    Import CSV
                  </span>
                </Button>
              </label>
            </div>
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
                  <p className="font-semibold text-foreground">Purpose: predict visit volume per state so you can right-size provider coverage before the week starts.</p>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">Export from Metabase</span>
                      {' '}— run the <em>weekly demand forecast by state</em> question. CSV needs columns:{' '}
                      <code className="bg-muted px-1 rounded text-xs">State</code>,{' '}
                      <code className="bg-muted px-1 rounded text-xs">Week</code>,{' '}
                      <code className="bg-muted px-1 rounded text-xs">Visits</code>{' '}
                      (exact names don't matter — the importer matches by keyword).
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Click "Import CSV"</span>
                      {' '}(top-right of this page) and select your file. You'll see a toast confirming rows imported.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Read the table</span>
                      {' '}— sort by Projected Visits descending. The "vs Prior Week" column flags demand spikes ({'>'}+20% warrants extra staffing). "Daily SLA Target" is the minimum same/next-day slots needed each day to hit SLA.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Act on high-demand states</span>
                      {' '}— take states with large WoW increases to the{' '}
                      <a href="/admin/matching" className="underline text-primary">Demand Matching Engine</a>
                      {' '}to ensure enough provider hours are allocated.
                    </li>
                  </ol>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">For leadership:</span>
                    {' '}Use the "Network Weekly Demand" bar chart to show total visit volume trend. Export the table for weekly ops reviews. The "Hours Needed" column (visits × 0.5h × 1.5× buffer) tells you the provider hours required to meet demand.
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Data freshness:</span>
                    {' '}Re-import every Monday morning before the weekly staffing call. Historical weeks are preserved — use the week selector to compare any two periods.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">States (latest week)</p>
                <p className="text-2xl font-bold">{kpis.states}</p>
                {latestWeek && (
                  <p className="text-xs text-muted-foreground mt-0.5">w/o {latestWeek}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Projected Visits</p>
                <p className="text-2xl font-bold">{kpis.totalVisits.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Hours Needed</p>
                <p className="text-2xl font-bold">{kpis.totalHours.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-0.5">visits × 0.5h × 1.5×</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Peak Demand State</p>
                <p className="text-2xl font-bold">{kpis.peakState}</p>
              </CardContent>
            </Card>
          </div>

          {/* Network demand chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Network Weekly Demand</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="visits" fill="#6366f1" name="Projected Visits" />
                    <Bar dataKey="hours"  fill="#f59e0b" name="Hours Needed" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* State trend lines */}
          {trendData.length > 1 && topStates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  State Demand Trends
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    top {topStates.length} states · last 8 weeks
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={trendData}
                    margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {topStates.map((st, i) => (
                      <Line
                        key={st}
                        type="monotone"
                        dataKey={st}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Forecast table */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 flex-wrap">
              <CardTitle className="text-base flex-1">Forecast by State</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    downloadCSV(
                      filtered.map((r) => {
                        const prior = priorMap.get(r.state_abbreviation);
                        return {
                          state: r.state_abbreviation,
                          week_start: r.week_start,
                          projected_visits: r.projected_visits,
                          vs_prior_week: prior != null ? r.projected_visits - prior : '',
                          hours_needed: hoursNeeded(r.projected_visits),
                          daily_sla_target: slaTargetDaily(r.projected_visits),
                        };
                      }),
                      `demand-forecast-${selectedWeek !== 'all' ? selectedWeek : 'all'}.csv`
                    )
                  }
                  disabled={filtered.length === 0}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
                <Select
                  value={selectedWeek}
                  onValueChange={(v) => setSelectedWeek(v as string)}
                >
                  <SelectTrigger className="h-8 text-xs w-36">
                    <SelectValue placeholder="All weeks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All weeks</SelectItem>
                    {[...weeks].reverse().map((w) => (
                      <SelectItem key={w} value={w}>{w}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  placeholder="Filter state…"
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  className="px-3 py-1.5 border rounded text-sm w-28 bg-background h-8"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No forecast data. Import a Metabase CSV with columns: State, Week, Visits.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">State</th>
                        {selectedWeek === 'all' && (
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Week</th>
                        )}
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Projected Visits</th>
                        {selectedWeek !== 'all' && priorWeek && (
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">vs Prior Week</th>
                        )}
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Hours Needed</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Daily SLA Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const prior = priorMap.get(r.state_abbreviation);
                        const delta = prior != null ? r.projected_visits - prior : null;
                        const deltaPct = prior != null && prior > 0
                          ? ((r.projected_visits - prior) / prior) * 100
                          : null;
                        return (
                          <tr
                            key={`${r.state_abbreviation}-${r.week_start}`}
                            className="border-b hover:bg-muted/30 transition-colors"
                          >
                            <td className="px-4 py-2.5 font-semibold">{r.state_abbreviation}</td>
                            {selectedWeek === 'all' && (
                              <td className="px-4 py-2.5 text-muted-foreground">{r.week_start}</td>
                            )}
                            <td className="px-4 py-2.5 text-right font-mono">
                              {r.projected_visits.toLocaleString()}
                            </td>
                            {selectedWeek !== 'all' && priorWeek && (
                              <td className="px-4 py-2.5 text-right">
                                {delta == null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span className={cn(
                                    'inline-flex items-center gap-1 font-mono text-xs',
                                    delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-destructive' : 'text-muted-foreground'
                                  )}>
                                    {delta > 0
                                      ? <TrendingUp className="h-3 w-3" />
                                      : delta < 0
                                        ? <TrendingDown className="h-3 w-3" />
                                        : <Minus className="h-3 w-3" />}
                                    {delta > 0 ? '+' : ''}{delta}
                                    {deltaPct != null && (
                                      <span className="text-muted-foreground">
                                        ({deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(0)}%)
                                      </span>
                                    )}
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-right font-mono">
                              {hoursNeeded(r.projected_visits).toFixed(1)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono">
                              {slaTargetDaily(r.projected_visits)}
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
