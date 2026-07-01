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
  useMonthlyServiceLineDemand,
} from '@/hooks/useMonthlySchedulingForecast';
import { useStateCoverage } from '@/hooks/useStateCoverage';
import { downloadCSV } from '@/lib/utils';
import {
  AUGUST_2026_BUFFER_PCT,
  AUGUST_2026_STATE_TARGETS,
  AUGUST_2026_STATE_TARGET_BY_STATE,
  isAugust2026Month,
} from '@/lib/scheduling/august2026';

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

const weeksInMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() / 7;
};

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
  const serviceLineQ = useMonthlyServiceLineDemand(month);
  const decisionsQ = useMonthlyDecisions(month);
  const coverageQ = useStateCoverage(month);
  const { summary, loading } = useMonthlyForecastSummary(month);
  const isAugust = isAugust2026Month(month);

  const demandRows = demandQ.data;
  const decisionRows = decisionsQ.data;
  const acceptedByState = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of coverageQ.data?.rows ?? []) map.set(row.state, row.filled);
    return map;
  }, [coverageQ.data?.rows]);

  const sortedDemand = useMemo(
    () => {
      if (isAugust) {
        return AUGUST_2026_STATE_TARGETS.map(target => {
          const dbRow = (demandRows ?? []).find(row => row.state === target.state);
          return {
            ...(dbRow ?? {}),
            state: target.state,
            baseline_hours_target: dbRow?.baseline_hours_target ?? target.baselineHours,
            max_hours_target: dbRow?.max_hours_target ?? target.maxHours,
            monthly_hours_target: dbRow?.monthly_hours_target ?? target.maxHours,
            monthly_visits_target: dbRow?.monthly_visits_target ?? target.maxHours,
            inactive: dbRow?.inactive ?? target.inactive ?? false,
          };
        }).sort((a, b) => {
          const acceptedDiff = (acceptedByState.get(b.state) ?? 0) - (acceptedByState.get(a.state) ?? 0);
          if (acceptedDiff !== 0) return acceptedDiff;
          return Number(b.max_hours_target ?? b.monthly_hours_target ?? 0) -
            Number(a.max_hours_target ?? a.monthly_hours_target ?? 0);
        });
      }
      return [...(demandRows ?? [])].sort((a, b) => b.monthly_visits_target - a.monthly_visits_target);
    },
    [acceptedByState, demandRows, isAugust],
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
      sortedDemand.map(r => isAugust ? ({
        state: r.state,
        baseline_hours_month: Number(r.baseline_hours_target ?? 0).toFixed(1),
        max_hours_month: Number(r.max_hours_target ?? r.monthly_hours_target ?? 0).toFixed(1),
        accepted_hours: Number(acceptedByState.get(r.state) ?? 0).toFixed(1),
        status: augustDemandStatus({
          baseline: Number(r.baseline_hours_target ?? 0),
          max: Number(r.max_hours_target ?? r.monthly_hours_target ?? 0),
          accepted: Number(acceptedByState.get(r.state) ?? 0),
          inactive: Boolean(r.inactive),
        }).label,
        methodology: r.methodology_version ?? 'august_2026_trailing_actuals_state_max_v1',
      }) : ({
        state: r.state,
        active_members: r.active_members ?? '',
        metabase_raw_weekly: Number(r.raw_weekly_hours ?? 0).toFixed(1),
        adjusted_weekly_hours: Number(r.adjusted_weekly_hours ?? Number(r.monthly_hours_target) / weeksInMonth(month)).toFixed(1),
        monthly_hours_target: Number(r.monthly_hours_target).toFixed(1),
        daily_target_hours: Number(r.daily_target_hours ?? 0).toFixed(1),
        methodology: r.methodology_version ?? '',
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
          {isAugust
            ? `August uses per-state baseline/max demand from trailing April, May, and projected June actuals with a ${AUGUST_2026_BUFFER_PCT}% flat buffer. June 2026 remains estimated until actuals close.`
            : 'Demand values come from Metabase card 2974. July uses raw weekly demand × 0.95, then exact days in month / 7. Jotform submissions are the source of truth for provider-requested hours and schedule recommendations.'}
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Network demand hours"
          value={summary ? formatNumber(summary.totalDemandHours) : '—'}
          sub={summary ? `≈ ${(summary.totalDemandHours / weeksInMonth(month)).toFixed(0)} hrs/wk` : undefined}
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
                      {isAugust ? (
                        <>
                          <TableHead className="text-right" title="June 2026 estimated. Update when actuals close.">
                            Baseline hrs/mo*
                          </TableHead>
                          <TableHead className="text-right" title="Baseline plus flat August buffer. Scheduling engine targets this cap.">
                            Max hrs/mo*
                          </TableHead>
                          <TableHead className="text-right">Accepted hrs</TableHead>
                          <TableHead>Status</TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead className="text-right">Active members</TableHead>
                          <TableHead className="text-right">Metabase raw/wk</TableHead>
                          <TableHead className="text-right">Adjusted/wk</TableHead>
                          <TableHead className="text-right">Monthly hours</TableHead>
                          <TableHead className="text-right">Daily target</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDemand.map(r => {
                      if (isAugust) {
                        const baseline = Number(r.baseline_hours_target ?? AUGUST_2026_STATE_TARGET_BY_STATE.get(r.state)?.baselineHours ?? 0);
                        const max = Number(r.max_hours_target ?? AUGUST_2026_STATE_TARGET_BY_STATE.get(r.state)?.maxHours ?? r.monthly_hours_target ?? 0);
                        const accepted = Number(acceptedByState.get(r.state) ?? 0);
                        const status = augustDemandStatus({ baseline, max, accepted, inactive: Boolean(r.inactive) });
                        return (
                          <TableRow key={r.state} className={r.inactive ? 'bg-muted/40 text-muted-foreground' : undefined}>
                            <TableCell className="font-medium">
                              {r.state}
                              {r.inactive && <span className="ml-2 text-[11px] uppercase">inactive</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{baseline.toFixed(0)}</TableCell>
                            <TableCell className="text-right tabular-nums">{max.toFixed(0)}</TableCell>
                            <TableCell className="text-right tabular-nums">{accepted.toFixed(1)}</TableCell>
                            <TableCell>
                              <Badge className={status.className}>{status.label}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return (
                        <TableRow key={r.state}>
                          <TableCell className="font-medium">{r.state}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.active_members ?? '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(r.raw_weekly_hours ?? 0).toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(r.adjusted_weekly_hours ?? Number(r.monthly_hours_target) / weeksInMonth(month)).toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(r.monthly_hours_target).toFixed(0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(r.daily_target_hours ?? 0).toFixed(1)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!isAugust && (serviceLineQ.data ?? []).map(row => (
                      <TableRow key={row.service_line} className="bg-muted/30">
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{row.scope}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(row.raw_weekly_hours).toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(row.adjusted_weekly_hours).toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(row.monthly_hours_target).toFixed(0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(row.daily_target_hours).toFixed(1)}</TableCell>
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

function augustDemandStatus({
  baseline,
  max,
  accepted,
  inactive,
}: {
  baseline: number;
  max: number;
  accepted: number;
  inactive: boolean;
}) {
  if (inactive || max <= 0) {
    return {
      label: 'Inactive',
      className: 'bg-slate-100 text-slate-600 hover:bg-slate-100',
    };
  }
  if (accepted < baseline) {
    return {
      label: 'Below baseline',
      className: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
    };
  }
  if (accepted < max) {
    return {
      label: 'Baseline to max',
      className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
    };
  }
  return {
    label: 'At/above max',
    className: 'bg-red-100 text-red-700 hover:bg-red-100',
  };
}
