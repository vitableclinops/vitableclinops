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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn, downloadCSV, formatLocalDate, parseLocalDate } from '@/lib/utils';
import {
  RefreshCw, AlertTriangle, CheckCircle2, XCircle, MinusCircle,
  Activity, Target, Download, CalendarDays, Plus, Info, ChevronDown, Zap,
} from 'lucide-react';
import { QuickTaskDialog, QuickTaskTarget } from '@/components/admin/QuickTaskDialog';
import { useProviderCoverage } from '@/hooks/useProviderCoverage';
import { ProviderCoverageTable } from '@/components/ops/ProviderCoverageTable';

// ── Types ─────────────────────────────────────────────────────────────────────

type WeekStatus = 'ok' | 'low' | 'critical' | 'zero' | 'no_data';
type SlotSource = 'historical' | 'forecast' | null;

interface StateOpsRow {
  state: string;
  isActive: boolean;
  availableSlots: number | null;
  hasSlotData: boolean;
  slotSource: SlotSource;
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
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatLocalDate(d);
}

// ── Data hook ─────────────────────────────────────────────────────────────────

function useOpsData(date: string) {
  return useQuery({
    queryKey: ['ops_dashboard', date],
    queryFn: async (): Promise<StateOpsRow[]> => {
      const weekStart = getMonday(date);

      const [activationsRes, slotsRes, slaRes, forecastRes] = await Promise.all([
        supabase.from('state_activation').select('state_abbreviation, is_active'),
        // Query both historical (Metabase) and forecast (Homebase-derived); prefer historical
        supabase
          .from('state_leftover_slots')
          .select('state_abbreviation, unfilled_slots, window_type')
          .eq('slot_date', date)
          .in('window_type', ['historical', 'forecast']),
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

      // Prefer historical (Metabase) over forecast (Homebase) for same state/date
      const slotsByState = new Map<string, { slots: number; source: SlotSource }>();
      for (const r of slotsRes.data ?? []) {
        const existing = slotsByState.get(r.state_abbreviation);
        if (!existing || existing.source === 'forecast') {
          slotsByState.set(r.state_abbreviation, {
            slots: r.unfilled_slots,
            source: r.window_type as SlotSource,
          });
        }
      }

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
        const slotEntry = slotsByState.get(state) ?? null;
        const hasSlotData = slotEntry !== null;
        const available = slotEntry?.slots ?? null;
        const slotSource = slotEntry?.source ?? null;
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
          slotSource,
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
    const d = parseLocalDate(weekStart);
    d.setDate(d.getDate() + i);
    return formatLocalDate(d);
  });

  return useQuery({
    queryKey: ['ops_week_slots', weekStart],
    enabled: activeStates.size > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('state_leftover_slots')
        .select('state_abbreviation, slot_date, unfilled_slots, window_type')
        .in('slot_date', dates)
        .in('window_type', ['historical', 'forecast']);
      if (error) throw error;
      // Map: state → date → { slots, source }; prefer historical over forecast
      const m = new Map<string, Map<string, { slots: number; source: SlotSource }>>();
      for (const r of data ?? []) {
        if (!m.has(r.state_abbreviation)) m.set(r.state_abbreviation, new Map());
        const dayMap = m.get(r.state_abbreviation)!;
        const existing = dayMap.get(r.slot_date);
        if (!existing || existing.source === 'forecast') {
          dayMap.set(r.slot_date, { slots: r.unfilled_slots, source: r.window_type as SlotSource });
        }
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

  const today = formatLocalDate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [filterState, setFilterState] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showWeekView, setShowWeekView] = useState(false);
  const [quickTaskTarget, setQuickTaskTarget] = useState<QuickTaskTarget | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [viewMode, setViewMode] = useState<'by_state' | 'by_provider'>('by_state');

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
  const { data: providerCoverage = [], isLoading: isLoadingProviders } = useProviderCoverage(selectedDate);

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

  const refreshAvailability = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('compute-availability-slots', {
        body: { days_back: 14, days_ahead: 14 },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops_dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['ops_week_slots'] });
      toast({ title: 'Availability refreshed', description: 'Homebase forecast slots updated from latest shifts.' });
    },
    onError: (e: Error) => toast({ title: 'Refresh failed', description: e.message, variant: 'destructive' }),
  });

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
                    · Metabase data imported {new Date(lastImportedAt).toLocaleString()}
                  </span>
                )}
                <span className="ml-2 text-xs inline-flex items-center gap-1">
                  · <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 text-[10px] font-medium"><Zap className="h-2.5 w-2.5" />HB</span> = Homebase forecast
                </span>
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
              <Button variant="outline" size="sm" onClick={() => {
                const d = parseLocalDate(today);
                d.setDate(d.getDate() + 1);
                setSelectedDate(formatLocalDate(d));
              }}>
                Tomorrow
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
              </Button>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => refreshAvailability.mutate()}
                  disabled={refreshAvailability.isPending}
                  title="Re-derive forecast slots from current Homebase shifts"
                >
                  <Zap className={cn('h-3.5 w-3.5', refreshAvailability.isPending && 'animate-pulse')} />
                  {refreshAvailability.isPending ? 'Refreshing…' : 'Refresh Availability'}
                </Button>
              )}
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

          {/* Setup guide */}
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
                  <p className="font-semibold text-foreground">Getting data into Coverage Hub — 3 steps:</p>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">Export from Metabase</span>
                      {' '}— run the <em>same-day / next-day leftover slots</em> question and download as CSV.
                      The file needs columns: <code className="bg-muted px-1 rounded text-xs">State</code>,{' '}
                      <code className="bg-muted px-1 rounded text-xs">Day</code>,{' '}
                      <code className="bg-muted px-1 rounded text-xs">Sum of same_next_day_available_slots</code>.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Upload in Settings</span>
                      {' '}—{' '}
                      <a href="/admin/settings?tab=import" className="underline text-primary">
                        Settings → Data Import → Slot Data
                      </a>
                      . Select <em>Historical</em> window type, pick your file, click Import.
                      The timestamp in the header updates when data lands.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Activate states</span>
                      {' '}— first time only: click <strong>+ Add State</strong> (or toggle the Active switch) for each state you cover.
                      States default to inactive so they don't appear until you enable them.
                    </li>
                  </ol>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Optional — SLA %:</span>
                    {' '}Upload the SLA attainment CSV (same Settings page → SLA Data tab) to populate the SLA % column and trend chart.
                    Columns needed: <code className="bg-muted px-1 rounded text-xs">State</code>,{' '}
                    <code className="bg-muted px-1 rounded text-xs">SLA Attainment Rate</code>.
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Daily workflow:</span>
                    {' '}Download fresh CSVs from Metabase each morning → upload → come back here → check <strong>Today</strong> using the Today button, then switch to <strong>Tomorrow</strong> to see next-day availability
                    → hit <strong>+ Task</strong> on any ZERO or CRITICAL state → tasks appear in the Admin Dashboard task queue.
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Status thresholds explained:</span>
                    {' '}OK = available slots ≥ SLA target · LOW = 50–99% of target · CRITICAL = {'<'} 50% · ZERO = no slots at all · NO DATA = CSV not yet uploaded for this date.
                    SLA target = <code className="bg-muted px-1 rounded text-xs">max(5, weekly_visits / 5 × 1.5)</code> daily slots.
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">For leadership / SLA reporting:</span>
                    {' '}The SLA Attainment heatmap (bottom of page) gives the snapshot view for executive reporting — green = ≥ 80%, yellow = 60–79%, red = {'<'} 60%. The trend chart shows lowest-performing states over time. Export the full table for board decks. Upload SLA attainment CSVs weekly to keep the trend current.
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Coverage vs. cost:</span>
                    {' '}A state consistently at ZERO or CRITICAL has both an SLA problem and a revenue problem — missed same/next-day visits are lost visits. A state at SURPLUS may indicate over-staffing relative to demand. Cross-reference with the <a href="/admin/matching" className="underline text-primary">Demand Matching Engine</a> to right-size.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

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
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'by_state' | 'by_provider')}>
              <TabsList>
                <TabsTrigger value="by_state">By State</TabsTrigger>
                <TabsTrigger value="by_provider">By Provider</TabsTrigger>
              </TabsList>
            </Tabs>
            {viewMode === 'by_state' && (
              <Tabs value={showAll ? 'all' : 'active'} onValueChange={(v) => setShowAll(v === 'all')}>
                <TabsList>
                  <TabsTrigger value="active">Active States</TabsTrigger>
                  <TabsTrigger value="all">All States</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            {viewMode === 'by_state' && (
              <Input
                placeholder="Filter by state…"
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="max-w-48"
              />
            )}
            {viewMode === 'by_state' && (
              <>
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
                        slot_data_source: r.slotSource ?? 'no_data',
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
              </>
            )}
          </div>

          {/* Provider coverage view */}
          {viewMode === 'by_provider' && (
            <ProviderCoverageTable
              data={providerCoverage}
              isLoading={isLoadingProviders}
              selectedDate={selectedDate}
            />
          )}

          {/* State coverage table */}
          {viewMode === 'by_state' && (
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
                        <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Action</th>
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
                            <div className="flex items-center justify-end gap-1.5">
                              {row.availableSlots ?? <span className="text-muted-foreground">—</span>}
                              {row.slotSource === 'forecast' && (
                                <span
                                  title="Homebase forecast — projected from scheduled shifts. Upload Metabase CSV to replace with actuals."
                                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                                >
                                  <Zap className="h-2.5 w-2.5" />
                                  HB
                                </span>
                              )}
                            </div>
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
                          <td className="px-4 py-2.5 text-center">
                            <Button
                              variant={
                                row.weekStatus === 'zero' || row.weekStatus === 'critical'
                                  ? 'destructive'
                                  : row.weekStatus === 'low'
                                  ? 'default'
                                  : 'ghost'
                              }
                              size="sm"
                              className="h-7 px-2 gap-1 text-xs"
                              onClick={() =>
                                setQuickTaskTarget({
                                  state: row.state,
                                  status: row.weekStatus,
                                  slotsToday: row.availableSlots,
                                  slaTarget: row.slaTargetDaily,
                                })
                              }
                            >
                              <Plus className="h-3 w-3" />
                              Task
                            </Button>
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
          )}

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
                                const entry = dayMap.get(d) ?? null;
                                const slots = entry?.slots ?? null;
                                const isForecast = entry?.source === 'forecast';
                                const ratio = slots != null && target != null && target > 0
                                  ? slots / target : null;
                                return (
                                  <td key={d} className="px-1 py-1 text-center">
                                    <div
                                      className={cn(
                                        'mx-auto rounded px-1.5 py-0.5 font-mono text-[11px] min-w-[28px]',
                                        isForecast && 'ring-1 ring-blue-300 dark:ring-blue-700',
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
                                      title={
                                        slots != null
                                          ? `${slots} slots${target != null ? ` / ${target} target` : ''}${isForecast ? ' (Homebase forecast)' : ''}`
                                          : 'No data'
                                      }
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
                  Green = at/above target · Yellow = 50–99% · Red = below 50% · — = no data · Blue outline = Homebase forecast (upload Metabase CSV to replace)
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

      <QuickTaskDialog
        open={quickTaskTarget !== null}
        onClose={() => setQuickTaskTarget(null)}
        onSuccess={() => {
          setQuickTaskTarget(null);
          toast({ title: 'Task queued', description: 'Coverage task added to the task queue.' });
        }}
        target={quickTaskTarget}
        date={selectedDate}
      />
    </div>
  );
}
