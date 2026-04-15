import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { Upload, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Business logic ─────────────────────────────────────────────────────────────

/** Hours needed = visits × 0.5h × 1.5 buffer */
function hoursNeeded(visits: number) {
  return Math.round(visits * 0.75 * 10) / 10;
}

/** Daily SLA target = max(5, (weekly_visits / 5) × 1.5) */
function slaTargetDaily(visits: number) {
  return Math.round(Math.max(5, (visits / 5) * 1.5));
}

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

  const filtered = useMemo(() => {
    if (!filterState) return rows;
    return rows.filter((r) =>
      r.state_abbreviation.toLowerCase().includes(filterState.toLowerCase())
    );
  }, [rows, filterState]);

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

          {/* Forecast table */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-3">
              <CardTitle className="text-base flex-1">Forecast by State & Week</CardTitle>
              <input
                placeholder="Filter state…"
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="px-3 py-1.5 border rounded text-sm w-32 bg-background"
              />
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
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Week Start</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Projected Visits</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Hours Needed</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Daily SLA Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr
                          key={`${r.state_abbreviation}-${r.week_start}`}
                          className="border-b hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-semibold">{r.state_abbreviation}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.week_start}</td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {r.projected_visits.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {hoursNeeded(r.projected_visits).toFixed(1)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {slaTargetDaily(r.projected_visits)}
                          </td>
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
