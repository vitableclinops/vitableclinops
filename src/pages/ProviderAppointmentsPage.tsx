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
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { RefreshCw, Download, Info, ChevronDown } from 'lucide-react';
import { cn, downloadCSV } from '@/lib/utils';

// ── Data hook ─────────────────────────────────────────────────────────────────

type ApptRow = {
  provider_name_raw: string;
  report_date: string;
  appointment_count: number;
};

function useProviderAppointments() {
  return useQuery({
    queryKey: ['provider_appointment_count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_appointment_count')
        .select('provider_name_raw, report_date, appointment_count')
        .order('report_date', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as ApptRow[];
    },
    staleTime: 5 * 60_000,
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ProviderAppointmentsPage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data = [], isLoading, refetch, isRefetching } = useProviderAppointments();
  const [search, setSearch] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  const latestDate = data[0]?.report_date ?? null;

  // Latest snapshot per provider (most recent date)
  const latestByProvider = useMemo(() => {
    const map = new Map<string, ApptRow>();
    for (const row of data) {
      if (!map.has(row.provider_name_raw)) map.set(row.provider_name_raw, row);
    }
    return Array.from(map.values()).sort((a, b) => b.appointment_count - a.appointment_count);
  }, [data]);

  const kpis = useMemo(() => {
    if (!latestByProvider.length) return { total: 0, avg: 0, topProvider: null, topCount: 0 };
    const total = latestByProvider.reduce((s, r) => s + r.appointment_count, 0);
    const avg = Math.round(total / latestByProvider.length);
    const top = latestByProvider[0];
    return { total, avg, topProvider: top?.provider_name_raw ?? null, topCount: top?.appointment_count ?? 0 };
  }, [latestByProvider]);

  const filtered = useMemo(() => {
    if (!search) return latestByProvider;
    return latestByProvider.filter((r) =>
      r.provider_name_raw.toLowerCase().includes(search.toLowerCase())
    );
  }, [latestByProvider, search]);

  const chartData = latestByProvider.slice(0, 15).map((r) => ({
    name: r.provider_name_raw.split(' ').slice(-1)[0],  // Last name only for chart
    count: r.appointment_count,
    full: r.provider_name_raw,
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
              <h1 className="text-2xl font-bold">Provider Appointment Count</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Appointment volume by provider · latest snapshot: {latestDate ?? '—'}
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
                    Shows appointment volume per provider, pulled daily from the Metabase "Provider Appointment Count" report.
                  </p>
                  <p className="text-muted-foreground">
                    Cross-reference with <a href="/admin/utilization" className="underline text-primary">Utilization</a> to see
                    whether providers with high appointment counts are also highly utilized, or if there's a mismatch.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Total Appointments</p>
                <p className="text-2xl font-bold">{kpis.total.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Providers</p>
                <p className="text-2xl font-bold">{latestByProvider.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Avg per Provider</p>
                <p className="text-2xl font-bold">{kpis.avg.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Top Provider</p>
                <p className="text-lg font-bold truncate" title={kpis.topProvider ?? ''}>
                  {kpis.topProvider
                    ? `${kpis.topProvider.split(' ').slice(-1)[0]} (${kpis.topCount.toLocaleString()})`
                    : '—'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Bar chart — top 15 providers */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top 15 Providers by Appointment Count</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(l, p) => p[0]?.payload?.full ?? l} />
                    <Bar dataKey="count" fill="#6366f1" name="Appointments" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Provider table */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-3 flex-wrap">
              <CardTitle className="text-base flex-1">All Providers</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={() => downloadCSV(
                    filtered.map((r) => ({
                      provider: r.provider_name_raw,
                      appointment_count: r.appointment_count,
                      report_date: r.report_date,
                    })),
                    'provider-appointment-count.csv'
                  )}
                  disabled={filtered.length === 0}
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
                <input
                  placeholder="Search provider…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 border rounded text-sm w-40 bg-background"
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
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">#</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Provider</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Appointments</th>
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">As of</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r, i) => (
                        <tr key={r.provider_name_raw} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium">{r.provider_name_raw}</td>
                          <td className="px-4 py-2.5 text-right font-bold font-mono">
                            {r.appointment_count.toLocaleString()}
                          </td>
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
