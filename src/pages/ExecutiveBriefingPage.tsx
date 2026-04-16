import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle, TrendingDown, TrendingUp, DollarSign,
  Activity, RefreshCw, Loader2, Target, MapPin, Users
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { downloadCSV } from '@/lib/utils';

interface BridgeRow {
  snapshot_date: string;
  state_abbreviation: string;
  supply_hours: number;
  supply_slots: number;
  demand_slots: number;
  demand_hours: number;
  gap_slots: number;
  coverage_ratio: number | null;
  status: string;
  confidence: string;
}

interface CostRow {
  snapshot_date: string;
  state_abbreviation: string;
  total_hours: number;
  total_cost: number;
  total_visits: number;
  cost_per_visit: number | null;
  cost_per_hour: number | null;
}

const ExecutiveBriefingPage = () => {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const { data: bridge, isLoading: bridgeLoading } = useQuery({
    queryKey: ['exec-bridge', today],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('coverage_bridge_snapshots')
        .select('*')
        .gte('snapshot_date', sevenDaysAgo)
        .order('snapshot_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as BridgeRow[];
    },
  });

  const { data: costs, isLoading: costsLoading } = useQuery({
    queryKey: ['exec-costs', today],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('visit_cost_snapshots')
        .select('*')
        .gte('snapshot_date', sevenDaysAgo)
        .order('snapshot_date', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CostRow[];
    },
  });

  const { data: licOptRecs } = useQuery({
    queryKey: ['exec-lic-recs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('license_optimization_snapshots')
        .select('state_abbreviation, quadrant, wasted_flag, profile_id')
        .order('snapshot_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const recomputeBridge = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('compute-coverage-bridge', {
        body: { window_days: 14 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Coverage bridge recomputed');
      queryClient.invalidateQueries({ queryKey: ['exec-bridge'] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const recomputeCosts = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('compute-visit-cost', {
        body: { window_days: 30 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Cost snapshots recomputed');
      queryClient.invalidateQueries({ queryKey: ['exec-costs'] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  // Aggregate latest day per state
  const latestPerState = new Map<string, BridgeRow>();
  (bridge ?? []).forEach((r) => {
    const ex = latestPerState.get(r.state_abbreviation);
    if (!ex || r.snapshot_date > ex.snapshot_date) latestPerState.set(r.state_abbreviation, r);
  });
  const latestBridge = [...latestPerState.values()];
  const deficits = latestBridge.filter((r) => r.status === 'DEFICIT').sort((a, b) => a.gap_slots - b.gap_slots);
  const surpluses = latestBridge.filter((r) => r.status === 'SURPLUS').sort((a, b) => b.gap_slots - a.gap_slots);
  const balanced = latestBridge.filter((r) => r.status === 'BALANCED').length;

  const totalGapSlots = deficits.reduce((s, r) => s + Math.abs(r.gap_slots), 0);
  const totalSurplusSlots = surpluses.reduce((s, r) => s + r.gap_slots, 0);

  // Cost aggregates
  const latestCostPerState = new Map<string, CostRow>();
  (costs ?? []).forEach((r) => {
    const ex = latestCostPerState.get(r.state_abbreviation);
    if (!ex || r.snapshot_date > ex.snapshot_date) latestCostPerState.set(r.state_abbreviation, r);
  });
  const latestCosts = [...latestCostPerState.values()];
  const totalCost7d = (costs ?? []).reduce((s, r) => s + Number(r.total_cost ?? 0), 0);
  const totalVisits7d = (costs ?? []).reduce((s, r) => s + Number(r.total_visits ?? 0), 0);
  const blendedCpv = totalVisits7d > 0 ? totalCost7d / totalVisits7d : null;

  // Wasted hours from license optimizer
  const wastedRecs = (licOptRecs ?? []).filter((r: any) => r.wasted_flag === true);
  const wastedProviderCount = new Set(wastedRecs.map((r: any) => r.profile_id)).size;

  const handleExport = () => {
    if (!latestBridge.length) return;
    downloadCSV(latestBridge.map((r) => ({
      state: r.state_abbreviation,
      status: r.status,
      supply_hours: r.supply_hours,
      demand_hours: r.demand_hours,
      gap_slots: r.gap_slots,
      coverage_ratio: r.coverage_ratio,
      confidence: r.confidence,
    })));
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={(profile as any)?.role ?? 'admin'}
        userName={profile?.full_name ?? 'Admin'}
        userEmail={profile?.email ?? ''}
      />
      <main className="ml-0 sm:ml-16 lg:ml-64 p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Executive Briefing</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Coverage, cost, and licensure optimization at a glance — for leadership decisions.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport} disabled={!latestBridge.length}>
                Export
              </Button>
              <Button
                size="sm"
                onClick={() => { recomputeBridge.mutate(); recomputeCosts.mutate(); }}
                disabled={recomputeBridge.isPending || recomputeCosts.isPending}
              >
                {recomputeBridge.isPending || recomputeCosts.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <RefreshCw className="h-4 w-4 mr-2" />}
                Refresh All
              </Button>
            </div>
          </div>

          {/* Top KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> Deficit States
                </CardDescription>
                <CardTitle className="text-3xl text-destructive">{deficits.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {totalGapSlots} slots short today
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Surplus States
                </CardDescription>
                <CardTitle className="text-3xl text-success">{surpluses.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {totalSurplusSlots} excess slots
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Blended Cost / Visit
                </CardDescription>
                <CardTitle className="text-3xl">
                  {blendedCpv !== null ? `$${blendedCpv.toFixed(2)}` : '—'}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                7-day rolling • {totalVisits7d} visits
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Wasted Capacity
                </CardDescription>
                <CardTitle className="text-3xl text-warning">{wastedProviderCount}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                providers in surplus-only states
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="coverage">
            <TabsList>
              <TabsTrigger value="coverage">Coverage Bridge</TabsTrigger>
              <TabsTrigger value="cost">Cost Per Visit</TabsTrigger>
              <TabsTrigger value="actions">Recommended Actions</TabsTrigger>
            </TabsList>

            {/* Coverage Bridge */}
            <TabsContent value="coverage" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Supply vs. Demand by State
                  </CardTitle>
                  <CardDescription>
                    Latest snapshot per state. Demand is derived from booked slots ÷ SLA target.
                    {balanced > 0 && ` ${balanced} states balanced.`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {bridgeLoading ? (
                    <Skeleton className="h-48" />
                  ) : latestBridge.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-8 text-center border rounded-md">
                      No coverage bridge data yet. Click <strong>Refresh All</strong> to compute.
                    </div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="py-2 px-2">State</th>
                            <th className="py-2 px-2">Status</th>
                            <th className="py-2 px-2 text-right">Supply (hrs)</th>
                            <th className="py-2 px-2 text-right">Demand (hrs)</th>
                            <th className="py-2 px-2 text-right">Gap (slots)</th>
                            <th className="py-2 px-2 text-right">Ratio</th>
                            <th className="py-2 px-2">Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestBridge
                            .sort((a, b) => (a.coverage_ratio ?? 99) - (b.coverage_ratio ?? 99))
                            .map((r) => (
                              <tr key={r.state_abbreviation} className="border-b last:border-0">
                                <td className="py-2 px-2 font-medium">{r.state_abbreviation}</td>
                                <td className="py-2 px-2">
                                  <Badge
                                    variant={
                                      r.status === 'DEFICIT' ? 'destructive'
                                      : r.status === 'SURPLUS' ? 'secondary'
                                      : 'outline'
                                    }
                                  >
                                    {r.status}
                                  </Badge>
                                </td>
                                <td className="py-2 px-2 text-right">{r.supply_hours.toFixed(1)}</td>
                                <td className="py-2 px-2 text-right">{r.demand_hours.toFixed(1)}</td>
                                <td className={`py-2 px-2 text-right font-medium ${
                                  r.gap_slots < 0 ? 'text-destructive' : r.gap_slots > 0 ? 'text-success' : ''
                                }`}>
                                  {r.gap_slots > 0 ? `+${r.gap_slots}` : r.gap_slots}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  {r.coverage_ratio !== null ? r.coverage_ratio.toFixed(2) : '—'}
                                </td>
                                <td className="py-2 px-2 text-xs text-muted-foreground">{r.confidence}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cost Per Visit */}
            <TabsContent value="cost" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Cost Per Visit by State
                  </CardTitle>
                  <CardDescription>
                    Computed from provider hours × hourly rate ÷ booked slots. Default rate $75/hr when no rate is set.
                    Set rates in <a href="/admin/settings" className="underline">System Settings</a>.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {costsLoading ? (
                    <Skeleton className="h-48" />
                  ) : latestCosts.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-8 text-center border rounded-md">
                      No cost data yet. Click <strong>Refresh All</strong> to compute.
                    </div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="py-2 px-2">State</th>
                            <th className="py-2 px-2 text-right">Hours</th>
                            <th className="py-2 px-2 text-right">Visits</th>
                            <th className="py-2 px-2 text-right">Cost</th>
                            <th className="py-2 px-2 text-right">$/Visit</th>
                            <th className="py-2 px-2 text-right">$/Hour</th>
                          </tr>
                        </thead>
                        <tbody>
                          {latestCosts
                            .sort((a, b) => (b.cost_per_visit ?? 0) - (a.cost_per_visit ?? 0))
                            .map((r) => (
                              <tr key={r.state_abbreviation} className="border-b last:border-0">
                                <td className="py-2 px-2 font-medium">{r.state_abbreviation}</td>
                                <td className="py-2 px-2 text-right">{r.total_hours.toFixed(1)}</td>
                                <td className="py-2 px-2 text-right">{r.total_visits}</td>
                                <td className="py-2 px-2 text-right">${r.total_cost.toFixed(0)}</td>
                                <td className="py-2 px-2 text-right font-medium">
                                  {r.cost_per_visit !== null ? `$${r.cost_per_visit.toFixed(2)}` : '—'}
                                </td>
                                <td className="py-2 px-2 text-right text-muted-foreground">
                                  {r.cost_per_hour !== null ? `$${r.cost_per_hour.toFixed(0)}` : '—'}
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

            {/* Recommended Actions */}
            <TabsContent value="actions" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Top Recommendations
                  </CardTitle>
                  <CardDescription>
                    Consolidated from coverage gaps, license optimizer, and surplus capacity.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {deficits.slice(0, 5).map((d) => (
                    <div key={d.state_abbreviation} className="flex items-start gap-3 p-3 border rounded-md bg-destructive/5">
                      <MapPin className="h-4 w-4 mt-1 text-destructive flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          Add coverage to <strong>{d.state_abbreviation}</strong>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Short {Math.abs(d.gap_slots)} slots/day. Activate licenses or shift hours from surplus states.
                        </div>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <a href={`/admin/license-optimizer`}>Optimize</a>
                      </Button>
                    </div>
                  ))}
                  {surpluses.slice(0, 3).map((s) => (
                    <div key={s.state_abbreviation} className="flex items-start gap-3 p-3 border rounded-md bg-success/5">
                      <Users className="h-4 w-4 mt-1 text-success flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          Reallocate capacity from <strong>{s.state_abbreviation}</strong>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {s.gap_slots} excess slots/day. Consider redirecting providers to deficit states.
                        </div>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <a href={`/admin/matching`}>Match</a>
                      </Button>
                    </div>
                  ))}
                  {wastedProviderCount > 0 && (
                    <div className="flex items-start gap-3 p-3 border rounded-md bg-warning/5">
                      <AlertTriangle className="h-4 w-4 mt-1 text-warning flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {wastedProviderCount} providers underused
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Their licensed states are all in surplus. Activate them in deficit states.
                        </div>
                      </div>
                      <Button size="sm" variant="outline" asChild>
                        <a href="/admin/license-optimizer">Review</a>
                      </Button>
                    </div>
                  )}
                  {deficits.length === 0 && surpluses.length === 0 && wastedProviderCount === 0 && (
                    <div className="text-sm text-muted-foreground p-8 text-center border rounded-md">
                      No urgent actions identified. Coverage looks balanced.
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

export default ExecutiveBriefingPage;
