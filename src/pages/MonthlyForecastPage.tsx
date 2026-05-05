import { useMemo, useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Info, Loader2, TrendingUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useMonthlyDemand,
  useMonthlyDecisions,
  useMonthlyForecastSummary,
} from '@/hooks/useMonthlySchedulingForecast';
import { downloadCSV } from '@/lib/utils';

// Months we offer in the picker — keep tight, surfaces the current planning horizon.
const MONTH_OPTIONS = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'];

const formatMonthLabel = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatNumber = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const formatPct = (n: number | null) =>
  n == null ? '—' : `${n.toFixed(1)}%`;

const decisionBadgeVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'accepted':
      return 'default';
    case 'partial':
      return 'secondary';
    case 'declined':
      return 'destructive';
    default:
      return 'outline';
  }
};

const MonthlyForecastPage = () => {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin')
    ? 'admin'
    : roles.includes('pod_lead')
    ? 'pod_lead'
    : 'provider';
  const [month, setMonth] = useState('2026-06-01');

  const demandQ = useMonthlyDemand(month);
  const decisionsQ = useMonthlyDecisions(month);
  const { summary, loading } = useMonthlyForecastSummary(month);

  const demandRows = demandQ.data ?? [];
  const decisionRows = decisionsQ.data ?? [];

  const sortedDemand = useMemo(
    () => [...demandRows].sort((a, b) => b.monthly_visits_target - a.monthly_visits_target),
    [demandRows],
  );

  const sortedDecisions = useMemo(() => {
    const order = { accepted: 0, partial: 1, declined: 2, pending: 3 } as Record<string, number>;
    return [...decisionRows].sort((a, b) => {
      const aOrder = order[a.decision_status] ?? 99;
      const bOrder = order[b.decision_status] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.provider_name.localeCompare(b.provider_name);
    });
  }, [decisionRows]);

  const downloadDemand = () => {
    downloadCSV(
      sortedDemand.map(r => ({
        state: r.state,
        monthly_visits_target: r.monthly_visits_target,
        monthly_hours_target: Number(r.monthly_hours_target).toFixed(1),
        daily_target_slots: r.daily_target_slots,
        growth_multiplier: Number(r.growth_multiplier).toFixed(2),
      })),
      `demand_forecast_${month}.csv`,
    );
  };

  const downloadDecisions = () => {
    downloadCSV(
      sortedDecisions.map(r => ({
        provider: r.provider_name,
        decision: r.decision_status,
        accepted_hours: r.accepted_hours ?? 0,
        declined_hours: r.declined_hours ?? 0,
        notes: r.decision_notes ?? '',
        submitted_at: r.submitted_at,
      })),
      `recommended_hours_${month}.csv`,
    );
  };

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

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="h-6 w-6 text-emerald-600" />
                Monthly Schedule Forecast
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                State-level demand and provider-level recommended hours for the planning month.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map(m => (
                    <SelectItem key={m} value={m}>{formatMonthLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Reading from the scheduling Supabase project (<code>bbquooftytwprllipcsb</code>).
              Demand from <code>state_demand_targets</code>; recommended hours from
              <code> schedule_submissions</code> after the evaluator run.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="Network demand (visits)"
              value={summary ? formatNumber(summary.totalDemandVisits) : '—'}
              loading={loading}
            />
            <KpiCard
              label="Demand hours target"
              value={summary ? formatNumber(summary.totalDemandHours, 0) : '—'}
              loading={loading}
            />
            <KpiCard
              label="Accepted hours"
              value={summary ? formatNumber(summary.totalAcceptedHours, 0) : '—'}
              loading={loading}
              footer={summary ? `${summary.acceptedCount} accepted · ${summary.partialCount} partial · ${summary.declinedCount} declined` : undefined}
            />
            <KpiCard
              label="Fill rate"
              value={summary ? formatPct(summary.fillRatePct) : '—'}
              loading={loading}
              footer={summary ? `${summary.providerCount} providers submitted` : undefined}
              accent={summary?.fillRatePct != null && summary.fillRatePct >= 95 ? 'good' : summary?.fillRatePct != null && summary.fillRatePct < 80 ? 'bad' : 'neutral'}
            />
          </div>

          <Tabs defaultValue="recommendations" className="w-full">
            <TabsList>
              <TabsTrigger value="recommendations">Recommended Hours ({decisionRows.length})</TabsTrigger>
              <TabsTrigger value="demand">Demand Forecast ({demandRows.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="recommendations">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">Per-provider recommendations · {formatMonthLabel(month)}</CardTitle>
                  <Button variant="outline" size="sm" onClick={downloadDecisions} disabled={!decisionRows.length}>
                    <Download className="h-4 w-4 mr-1" />
                    CSV
                  </Button>
                </CardHeader>
                <CardContent>
                  {decisionsQ.isLoading ? (
                    <div className="py-12 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : decisionRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">No submissions for {formatMonthLabel(month)} yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase text-muted-foreground border-b">
                          <tr>
                            <th className="text-left py-2 px-2 font-medium">Provider</th>
                            <th className="text-left py-2 px-2 font-medium">Decision</th>
                            <th className="text-right py-2 px-2 font-medium">Accepted hrs</th>
                            <th className="text-right py-2 px-2 font-medium">Declined hrs</th>
                            <th className="text-left py-2 px-2 font-medium">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {sortedDecisions.map(row => (
                            <tr key={row.id} className="hover:bg-muted/30">
                              <td className="py-2 px-2 font-medium">{row.provider_name}</td>
                              <td className="py-2 px-2">
                                <Badge variant={decisionBadgeVariant(row.decision_status)}>
                                  {row.decision_status}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums">
                                {row.accepted_hours != null ? Number(row.accepted_hours).toFixed(1) : '—'}
                              </td>
                              <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                                {row.declined_hours != null && Number(row.declined_hours) > 0
                                  ? Number(row.declined_hours).toFixed(1)
                                  : '—'}
                              </td>
                              <td className="py-2 px-2 text-xs text-muted-foreground max-w-md">{row.decision_notes ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="demand">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">State demand · {formatMonthLabel(month)}</CardTitle>
                  <Button variant="outline" size="sm" onClick={downloadDemand} disabled={!demandRows.length}>
                    <Download className="h-4 w-4 mr-1" />
                    CSV
                  </Button>
                </CardHeader>
                <CardContent>
                  {demandQ.isLoading ? (
                    <div className="py-12 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : demandRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">No demand forecast for {formatMonthLabel(month)} yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase text-muted-foreground border-b">
                          <tr>
                            <th className="text-left py-2 px-2 font-medium">State</th>
                            <th className="text-right py-2 px-2 font-medium">Monthly visits</th>
                            <th className="text-right py-2 px-2 font-medium">Hours target</th>
                            <th className="text-right py-2 px-2 font-medium">Daily slots</th>
                            <th className="text-right py-2 px-2 font-medium">Growth ×</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {sortedDemand.map(row => (
                            <tr key={`${row.state}-${row.month}`} className="hover:bg-muted/30">
                              <td className="py-2 px-2 font-medium">{row.state}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{formatNumber(row.monthly_visits_target)}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{formatNumber(Number(row.monthly_hours_target), 0)}</td>
                              <td className="py-2 px-2 text-right tabular-nums">{row.daily_target_slots}</td>
                              <td className="py-2 px-2 text-right tabular-nums">
                                {Number(row.growth_multiplier).toFixed(2)}
                                {Number(row.growth_multiplier) !== 1 && (
                                  <span className="text-xs text-muted-foreground ml-1">×</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

interface KpiCardProps {
  label: string;
  value: string;
  loading: boolean;
  footer?: string;
  accent?: 'good' | 'bad' | 'neutral';
}

const KpiCard = ({ label, value, loading, footer, accent = 'neutral' }: KpiCardProps) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent === 'good' ? 'text-emerald-600' : accent === 'bad' ? 'text-red-600' : ''}`}>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
      </div>
      {footer && <div className="text-xs text-muted-foreground mt-1">{footer}</div>}
    </CardContent>
  </Card>
);

export default MonthlyForecastPage;
