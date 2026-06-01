import { useMemo, useState } from 'react';
import SchedulingShell from './SchedulingShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, Info, Loader2, TrendingUp } from 'lucide-react';
import {
  useMonthlyDemand,
  useMonthlyDecisions,
  useMonthlyForecastSummary,
} from '@/hooks/useMonthlySchedulingForecast';
import { downloadCSV } from '@/lib/utils';

const MONTH_OPTIONS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];

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

const decisionVariant = (
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' => {
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

export default function SchedulingForecastPage() {
  const [month, setMonth] = useState('2026-07-01');

  const demandQ = useMonthlyDemand(month);
  const decisionsQ = useMonthlyDecisions(month);
  const { summary, loading } = useMonthlyForecastSummary(month);

  const demandRows = demandQ.data;
  const decisionRows = decisionsQ.data;

  const sortedDemand = useMemo(
    () => [...(demandRows ?? [])].sort((a, b) => b.monthly_visits_target - a.monthly_visits_target),
    [demandRows],
  );

  const sortedDecisions = useMemo(() => {
    const order = { accepted: 0, partial: 1, declined: 2, pending: 3 } as Record<string, number>;
    return [...(decisionRows ?? [])].sort((a, b) => {
      const ao = order[a.decision_status] ?? 99;
      const bo = order[b.decision_status] ?? 99;
      if (ao !== bo) return ao - bo;
      return a.provider_name.localeCompare(b.provider_name);
    });
  }, [decisionRows]);

  const downloadDemand = () => {
    downloadCSV(
      sortedDemand.map(r => ({
        state: r.state,
        monthly_hours_target: Number(r.monthly_hours_target).toFixed(1),
        weekly_hours_target: (Number(r.monthly_hours_target) / 4.33).toFixed(1),
        daily_target_slots: r.daily_target_slots,
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
    <SchedulingShell>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-600" />
            Monthly Schedule Forecast
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            State demand and provider-level recommended hours for the planning month.
          </p>
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map(m => (
              <SelectItem key={m} value={m}>
                {formatMonthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Demand values are monthly hours of provider availability needed (≈ adjusted weekly
          hours × 4.33). Recommended hours come from schedule submissions after the evaluator
          runs.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Network demand hours"
          value={summary ? formatNumber(summary.totalDemandHours) : '—'}
          sub={summary ? `≈ ${(summary.totalDemandHours / 4.33).toFixed(0)} hrs/wk` : undefined}
          loading={loading}
        />
        <Kpi
          label="Accepted hours"
          value={summary ? formatNumber(summary.totalAcceptedHours) : '—'}
          loading={loading}
        />
        <Kpi
          label="Fill rate"
          value={summary?.fillRatePct != null ? `${summary.fillRatePct.toFixed(1)}%` : '—'}
          sub={summary ? `${summary.providerCount} providers submitted` : undefined}
          loading={loading}
        />
        <Kpi
          label="Decisions"
          value={summary ? `${summary.acceptedCount}/${summary.partialCount}/${summary.declinedCount}` : '—'}
          sub="accepted / partial / declined"
          loading={loading}
        />
      </div>

      <Tabs defaultValue="demand">
        <TabsList>
          <TabsTrigger value="demand">State Demand</TabsTrigger>
          <TabsTrigger value="providers">Provider Decisions</TabsTrigger>
        </TabsList>

        <TabsContent value="demand" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Demand by state · {formatMonthLabel(month)}
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadDemand}
                  disabled={!sortedDemand.length}
                >
                  <Download className="h-4 w-4 mr-1" />
                  CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {demandQ.isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading demand
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Monthly hours</TableHead>
                      <TableHead className="text-right">Weekly hours</TableHead>
                      <TableHead className="text-right">Daily slots</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDemand.map(r => (
                      <TableRow key={r.state}>
                        <TableCell className="font-medium">{r.state}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(r.monthly_hours_target).toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(Number(r.monthly_hours_target) / 4.33).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.daily_target_slots}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Provider decisions · {formatMonthLabel(month)}
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadDecisions}
                  disabled={!sortedDecisions.length}
                >
                  <Download className="h-4 w-4 mr-1" />
                  CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {decisionsQ.isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading decisions
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead className="text-right">Accepted</TableHead>
                      <TableHead className="text-right">Declined</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDecisions.map(r => (
                      <TableRow key={`${r.provider_name}-${r.submitted_at}`}>
                        <TableCell className="font-medium">{r.provider_name}</TableCell>
                        <TableCell>
                          <Badge variant={decisionVariant(r.decision_status)}>
                            {r.decision_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(r.accepted_hours ?? 0).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(r.declined_hours ?? 0).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-md whitespace-pre-wrap">
                          {r.decision_notes ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </SchedulingShell>
  );
}

function Kpi({
  label,
  value,
  sub,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
