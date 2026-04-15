import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';

// ── NP Practice Authority (2024-2025 · verify with current state regulations) ──

type NPAuthority = 'full' | 'reduced' | 'restricted';

const NP_AUTHORITY: Record<string, NPAuthority> = {
  // Full Practice Authority — independent practice and prescribing
  AK: 'full', AZ: 'full', CO: 'full', CT: 'full', DC: 'full', DE: 'full',
  HI: 'full', IA: 'full', ID: 'full', KY: 'full', ME: 'full', MD: 'full',
  MN: 'full', MT: 'full', ND: 'full', NH: 'full', NM: 'full', NV: 'full',
  OR: 'full', RI: 'full', SD: 'full', VT: 'full', WA: 'full', WY: 'full',
  WI: 'full', NE: 'full',
  // Reduced Practice — collaborative agreement required for some functions
  AL: 'reduced', AR: 'reduced', IL: 'reduced', IN: 'reduced', KS: 'reduced',
  LA: 'reduced', MA: 'reduced', MI: 'reduced', MO: 'reduced', MS: 'reduced',
  NJ: 'reduced', NY: 'reduced', OH: 'reduced', OK: 'reduced', SC: 'reduced',
  TN: 'reduced', UT: 'reduced', WV: 'reduced',
  // Restricted Practice — physician supervision required
  CA: 'restricted', FL: 'restricted', GA: 'restricted', NC: 'restricted',
  PA: 'restricted', TX: 'restricted', VA: 'restricted',
};

const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY',
];

// ── Data hooks ────────────────────────────────────────────────────────────────

function useWasteData() {
  return useQuery({
    queryKey: ['routing_waste'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('license_optimization_snapshots')
        .select('state_abbreviation, wasted_flag, quadrant, allocated_hours, coverage_ratio')
        .order('snapshot_date', { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 5 * 60_000,
  });
}

function useStateActivation() {
  return useQuery({
    queryKey: ['state_activation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('state_activation')
        .select('state_abbreviation, is_active');
      if (error) throw error;
      return new Set<string>(
        (data ?? []).filter((r: any) => r.is_active).map((r: any) => r.state_abbreviation)
      );
    },
    staleTime: 5 * 60_000,
  });
}

function useStateRouting() {
  return useQuery({
    queryKey: ['state_routing_analysis'],
    queryFn: async () => {
      const [shiftsRes, locationsRes] = await Promise.all([
        supabase
          .from('homebase_shifts')
          .select('location_homebase_uuid, role, scheduled_hours')
          .not('scheduled_hours', 'is', null)
          .limit(5000),
        supabase
          .from('homebase_locations')
          .select('homebase_uuid, state'),
      ]);

      const locationToState = new Map<string, string>(
        (locationsRes.data ?? []).map((l: any) => [l.homebase_uuid, l.state])
      );

      type StateEntry = { state: string; totalHours: number; roles: Record<string, number> };
      const stateMap = new Map<string, StateEntry>();

      for (const shift of (shiftsRes.data ?? []) as any[]) {
        const state = locationToState.get(shift.location_homebase_uuid);
        if (!state) continue;
        if (!stateMap.has(state)) stateMap.set(state, { state, totalHours: 0, roles: {} });
        const entry = stateMap.get(state)!;
        const hrs = Number(shift.scheduled_hours ?? 0);
        entry.totalHours += hrs;
        const role = (shift.role ?? 'Unknown').trim();
        entry.roles[role] = (entry.roles[role] ?? 0) + hrs;
      }

      return [...stateMap.values()].sort((a, b) => b.totalHours - a.totalHours);
    },
    staleTime: 5 * 60_000,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authorityColor(auth: NPAuthority | undefined): string {
  switch (auth) {
    case 'full':       return 'bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'reduced':    return 'bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300';
    case 'restricted': return 'bg-red-100 border-red-300 text-red-800 dark:bg-red-950/40 dark:text-red-300';
    default:           return 'bg-muted border-border text-muted-foreground';
  }
}

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function RoutingIntelligencePage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data: wasteRows = [], isLoading: loadingWaste } = useWasteData();
  const { data: activeStates = new Set<string>() } = useStateActivation();
  const { data: routingRows = [], isLoading: loadingRouting } = useStateRouting();

  // ── Waste analysis ──────────────────────────────────────────────────────────

  const wasteByState = useMemo(() => {
    const map = new Map<string, { structural: number; routing: number }>();
    for (const r of wasteRows) {
      if (!map.has(r.state_abbreviation)) {
        map.set(r.state_abbreviation, { structural: 0, routing: 0 });
      }
      const entry = map.get(r.state_abbreviation)!;
      const hrs = Number(r.allocated_hours ?? 0);
      if (r.wasted_flag && r.quadrant === 'SURPLUS') {
        entry.structural += hrs;
      } else if (r.quadrant === 'DEFICIT') {
        entry.routing += hrs;
      }
    }
    return [...map.entries()]
      .map(([state, v]) => ({ state, ...v, total: v.structural + v.routing }))
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
  }, [wasteRows]);

  const wasteSummary = useMemo(() => ({
    structural: wasteByState.reduce((s, r) => s + r.structural, 0),
    routing:    wasteByState.reduce((s, r) => s + r.routing, 0),
  }), [wasteByState]);

  // ── Expansion recommendations ───────────────────────────────────────────────

  const expansionRecs = useMemo(() => {
    const deficitStates = [
      ...new Set(
        wasteRows.filter((r) => r.quadrant === 'DEFICIT').map((r) => r.state_abbreviation)
      ),
    ];
    // Providers with surplus in some states could expand to deficit states
    const providerSurplus = new Map<string, string[]>();
    for (const r of wasteRows) {
      if (r.quadrant === 'SURPLUS' && r.wasted_flag) {
        if (!providerSurplus.has(r.profile_id)) providerSurplus.set(r.profile_id, []);
        if (!providerSurplus.get(r.profile_id)!.includes(r.state_abbreviation)) {
          providerSurplus.get(r.profile_id)!.push(r.state_abbreviation);
        }
      }
    }
    return deficitStates.slice(0, 10).map((state) => ({
      state,
      authority: NP_AUTHORITY[state] ?? 'unknown',
      providerCount: [...providerSurplus.values()].filter((states) =>
        !states.includes(state)
      ).length,
    }));
  }, [wasteRows]);

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

          <div>
            <h1 className="text-2xl font-bold">Routing Intelligence</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Waste analysis, state routing mix, NP practice authority, and expansion opportunities
            </p>
          </div>

          <Tabs defaultValue="waste">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="waste">Waste Analysis</TabsTrigger>
              <TabsTrigger value="routing">State Routing</TabsTrigger>
              <TabsTrigger value="authority">NP Authority Map</TabsTrigger>
              <TabsTrigger value="expansion">Expansion Recs</TabsTrigger>
            </TabsList>

            {/* ── Waste Analysis ────────────────────────────────────────────── */}
            <TabsContent value="waste" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">Structural Waste</p>
                    <p className="text-2xl font-bold">{wasteSummary.structural.toFixed(0)}h</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Provider licensed, demand too low (SURPLUS)
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="text-sm text-muted-foreground">Routing Gap</p>
                    <p className="text-2xl font-bold">{wasteSummary.routing.toFixed(0)}h</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Demand exists but insufficient coverage (DEFICIT)
                    </p>
                  </CardContent>
                </Card>
              </div>

              {loadingWaste ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : wasteByState.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No snapshot data. Recompute in License Optimizer.
                </div>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Waste by State (top 20)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={wasteByState}
                        margin={{ top: 5, right: 20, left: 0, bottom: 30 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="state"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                        />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="structural" stackId="a" fill="#3b82f6" name="Structural" />
                        <Bar dataKey="routing"    stackId="a" fill="#ef4444" name="Routing Gap" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ── State Routing ─────────────────────────────────────────────── */}
            <TabsContent value="routing" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scheduled Hours by State & Role</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingRouting ? (
                    <div className="p-8 text-center text-muted-foreground">Loading…</div>
                  ) : routingRows.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      No Homebase shift data. Sync Homebase from the License Optimizer.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">State</th>
                            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Total Hrs</th>
                            {/* Top roles as columns */}
                            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">MD/DO %</th>
                            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">NP %</th>
                            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Other %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {routingRows.map((r: any) => {
                            const mdHrs = Object.entries(r.roles as Record<string, number>)
                              .filter(([role]) => /md|do|physician/i.test(role))
                              .reduce((s, [, h]) => s + h, 0);
                            const npHrs = Object.entries(r.roles as Record<string, number>)
                              .filter(([role]) => /np|nurse practitioner|apn|aprn/i.test(role))
                              .reduce((s, [, h]) => s + h, 0);
                            const otherHrs = r.totalHours - mdHrs - npHrs;
                            return (
                              <tr key={r.state} className="border-b hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-2.5 font-semibold">
                                  {r.state}
                                  {activeStates.has(r.state) && (
                                    <Badge variant="outline" className="ml-2 text-xs">active</Badge>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono">
                                  {r.totalHours.toFixed(1)}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono">{pct(mdHrs, r.totalHours)}</td>
                                <td className="px-4 py-2.5 text-right font-mono">{pct(npHrs, r.totalHours)}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                                  {pct(otherHrs, r.totalHours)}
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
            </TabsContent>

            {/* ── NP Authority Map ──────────────────────────────────────────── */}
            <TabsContent value="authority" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">NP Practice Authority by State</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" />
                      Full Practice — independent practice &amp; prescribing
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400" />
                      Reduced — collaborative agreement required
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm bg-red-400" />
                      Restricted — physician supervision required
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-10">
                    {ALL_STATES.map((state) => {
                      const auth = NP_AUTHORITY[state];
                      const isActive = activeStates.has(state);
                      return (
                        <div
                          key={state}
                          className={cn(
                            'rounded p-1.5 text-center border text-xs font-bold leading-tight cursor-default',
                            authorityColor(auth),
                            isActive && 'ring-2 ring-primary ring-offset-1',
                          )}
                          title={`${state}: ${auth ?? 'unknown'} practice${isActive ? ' · active' : ''}`}
                        >
                          {state}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Bold ring = currently active in operations. Data reflects 2024-2025 regulations — verify with state-specific NP compact updates.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Expansion Recommendations ─────────────────────────────────── */}
            <TabsContent value="expansion" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">License Expansion Opportunities</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {expansionRecs.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No deficit states identified. Recompute snapshots in License Optimizer.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {expansionRecs.map((rec) => (
                        <div
                          key={rec.state}
                          className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30"
                        >
                          <span className="font-bold w-8 shrink-0">{rec.state}</span>
                          <Badge
                            className={cn(
                              'text-xs shrink-0',
                              rec.authority === 'full'       && 'bg-emerald-500 text-white',
                              rec.authority === 'reduced'    && 'bg-yellow-500 text-white',
                              rec.authority === 'restricted' && 'bg-red-500 text-white',
                            )}
                          >
                            {rec.authority}
                          </Badge>
                          <span className="text-sm text-muted-foreground flex-1">
                            Deficit state · {rec.providerCount} surplus providers could expand here
                          </span>
                          {rec.authority === 'full' && (
                            <Badge variant="outline" className="text-xs text-emerald-600">
                              No collab needed
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground pt-2">
                    States are ranked by coverage deficit from license_optimization_snapshots.
                    Providers with surplus hours in other states are the best candidates to license here.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

        </div>
      </main>
    </div>
  );
}
