import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Zap, RefreshCw } from 'lucide-react';

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
      const { data, error } = await (supabase as any)
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
      const { data, error } = await (supabase as any)
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
      const { data, error } = await (supabase as any)
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
      const { data, error } = await (supabase as any)
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
      const { data, error } = await (supabase as any)
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
      status: ratio >= 1.3 ? 'SURPLUS' : ratio >= 0.8 ? 'BALANCED' : 'DEFICIT',
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

  const { data: forecast = new Map(), isLoading: loadingForecast, refetch } = useForecast(weekStart);
  const { data: shifts = new Map(), isLoading: loadingShifts } = useProviderShifts(weekStart);
  const { data: employees = [], isLoading: loadingEmployees } = useEmployeeProfiles();
  const { data: providerStates = new Map(), isLoading: loadingStates } = useProviderActiveStates();
  const { data: profileNames = new Map(), isLoading: loadingNames } = useProfileNames();

  const isLoading = loadingForecast || loadingShifts || loadingEmployees || loadingStates || loadingNames;

  const result = useMemo<MatchingResult | null>(() => {
    if (isLoading || forecast.size === 0) return null;
    return runMatching(weekStart, forecast, shifts, employees, providerStates, profileNames);
  }, [isLoading, weekStart, forecast, shifts, employees, providerStates, profileNames]);

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
            </div>
          </div>

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
                </TabsList>

                {/* Assignments tab */}
                <TabsContent value="assignments" className="mt-4">
                  <Card>
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
                    <CardHeader>
                      <CardTitle className="text-base">States to Deactivate from Routing</CardTitle>
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
                            Removing them from routing can reduce wasted contractor hours.
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
                            Review in the License Optimizer before updating state_activation.
                          </p>
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
