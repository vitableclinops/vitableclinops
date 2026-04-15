import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn, downloadCSV } from '@/lib/utils';
import {
  RefreshCw, AlertTriangle, CheckCircle2, XCircle, MinusCircle,
  Activity, Target, Download, CalendarDays,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type WeekStatus = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';

interface StateOpsRow {
  state: string;
  isActive: boolean;
  availableSlots: number | null;
  hasSlotData: boolean;
  slaTargetDaily: number | null;
  slaPct: number | null;
  weekStatus: WeekStatus;
  coverageRatio: number | null;
}

// ── Business logic ─────────────────────────────────────────────────────────────

/** SLA target: max(5, (weekly_demand / 5) × 1.5) */
function slaTargetFromVisits(weeklyVisits: number): number {
  return Math.max(5, (weeklyVisits / 5) * 1.5);
}

function computeWeekStatus(available: number | null, hasData: boolean, target: number | null): WeekStatus {
  if (!hasData) return 'no_data';
  if (available === null || available === 0) return 'zero';
  const t = target ?? 10;   // default threshold when no forecast loaded
  if (available >= t) return 'ok';
  if (available >= t * 0.5) return 'low';
  return 'critical';
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── Data hook ─────────────────────────────────────────────────────────────────

function useOpsData(date: string) {
  return useQuery({
    queryKey: ['ops_dashboard', date],
    queryFn: async (): Promise<StateOpsRow[]> => {
      const weekStart = getMonday(date);

      const [activationsRes, slotsRes, slaRes, forecastRes] = await Promise.all([
        supabase.from('state_activation').select('state_abbreviation, is_active'),
        supabase
          .from('state_leftover_slots')
          .select('state_abbreviation, unfilled_slots')
          .eq('slot_date', date)
          .eq('window_type', 'historical'),
        supabase
          .from('state_sla_attainment')
          .select('state_abbreviation, sla_pct, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('demand_forecast')
          .select('state_abbreviation, projected_visits')
          .eq('week_start', weekStart),
      ]);

      const activations = activationsRes.data ?? [];

      const slotsByState = new Map<string, number>(
        (slotsRes.data ?? []).map((r) => [r.state_abbreviation, r.unfilled_slots])
      );

      // Use most-recent SLA attainment per state (ordered by created_at desc)
      const slaByState = new Map<string, number>();
      for (const r of slaRes.data ?? []) {
        if (!slaByState.has(r.state_abbreviation)) {
          slaByState.set(r.state_abbreviation, Number(r.sla_pct));
        }
      }

      const forecastByState = new Map<string, number>(
        (forecastRes.data ?? []).map((r) => [r.state_abbreviation, r.projected_visits])
      );

      return activations.map((a) => {
        const state = a.state_abbreviation;
        const hasSlotData = slotsByState.has(state);
        const available = hasSlotData ? slotsByState.get(state)! : null;
        const visits = forecastByState.get(state) ?? null;
        const slaTarget = visits !== null ? slaTargetFromVisits(visits) : null;
        const slaPct = slaByState.get(state) ?? null;
        const coverageRatio =
          slaTarget !== null && available !== null ? available / slaTarget : null;
        return {
          state,
          isActive: a.is_active,
          availableSlots: available,
          hasSlotData,
          slaTargetDaily: slaTarget !== null ? Math.round(slaTarget) : null,
          slaPct,
          weekStatus: computeWeekStatus(available, hasSlotData, slaTarget),
          coverageRatio,
        };
      });
    },
    staleTime: 5 * 60_000,
  });
}

function useWeekSlots(weekStart: string, activeStates: Set<string>) {
  // Build the 7 dates Mon–Sun for the given weekStart
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  return useQuery({
    queryKey: ['ops_week_slots', weekStart],
    enabled: activeStates.size > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('state_leftover_slots')
        .select('state_abbreviation, slot_date, unfilled_slots')
        .in('slot_date', dates)
        .eq('window_type', 'historical');
      if (error) throw error;
      // Map: state → date → slots
      const m = new Map<string, Map<string, number>>();
      for (const r of data ?? []) {
        if (!m.has(r.state_abbreviation)) m.set(r.state_abbreviation, new Map());
        m.get(r.state_abbreviation)!.set(r.slot_date, r.unfilled_slots);
      }
      return { dates, slotMap: m };
    },
    staleTime: 5 * 60_000,
  });
}

function useLastSlotImport() {
  return useQuery({
    queryKey: ['last_slot_import'],
    queryFn: async () => {
      const { data } = await supabase
        .from('state_leftover_slots')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      return data?.created_at ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

const SLA_LINE_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

function useSlaTrend(activeStates: Set<string>) {
  return useQuery({
    queryKey: ['sla_trend', [...activeStates].sort().join(',')],
    enabled: activeStates.size > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('state_sla_attainment')
        .select('state_abbreviation, sla_pct, created_at, window_label')
        .in('state_abbreviation', [...activeStates])
        .order('created_at', { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as { state_abbreviation: string; sla_pct: number; created_at: string; window_label: string | null }[];
    },
    staleTime: 5 * 60_000,
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WeekStatus }) {
  switch (status) {
    case 'ok':       return <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">OK</Badge>;
    case 'low':      return <Badge className="bg-yellow-500 text-white hover:bg-yellow-500">LOW</Badge>;
    case 'critical': return <Badge className="bg-orange-500 text-white hover:bg-orange-500">CRITICAL</Badge>;
    case 'zero':     return <Badge variant="destructive">ZERO</Badge>;
    case 'no_data':  return <Badge variant="outline" className="text-muted-foreground">NO DATA</Badge>;
  }
}

function StatusIcon({ status }: { status: WeekStatus }) {
  switch (status) {
    case 'ok':       return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    case 'low':      return <MinusCircle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case 'critical': return <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />;
    case 'zero':     return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    case 'no_data':  return <MinusCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function KpiCard({
  title, value, sub, color, icon: Icon,
}: {
  title: string; value: string | number; sub?: string;
  color: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={cn('rounded-lg p-2', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<WeekStatus, number> = { zero: 0, critical: 1, low: 2, ok: 3, no_data: 4 };

export default function OpsDashboardPage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const isAdmin = roles.includes('admin');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [filterState, setFilterState] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showWeekView, setShowWeekView] = useState(false);

  const { data: rows = [], isLoading, refetch, isRefetching } = useOpsData(selectedDate);
  const { data: lastImportedAt } = useLastSlotImport();

  const weekStart = getMonday(selectedDate);
  const activeStateSet = useMemo(
    () => new Set(rows.filter((r) => r.isActive).map((r) => r.state)),
    [rows]
  );
  const slaTargetMap = useMemo(
    () => new Map(rows.map((r) => [r.state, r.slaTargetDaily])),
    [rows]
  );
  const { data: weekData } = useWeekSlots(weekStart, activeStateSet);
  const { data: slaTrendRaw = [] } = useSlaTrend(activeStateSet);

  // Build SLA trend chart data: last 10 distinct dates × bottom-10 SLA states
  const { slaTrendData, slaTrendStates } = useMemo(() => {
    if (!slaTrendRaw.length) return { slaTrendData: [], slaTrendStates: [] };

    // Group by label (window_label if set, else YYYY-MM-DD from created_at)
    const labelFor = (r: typeof slaTrendRaw[0]) =>
      r.window_label ?? r.created_at.slice(0, 10);

    const allLabels = [...new Set(slaTrendRaw.map(labelFor))].sort();
    const last10 = allLabels.slice(-10);

    // Average SLA per state across all data (to pick bottom 10)
    const stateSums = new Map<string, { sum: number; count: number }>();
    for (const r of slaTrendRaw) {
      const e = stateSums.get(r.state_abbreviation) ?? { sum: 0, count: 0 };
      e.sum += r.sla_pct; e.count += 1;
      stateSums.set(r.state_abbreviation, e);
    }
    const bottomStates = [...stateSums.entries()]
      .filter(([, v]) => v.count >= 2)
      .map(([state, v]) => ({ state, avg: v.sum / v.count }))
      .sort((a, b) => a.avg - b.avg)   // ascending → worst first
      .slice(0, 10)
      .map((e) => e.state);

    // Build chart rows
    const trendData = last10.map((label) => {
      const entry: Record<string, any> = { label };
      for (const r of slaTrendRaw) {
        if (labelFor(r) === label && bottomStates.includes(r.state_abbreviation)) {
          entry[r.state_abbreviation] = Math.round(r.sla_pct * 10) / 10;
        }
      }
      return entry;
    });

    return { slaTrendData: trendData, slaTrendStates: bottomStates };
  }, [slaTrendRaw]);

  const toggleActivation = useMutation({
    mutationFn: async ({ state, isActive }: { state: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('state_activation')
        .upsert({ state_abbreviation: state, is_active: isActive }, { onConflict: 'state_abbreviation' });
      if (error) throw error;
    },
    onSuccess: (_, { state, isActive }) => {
      queryClient.invalidateQueries({ queryKey: ['ops_dashboard'] });
      toast({
        title: `${state} ${isActive ? 'activated' : 'deactivated'}`,
        description: isActive ? 'State is now visible in ops tracking.' : 'State hidden from active ops view.',
      });
    },
    onError: (e: Error) => toast({ title: 'Toggle failed', description: e.message, variant: 'destructive' }),
  });

  const filtered = useMemo(() => {
    let r = showAll ? rows : rows.filter((x) => x.isActive);
    if (filterState) r = r.filter((x) => x.state.toLowerCase().includes(filterState.toLowerCase()));
    return [...r].sort((a, b) => STATUS_ORDER[a.weekStatus] - STATUS_ORDER[b.weekStatus]);
  }, [rows, showAll, filterState]);

  const kpis = useMemo(() => {
    const active = rows.filter((r) => r.isActive);
    return {
      total: active.length,
      ok: active.filter((r) => r.weekStatus === 'ok').length,
      low: active.filter((r) => r.weekStatus === 'low').length,
      critical: active.filter((r) => r.weekStatus === 'critical').length,
      zero: active.filter((r) => r.weekStatus === 'zero').length,
      noData: active.filter((r) => r.weekStatus === 'no_data').length,
    };
  }, [rows]);

  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

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
              <h1 className="text-2xl font-bold">Ops Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Daily state-level coverage and SLA status
                {lastImportedAt && (
                  <span className="ml-2 text-xs">
                    · slot data imported {new Date(lastImportedAt).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-40"
              />
              <Button variant="outline" size="sm" onClick={() => setSelectedDate(today)}>
                Today
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
              </Button>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const abbr = prompt('State abbreviation to add (e.g. TX):')?.toUpperCase().trim();
                    if (!abbr || abbr.length !== 2) return;
                    toggleActivation.mutate({ state: abbr, isActive: true });
                  }}
                >
                  + Add State
                </Button>
              )}
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard title="Active States" value={kpis.total}    icon={Activity}      color="bg-primary" />
            <KpiCard title="Coverage OK"   value={kpis.ok}       icon={CheckCircle2}  color="bg-emerald-500" />
            <KpiCard title="Low"           value={kpis.low}      icon={MinusCircle}   color="bg-yellow-500" />
            <KpiCard title="Critical"      value={kpis.critical} icon={AlertTriangle} color="bg-orange-500" />
            <KpiCard title="Zero"          value={kpis.zero}     icon={XCircle}       color="bg-destructive" />
            <KpiCard title="No Data"       value={kpis.noData}   icon={MinusCircle}   color="bg-muted-foreground" />
          </div>

          {/* Filter row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Tabs value={showAll ? 'all' : 'active'} onValueChange={(v) => setShowAll(v === 'all')}>
              <TabsList>
                <TabsTrigger value="active">Active States</TabsTrigger>
                <TabsTrigger value="all">All States</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input
              placeholder="Filter by state…"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              className="max-w-48"
            />
            <span className="text-xs text-muted-foreground hidden sm:block">
              {filtered.length} state{filtered.length !== 1 ? 's' : ''}
            </span>
            <Button
              variant={showWeekView ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5"
              onClick={() => setShowWeekView((v) => !v)}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Week View
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={() =>
                downloadCSV(
                  filtered.map((r) => ({
                    state: r.state,
                    is_active: r.isActive,
                    available_slots: r.availableSlots ?? '',
                    sla_target_daily: r.slaTargetDaily ?? '',
                    coverage_pct: r.coverageRatio != null
                      ? `${(r.coverageRatio * 100).toFixed(0)}%` : '',
                    sla_pct: r.slaPct != null ? `${r.slaPct.toFixed(1)}%` : '',
                    status: r.weekStatus,
                  })),
                  `ops-coverage-${selectedDate}.csv`
                )
              }
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>

          {/* State coverage table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">State Coverage — {displayDate}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-muted-foreground">No data for this date.</p>
                  <p className="text-sm text-muted-foreground">
                    Upload a Metabase leftover-slots CSV in{' '}
                    <a href="/admin/settings?tab=import" className="underline text-primary hover:opacity-80">
                      Settings → Slot Data
                    </a>
                    , or activate states in{' '}
                    <a href="/admin/states" className="underline text-primary hover:opacity-80">
                      States & Compliance
                    </a>.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">State</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Available Slots</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">SLA Target</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Coverage</th>
                        <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">SLA %</th>
                        <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Status</th>
                        {isAdmin && (
                          <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Active</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr
                          key={row.state}
                          className={cn(
                            'border-b transition-colors hover:bg-muted/30',
                            row.weekStatus === 'zero'     && 'bg-destructive/5',
                            row.weekStatus === 'critical' && 'bg-orange-50 dark:bg-orange-950/20',
                            row.weekStatus === 'low'      && 'bg-yellow-50 dark:bg-yellow-950/20',
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <StatusIcon status={row.weekStatus} />
                              <span className="font-semibold">{row.state}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {row.availableSlots ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                            {row.slaTargetDaily ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {row.coverageRatio !== null
                              ? `${(row.coverageRatio * 100).toFixed(0)}%`
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {row.slaPct !== null ? `${row.slaPct.toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <StatusBadge status={row.weekStatus} />
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-2.5 text-center">
                              <Switch
                                checked={row.isActive}
                                onCheckedChange={(checked) =>
                                  toggleActivation.mutate({ state: row.state, isActive: checked })
                                }
                                disabled={toggleActivation.isPending}
                                aria-label={`Toggle ${row.state} activation`}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Week-level slot heatmap */}
          {showWeekView && weekData && weekData.slotMap.size > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  Week Coverage Heatmap
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {weekStart} – {weekData.dates[6]}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">State</th>
                        {weekData.dates.map((d) => (
                          <th key={d} className="px-2 py-2 text-center font-medium text-muted-foreground">
                            {new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                            <div className="text-[10px] font-normal">{d.slice(5)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...weekData.slotMap.entries()]
                        .filter(([state]) => activeStateSet.has(state))
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([state, dayMap]) => {
                          const target = slaTargetMap.get(state) ?? null;
                          return (
                            <tr key={state} className="border-b">
                              <td className="px-3 py-1.5 font-semibold">{state}</td>
                              {weekData.dates.map((d) => {
                                const slots = dayMap.get(d) ?? null;
                                const ratio = slots != null && target != null && target > 0
                                  ? slots / target : null;
                                return (
                                  <td key={d} className="px-1 py-1 text-center">
                                    <div
                                      className={cn(
                                        'mx-auto rounded px-1.5 py-0.5 font-mono text-[11px] min-w-[28px]',
                                        slots == null
                                          ? 'text-muted-foreground bg-muted/30'
                                          : ratio == null
                                            ? 'bg-muted/30 text-foreground'
                                            : ratio >= 1
                                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                              : ratio >= 0.5
                                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300'
                                                : 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
                                      )}
                                      title={slots != null ? `${slots} slots${target != null ? ` / ${target} target` : ''}` : 'No data'}
                                    >
                                      {slots ?? '—'}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground px-4 pb-3 pt-2">
                  Green = at/above target · Yellow = 50–99% · Red = below 50% · — = no data
                </p>
              </CardContent>
            </Card>
          )}

          {/* SLA trend chart */}
          {slaTrendData.length > 1 && slaTrendStates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  SLA Attainment Trend
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    lowest-performing active states · last {slaTrendData.length} snapshots
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={slaTrendData}
                    margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={80} stroke="#10b981" strokeDasharray="4 2" label={{ value: '80%', fontSize: 10 }} />
                    <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '60%', fontSize: 10 }} />
                    {slaTrendStates.map((st, i) => (
                      <Line
                        key={st}
                        type="monotone"
                        dataKey={st}
                        stroke={SLA_LINE_COLORS[i % SLA_LINE_COLORS.length]}
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

          {/* SLA attainment heat grid */}
          {rows.some((r) => r.slaPct !== null) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  SLA Attainment by State
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                  {rows
                    .filter((r) => r.isActive && r.slaPct !== null)
                    .sort((a, b) => (a.slaPct ?? 0) - (b.slaPct ?? 0))
                    .map((r) => (
                      <div
                        key={r.state}
                        className={cn(
                          'rounded-lg p-2 text-center border',
                          (r.slaPct ?? 0) >= 80
                            ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20'
                            : (r.slaPct ?? 0) >= 60
                              ? 'border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20'
                              : 'border-red-200 bg-red-50 dark:bg-red-950/20',
                        )}
                      >
                        <div className="text-xs font-bold">{r.state}</div>
                        <div className="text-sm font-mono font-semibold">
                          {r.slaPct?.toFixed(0)}%
                        </div>
                      </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Green ≥ 80% · Yellow 60–79% · Red &lt; 60%
                </p>
              </CardContent>
            </Card>
          )}

        </div>
      </main>
    </div>
  );
}
