import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, downloadCSV, formatDisplayDate } from '@/lib/utils';
import { Zap, RefreshCw, Save, Loader2, ChevronDown, ChevronRight, Download, Info } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useToast } from '@/hooks/use-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Assignment {
  providerName: string;
  profileId: string;
  primaryStates: string[];
  overflowStates: string[];
  totalHours: number;
  allocatedHours: number;
}

interface StateResult {
  state: string;
  demandHours: number;
  supplyHours: number;
  status: 'SURPLUS' | 'BALANCED' | 'DEFICIT';
  coverageRatio: number;
}

interface MatchingResult {
  weekStart: string;
  assignments: Assignment[];
  stateResults: StateResult[];
  totalDemandHours: number;
  totalSupplyHours: number;
  surplusHours: number;
  gapHours: number;
  deactivateCandidates: string[];
}

// ── Business logic ─────────────────────────────────────────────────────────────

/** hours_needed = weekly_visits × 0.5h × 1.5 buffer */
function demandHours(visits: number) {
  return visits * 0.75;
}

function getMonday(offsetWeeks = 0): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offsetWeeks * 7);
  return d.toISOString().slice(0, 10);
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useForecast(weekStart: string) {
  return useQuery({
    queryKey: ['demand_forecast_week', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('demand_forecast')
        .select('state_abbreviation, projected_visits')
        .eq('week_start', weekStart);
      if (error) throw error;
      return new Map<string, number>(
        (data ?? []).map((r: any) => [r.state_abbreviation, r.projected_visits])
      );
    },
    staleTime: 5 * 60_000,
  });
}

function useProviderShifts(weekStart: string) {
  const weekEnd = (() => {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  return useQuery({
    queryKey: ['homebase_shifts_week', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('homebase_shifts')
        .select('homebase_employee_id, scheduled_hours')
        .gte('start_at', weekStart + 'T00:00:00')
        .lte('start_at', weekEnd + 'T23:59:59')
        .not('scheduled_hours', 'is', null);
      if (error) throw error;
      // Sum hours per homebase_employee_id
      const map = new Map<string, number>();
      for (const s of data ?? []) {
        map.set(s.homebase_employee_id, (map.get(s.homebase_employee_id) ?? 0) + Number(s.scheduled_hours));
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });
}

function useEmployeeProfiles() {
  return useQuery({
    queryKey: ['homebase_employees_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('homebase_employees')
        .select('id, profile_id, first_name, last_name, normalized_name')
        .not('profile_id', 'is', null);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 10 * 60_000,
  });
}

function useProviderActiveStates() {
  return useQuery({
    queryKey: ['provider_active_states'],
    queryFn: async () => {
      // Use recent snapshots to determine which states each provider routes to
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      const { data, error } = await supabase
        .from('license_optimization_snapshots')
        .select('profile_id, state_abbreviation')
        .gte('snapshot_date', cutoff.toISOString().slice(0, 10))
        .neq('quadrant', 'ANOMALY');
      if (error) throw error;
      const map = new Map<string, Set<string>>();
      for (const r of data ?? []) {
        if (!map.has(r.profile_id)) map.set(r.profile_id, new Set());
        map.get(r.profile_id)!.add(r.state_abbreviation);
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });
}

function useProfileNames() {
  return useQuery({
    queryKey: ['profile_names'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name');
      if (error) throw error;
      return new Map<string, string>(
        (data ?? []).map((p: any) => [
          p.id,
          p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.id.slice(0, 8),
        ])
      );
    },
    staleTime: 10 * 60_000,
  });
}

function useRunHistory() {
  return useQuery({
    queryKey: ['matching_engine_runs_history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matching_engine_runs')
        .select('id, week_start, surplus_hours, gap_hours, states_deactivated, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

function useRunDetail(runId: string | null) {
  return useQuery({
    queryKey: ['matching_run_detail', runId],
    enabled: !!runId,
    queryFn: async () => {
      const [assignmentsRes, profilesRes] = await Promise.all([
        supabase
          .from('matching_assignments')
          .select('profile_id, state_abbreviation, assignment_type, assigned_hours')
          .eq('run_id', runId!),
        supabase
          .from('profiles')
          .select('id, full_name, credentials'),
      ]);
      if (assignmentsRes.error) throw assignmentsRes.error;
      const nameMap = new Map<string, string>(
        (profilesRes.data ?? []).map((p: any) => [p.id, `${p.full_name ?? '—'} (${p.credentials ?? ''})`])
      );
      const assignments = (assignmentsRes.data ?? []).map((a: any) => ({
        ...a,
        providerName: nameMap.get(a.profile_id) ?? a.profile_id.slice(0, 8),
      }));
      // Group by state for the state summary
      const byState = new Map<string, { primary: string[]; overflow: string[]; hours: number }>();
      for (const a of assignments) {
        if (!byState.has(a.state_abbreviation)) {
          byState.set(a.state_abbreviation, { primary: [], overflow: [], hours: 0 });
        }
        const entry = byState.get(a.state_abbreviation)!;
        entry.hours += Number(a.assigned_hours ?? 0);
        if (a.assignment_type === 'primary') entry.primary.push(a.providerName);
        else entry.overflow.push(a.providerName);
      }
      return { assignments, byState };
    },
    staleTime: 5 * 60_000,
  });
}

// ── Matching algorithm ────────────────────────────────────────────────────────

function runMatching(
  weekStart: string,
  forecast: Map<string, number>,
  shiftsMap: Map<string, number>,               // homebase_employee_id → hours
  employees: any[],                             // homebase_employees rows
  providerStates: Map<string, Set<string>>,     // profile_id → licensed states
  profileNames: Map<string, string>,
): MatchingResult {
  // Build profile_id → total scheduled hours for the week
  const employeeById = new Map<string, any>(employees.map((e) => [e.id, e]));
  const profileHours = new Map<string, number>();
  for (const [empId, hrs] of shiftsMap) {
    const emp = employeeById.get(empId);
    if (emp?.profile_id) {
      profileHours.set(emp.profile_id, (profileHours.get(emp.profile_id) ?? 0) + hrs);
    }
  }

  // State demand in hours
  const stateDemand = new Map<string, number>();
  for (const [state, visits] of forecast) {
    stateDemand.set(state, demandHours(visits));
  }

  // Greedy matching: for each provider, allocate hours to most-deficit states first
  const stateSupply = new Map<string, number>(
    [...stateDemand.keys()].map((s) => [s, 0])
  );
  const assignments: Assignment[] = [];

  for (const [profileId, totalHours] of profileHours) {
    const states = [...(providerStates.get(profileId) ?? new Set())].filter((s) =>
      stateDemand.has(s)
    );
    if (!states.length) continue;

    // Sort states by coverage ratio ascending (most needed first)
    const sorted = [...states].sort((a, b) => {
      const aRatio = (stateSupply.get(a) ?? 0) / (stateDemand.get(a) ?? 1);
      const bRatio = (stateSupply.get(b) ?? 0) / (stateDemand.get(b) ?? 1);
      return aRatio - bRatio;
    });

    const hoursPerState = totalHours / sorted.length;
    const primary = sorted.slice(0, Math.ceil(sorted.length / 2));
    const overflow = sorted.slice(Math.ceil(sorted.length / 2));

    for (const state of sorted) {
      stateSupply.set(state, (stateSupply.get(state) ?? 0) + hoursPerState);
    }

    assignments.push({
      providerName: profileNames.get(profileId) ?? profileId.slice(0, 8),
      profileId,
      primaryStates: primary,
      overflowStates: overflow,
      totalHours,
      allocatedHours: hoursPerState * sorted.length,
    });
  }

  // State results
  const stateResults: StateResult[] = [...stateDemand.entries()].map(([state, demand]) => {
    const supply = stateSupply.get(state) ?? 0;
    const ratio = demand > 0 ? supply / demand : 0;
    return {
      state,
      demandHours: demand,
      supplyHours: supply,
      status: (ratio >= 1.3 ? 'SURPLUS' : ratio >= 0.8 ? 'BALANCED' : 'DEFICIT') as 'SURPLUS' | 'BALANCED' | 'DEFICIT',
      coverageRatio: ratio,
    };
  }).sort((a, b) => a.coverageRatio - b.coverageRatio);

  const totalDemand = [...stateDemand.values()].reduce((s, v) => s + v, 0);
  const totalSupply = [...stateSupply.values()].reduce((s, v) => s + v, 0);

  return {
    weekStart,
    assignments: assignments.sort((a, b) => b.totalHours - a.totalHours),
    stateResults,
    totalDemandHours: totalDemand,
    totalSupplyHours: totalSupply,
    surplusHours: Math.max(0, totalSupply - totalDemand),
    gapHours: Math.max(0, totalDemand - totalSupply),
    deactivateCandidates: stateResults
      .filter((s) => s.status === 'SURPLUS')
      .map((s) => s.state),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StateResult['status'] }) {
  switch (status) {
    case 'SURPLUS':  return <Badge className="bg-blue-500 text-white hover:bg-blue-500">SURPLUS</Badge>;
    case 'BALANCED': return <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">BALANCED</Badge>;
    case 'DEFICIT':  return <Badge variant="destructive">DEFICIT</Badge>;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DemandMatchingEnginePage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => getMonday(weekOffset), [weekOffset]);
  const [showGuide, setShowGuide] = useState(false);

  const { data: forecast = new Map(), isLoading: loadingForecast, refetch } = useForecast(weekStart);
  const { data: shifts = new Map(), isLoading: loadingShifts } = useProviderShifts(weekStart);
  const { data: employees = [], isLoading: loadingEmployees } = useEmployeeProfiles();
  const { data: providerStates = new Map(), isLoading: loadingStates } = useProviderActiveStates();
  const { data: profileNames = new Map(), isLoading: loadingNames } = useProfileNames();
  const { data: runHistory = [], refetch: refetchHistory } = useRunHistory();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: runDetail } = useRunDetail(selectedRunId);

  const isLoading = loadingForecast || loadingShifts || loadingEmployees || loadingStates || loadingNames;
  const { toast } = useToast();

  const saveRun = useMutation({
    mutationFn: async (r: MatchingResult) => {
      // 1. Insert run record
      const { data: run, error: runErr } = await supabase
        .from('matching_engine_runs')
        .insert({
          week_start: weekStart,
          surplus_hours: r.surplusHours,
          gap_hours: r.gapHours,
          states_deactivated: r.deactivateCandidates,
          created_by: profile?.id ?? null,
        })
        .select('id')
        .single();
      if (runErr) throw runErr;

      // 2. Insert all assignments
      const assignmentRows = r.assignments.flatMap((a) => [
        ...a.primaryStates.map((state) => ({
          run_id: run.id,
          profile_id: a.profileId,
          state_abbreviation: state,
          assignment_type: 'primary',
          assigned_hours: a.allocatedHours / Math.max(a.primaryStates.length + a.overflowStates.length, 1),
        })),
        ...a.overflowStates.map((state) => ({
          run_id: run.id,
          profile_id: a.profileId,
          state_abbreviation: state,
          assignment_type: 'overflow',
          assigned_hours: a.allocatedHours / Math.max(a.primaryStates.length + a.overflowStates.length, 1),
        })),
      ]);

      if (assignmentRows.length > 0) {
        const { error: assErr } = await supabase
          .from('matching_assignments')
          .insert(assignmentRows);
        if (assErr) throw assErr;
      }

      return run.id;
    },
    onSuccess: (runId) => {
      refetchHistory();
      toast({
        title: 'Run saved',
        description: `Run ${runId.slice(0, 8)} saved for week of ${weekStart}`,
      });
    },
    onError: (e: Error) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  const result = useMemo<MatchingResult | null>(() => {
    if (isLoading || forecast.size === 0) return null;
    return runMatching(weekStart, forecast, shifts, employees, providerStates, profileNames);
  }, [isLoading, weekStart, forecast, shifts, employees, providerStates, profileNames]);

  const deactivateStates = useMutation({
    mutationFn: async (states: string[]) => {
      const rows = states.map((s) => ({ state_abbreviation: s, is_active: false }));
      const { error } = await supabase
        .from('state_activation')
        .upsert(rows, { onConflict: 'state_abbreviation' });
      if (error) throw error;
    },
    onSuccess: (_, states) => {
      toast({
        title: `${states.length} state${states.length !== 1 ? 's' : ''} deactivated`,
        description: states.join(', '),
      });
    },
    onError: (e: Error) => toast({ title: 'Deactivate failed', description: e.message, variant: 'destructive' }),
  });

  const prevWeek = () => setWeekOffset((o) => o - 1);
  const nextWeek = () => setWeekOffset((o) => Math.min(o + 1, 4));

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
              <h1 className="text-2xl font-bold">Demand Matching Engine</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Matches provider scheduled hours to state demand — primary &amp; overflow assignments
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={prevWeek}>←</Button>
              <span className="text-sm font-medium min-w-28 text-center">w/o {weekStart}</span>
              <Button variant="outline" size="sm" onClick={nextWeek} disabled={weekOffset >= 4}>→</Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              {result && (
                <Button
                  size="sm"
                  onClick={() => saveRun.mutate(result)}
                  disabled={saveRun.isPending}
                  className="gap-1.5"
                >
                  {saveRun.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                    : <><Save className="h-3.5 w-3.5" /> Save Run</>}
                </Button>
              )}
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
                  <p className="font-semibold text-foreground">Purpose: determine whether you have enough provider hours to cover each state's demand — and flag where supply gaps or surpluses exist.</p>
                  <p className="text-muted-foreground font-medium text-foreground">Prerequisites (must be done first):</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                    <li>Demand forecast uploaded for the target week (<a href="/admin/demand-forecast" className="underline text-primary">Demand Forecast</a>)</li>
                    <li>Homebase synced so provider shifts are current (<a href="/admin/license-optimizer" className="underline text-primary">License Optimizer → Sync Homebase</a>)</li>
                  </ul>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">Select the week</span>
                      {' '}using the ← → arrows. Use week 0 (current week) for immediate staffing decisions; future weeks for planning.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Read the Network Summary</span>
                      {' '}KPIs at the top — "Network Gap" (red) means total provider hours fall short of demand; "Surplus" (blue) means over-staffed. A gap requires immediate action: add hours, pull in contractors, or reduce active states.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Check the State Results tab</span>
                      {' '}— sorted from worst (DEFICIT) to best (SURPLUS). DEFICIT states need more provider coverage. BALANCED = 80–130% coverage. SURPLUS = {'>'}130%.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Review the Assignments tab</span>
                      {' '}— shows which providers are allocated to which states (primary vs. overflow). Use this to confirm no single provider is covering too many states.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Click "Save Run"</span>
                      {' '}to persist the result. Saved runs appear in the History tab for week-over-week gap trending. Always save before making staffing decisions so there's a record.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Use the Deactivate tab</span>
                      {' '}— surplus states identified here can be removed from active routing to reduce overhead. Only deactivate if demand is genuinely low for the week.
                    </li>
                  </ol>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">For leadership:</span>
                    {' '}The History chart (Gap vs. Surplus over time) is the key visual for showing supply-demand balance improvement week over week. Export State Results for board-level reporting. A consistent gap in the same states signals a licensing gap — escalate to the License Optimizer.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Computing assignments…</div>
          ) : !result ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Zap className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No forecast data for this week</p>
                <p className="text-sm mt-1">
                  Upload a Metabase demand forecast CSV in the Demand Forecast page, then return here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Network summary */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">Total Demand</p>
                    <p className="text-2xl font-bold">{result.totalDemandHours.toFixed(0)}h</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">Total Supply</p>
                    <p className="text-2xl font-bold">{result.totalSupplyHours.toFixed(0)}h</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">Network Gap</p>
                    <p className={cn('text-2xl font-bold', result.gapHours > 0 && 'text-destructive')}>
                      {result.gapHours > 0 ? `-${result.gapHours.toFixed(0)}h` : '—'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">Network Surplus</p>
                    <p className={cn('text-2xl font-bold', result.surplusHours > 0 && 'text-blue-600')}>
                      {result.surplusHours > 0 ? `+${result.surplusHours.toFixed(0)}h` : '—'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Leadership briefing */}
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-semibold">Leadership Summary</p>
                    <p className="text-sm text-muted-foreground">
                      {(() => {
                        const coveragePct = result.totalDemandHours > 0
                          ? (result.totalSupplyHours / result.totalDemandHours * 100).toFixed(0)
                          : '0';
                        const netStatus = result.gapHours > 0
                          ? `Supply is short by ${result.gapHours.toFixed(0)}h — staffing action needed.`
                          : result.surplusHours > 0
                          ? `Supply exceeds demand by ${result.surplusHours.toFixed(0)}h.`
                          : 'Supply and demand are balanced.';
                        const deficitStates = result.stateResults.filter(s => s.status === 'DEFICIT');
                        const deficitStr = deficitStates.length > 0
                          ? ` ${deficitStates.length} state${deficitStates.length !== 1 ? 's' : ''} need more coverage (${deficitStates.slice(0, 3).map(s => s.state).join(', ')}${deficitStates.length > 3 ? '…' : ''}).`
                          : ' All states are adequately covered.';
                        const deactivateStr = result.deactivateCandidates.length > 0
                          ? ` ${result.deactivateCandidates.length} surplus state${result.deactivateCandidates.length !== 1 ? 's' : ''} can be deactivated.`
                          : '';
                        return `Week of ${weekStart}: ${coveragePct}% of demand covered. ${netStatus}${deficitStr}${deactivateStr}`;
                      })()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-xs"
                    onClick={() => {
                      const coveragePct = result.totalDemandHours > 0
                        ? (result.totalSupplyHours / result.totalDemandHours * 100).toFixed(0)
                        : '0';
                      const deficitStates = result.stateResults.filter(s => s.status === 'DEFICIT');
                      const text = [
                        `Demand Matching Report — Week of ${weekStart}`,
                        '',
                        `Demand: ${result.totalDemandHours.toFixed(0)}h  |  Supply: ${result.totalSupplyHours.toFixed(0)}h  |  Coverage: ${coveragePct}%`,
                        `Network Gap: ${result.gapHours > 0 ? `-${result.gapHours.toFixed(0)}h` : 'none'}  |  Surplus: ${result.surplusHours > 0 ? `+${result.surplusHours.toFixed(0)}h` : 'none'}`,
                        '',
                        `Deficit States (${deficitStates.length}):`,
                        ...deficitStates.slice(0, 10).map(s =>
                          `  ${s.state}: ${(s.coverageRatio * 100).toFixed(0)}% covered (need ${(s.demandHours - s.supplyHours).toFixed(0)}h more)`
                        ),
                        ...(deficitStates.length === 0 ? ['  None'] : []),
                        '',
                        `States to Deactivate: ${result.deactivateCandidates.join(', ') || 'None'}`,
                      ].join('\n');
                      navigator.clipboard.writeText(text);
                      toast({ title: 'Summary copied to clipboard' });
                    }}
                  >
                    Copy
                  </Button>
                </CardContent>
              </Card>

              <Tabs defaultValue="assignments">
                <TabsList>
                  <TabsTrigger value="assignments">
                    Assignments ({result.assignments.length})
                  </TabsTrigger>
                  <TabsTrigger value="states">
                    State Results ({result.stateResults.length})
                  </TabsTrigger>
                  <TabsTrigger value="deactivate">
                    Deactivate ({result.deactivateCandidates.length})
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    History ({runHistory.length})
                  </TabsTrigger>
                </TabsList>

                {/* Assignments tab */}
                <TabsContent value="assignments" className="mt-4">
                  <Card>
                    {result.assignments.length > 0 && (
                      <div className="flex justify-end px-4 pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() =>
                            downloadCSV(
                              result.assignments.map((a) => ({
                                provider: a.providerName,
                                scheduled_hours: a.totalHours.toFixed(1),
                                primary_states: a.primaryStates.join(';'),
                                overflow_states: a.overflowStates.join(';'),
                              })),
                              `matching-assignments-${weekStart}.csv`,
                            )
                          }
                        >
                          <Download className="h-3 w-3" /> Export
                        </Button>
                      </div>
                    )}
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Provider</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Scheduled Hrs</th>
                              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Primary States</th>
                              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Overflow States</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.assignments.map((a) => (
                              <tr key={a.profileId} className="border-b hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-2.5 font-medium">{a.providerName}</td>
                                <td className="px-4 py-2.5 text-right font-mono">
                                  {a.totalHours.toFixed(1)}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {a.primaryStates.map((s) => (
                                      <Badge key={s} variant="default" className="text-xs">{s}</Badge>
                                    ))}
                                    {a.primaryStates.length === 0 && (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {a.overflowStates.map((s) => (
                                      <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                                    ))}
                                    {a.overflowStates.length === 0 && (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {result.assignments.length === 0 && (
                              <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                                  No provider shift data for this week. Sync Homebase in the License Optimizer.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* State results tab */}
                <TabsContent value="states" className="mt-4">
                  <Card>
                    {result.stateResults.length > 0 && (
                      <div className="flex justify-end px-4 pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() =>
                            downloadCSV(
                              result.stateResults.map((s) => ({
                                state: s.state,
                                demand_hours: s.demandHours.toFixed(1),
                                supply_hours: s.supplyHours.toFixed(1),
                                coverage_pct: (s.coverageRatio * 100).toFixed(0),
                                status: s.status,
                              })),
                              `matching-states-${weekStart}.csv`,
                            )
                          }
                        >
                          <Download className="h-3 w-3" /> Export
                        </Button>
                      </div>
                    )}
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">State</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Demand (hrs)</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Supply (hrs)</th>
                              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Coverage</th>
                              <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.stateResults.map((s) => (
                              <tr
                                key={s.state}
                                className={cn(
                                  'border-b hover:bg-muted/30 transition-colors',
                                  s.status === 'DEFICIT'  && 'bg-destructive/5',
                                  s.status === 'SURPLUS'  && 'bg-blue-50 dark:bg-blue-950/20',
                                )}
                              >
                                <td className="px-4 py-2.5 font-semibold">{s.state}</td>
                                <td className="px-4 py-2.5 text-right font-mono">{s.demandHours.toFixed(1)}</td>
                                <td className="px-4 py-2.5 text-right font-mono">{s.supplyHours.toFixed(1)}</td>
                                <td className="px-4 py-2.5 text-right font-mono">
                                  {(s.coverageRatio * 100).toFixed(0)}%
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  <StatusBadge status={s.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Deactivate tab */}
                <TabsContent value="deactivate" className="mt-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-base">States to Deactivate from Routing</CardTitle>
                      {result.deactivateCandidates.length > 0 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="gap-1.5"
                          disabled={deactivateStates.isPending}
                          onClick={() => {
                            if (confirm(`Deactivate ${result.deactivateCandidates.join(', ')} from routing?`)) {
                              deactivateStates.mutate(result.deactivateCandidates);
                            }
                          }}
                        >
                          {deactivateStates.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Deactivate All ({result.deactivateCandidates.length})
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent>
                      {result.deactivateCandidates.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No surplus states identified for this week.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground mb-3">
                            These states have projected supply significantly exceeding demand.
                            Deactivating removes them from the active routing pool in the Ops Dashboard.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {result.deactivateCandidates.map((state) => {
                              const sr = result.stateResults.find((s) => s.state === state);
                              return (
                                <div
                                  key={state}
                                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200"
                                >
                                  <span className="font-bold text-sm">{state}</span>
                                  {sr && (
                                    <span className="text-xs text-muted-foreground">
                                      {(sr.coverageRatio * 100).toFixed(0)}% covered
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground mt-3">
                            Individual states can also be toggled in the Ops Dashboard.
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Run History tab */}
                <TabsContent value="history" className="mt-4 space-y-4">
                  {runHistory.length > 1 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Gap vs. Surplus Over Runs</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={180}>
                          <BarChart
                            data={[...runHistory].reverse().map((r) => ({
                              week: r.week_start.slice(5),
                              gap: r.gap_hours != null ? Math.round(r.gap_hours) : 0,
                              surplus: r.surplus_hours != null ? Math.round(r.surplus_hours) : 0,
                            }))}
                            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} unit="h" />
                            <Tooltip formatter={(v: any) => `${v}h`} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="gap"     fill="#ef4444" name="Gap Hrs" />
                            <Bar dataKey="surplus" fill="#3b82f6" name="Surplus Hrs" />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                  <Card>
                    <CardContent className="p-0">
                      {runHistory.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                          No saved runs yet. Click "Save Run" to persist a result.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Week</th>
                                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Surplus Hrs</th>
                                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Gap Hrs</th>
                                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Deactivate Candidates</th>
                                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Saved</th>
                              </tr>
                            </thead>
                            <tbody>
                              {runHistory.map((run) => (
                                <>
                                  <tr
                                    key={run.id}
                                    className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                                    onClick={() => setSelectedRunId((prev) => prev === run.id ? null : run.id)}
                                  >
                                    <td className="px-4 py-2.5 font-medium font-mono flex items-center gap-1.5">
                                      {selectedRunId === run.id
                                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                      {run.week_start}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono text-blue-600">
                                      {run.surplus_hours != null ? `+${run.surplus_hours.toFixed(0)}h` : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono text-destructive">
                                      {run.gap_hours != null && run.gap_hours > 0 ? `-${run.gap_hours.toFixed(0)}h` : '—'}
                                    </td>
                                    <td className="px-4 py-2.5">
                                      {Array.isArray(run.states_deactivated) && run.states_deactivated.length > 0
                                        ? (run.states_deactivated as string[]).map((s) => (
                                            <Badge key={s} variant="outline" className="text-xs mr-1">{s}</Badge>
                                          ))
                                        : <span className="text-muted-foreground text-xs">none</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                                      {formatDisplayDate(run.created_at)}
                                    </td>
                                  </tr>
                                  {selectedRunId === run.id && runDetail && (
                                    <tr key={`${run.id}-detail`}>
                                      <td colSpan={5} className="bg-muted/20 px-6 py-4">
                                        <div className="space-y-3">
                                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                            State Assignments — Week of {run.week_start}
                                          </p>
                                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                            {[...runDetail.byState.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([state, info]) => (
                                              <div key={state} className="rounded-lg border bg-background p-3">
                                                <div className="flex items-center justify-between mb-1.5">
                                                  <span className="font-bold text-sm">{state}</span>
                                                  <span className="text-xs text-muted-foreground font-mono">{info.hours.toFixed(0)}h</span>
                                                </div>
                                                {info.primary.length > 0 && (
                                                  <div className="text-xs text-foreground">
                                                    <span className="text-muted-foreground">Primary: </span>
                                                    {info.primary.join(', ')}
                                                  </div>
                                                )}
                                                {info.overflow.length > 0 && (
                                                  <div className="text-xs text-muted-foreground mt-0.5">
                                                    <span>Overflow: </span>
                                                    {info.overflow.join(', ')}
                                                  </div>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}

        </div>
      </main>
    </div>
  );
}
