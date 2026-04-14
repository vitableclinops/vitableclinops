import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  BarChart3,
  Zap,
  Clock,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Quadrant = 'SURPLUS' | 'DEFICIT' | 'BALANCED' | 'ANOMALY' | 'UNKNOWN';

interface Snapshot {
  snapshot_date: string;
  profile_id: string;
  state_abbreviation: string;
  provider_hours_total: number | null;
  active_license_count: number | null;
  allocated_hours: number | null;
  unfilled_slots: number | null;
  sla_pct: number | null;
  estimated_demand_hours: number | null;
  coverage_ratio: number | null;
  quadrant: Quadrant;
  wasted_flag: boolean;
  profiles?: { full_name: string | null; first_name: string | null; last_name: string | null };
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useSnapshots(view: 'historical' | 'forward') {
  const today = new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: ['license_optimizer_snapshots', view],
    queryFn: async () => {
      const query = supabase
        .from('license_optimization_snapshots')
        .select(`
          *,
          profiles!license_optimization_snapshots_profile_id_fkey(full_name, first_name, last_name)
        `)
        .order('snapshot_date', { ascending: true })
        .limit(2000);

      if (view === 'historical') {
        query.lte('snapshot_date', today);
      } else {
        query.gte('snapshot_date', today);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Snapshot[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useSyncRuns() {
  return useQuery({
    queryKey: ['homebase_sync_runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('homebase_sync_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    staleTime: 60_000,
  });
}

function useStateActivation() {
  return useQuery({
    queryKey: ['state_activation'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('state_activation')
        .select('state_abbreviation, is_active')
        .eq('is_active', true);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.state_abbreviation as string));
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function providerDisplayName(snapshot: Snapshot): string {
  const p = snapshot.profiles;
  if (!p) return snapshot.profile_id.slice(0, 8) + '…';
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function quadrantColor(q: Quadrant | undefined): string {
  switch (q) {
    case 'DEFICIT':  return 'bg-red-500';
    case 'SURPLUS':  return 'bg-blue-400';
    case 'BALANCED': return 'bg-emerald-500';
    case 'ANOMALY':  return 'bg-amber-400';
    default:         return 'bg-muted';
  }
}

function quadrantBadgeVariant(q: Quadrant | undefined): 'destructive' | 'default' | 'secondary' | 'outline' {
  switch (q) {
    case 'DEFICIT':  return 'destructive';
    case 'SURPLUS':  return 'default';
    case 'BALANCED': return 'secondary';
    default:         return 'outline';
  }
}

function coverageTooltip(ratio: number | null): string {
  if (ratio === null) return 'No data';
  if (ratio < 1.0) return `${(ratio * 100).toFixed(0)}% — below demand`;
  if (ratio < 1.3) return `${(ratio * 100).toFixed(0)}% — balanced`;
  return `${(ratio * 100).toFixed(0)}% — surplus`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  title, value, sub, icon: Icon, color,
}: {
  title: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
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

function HeatmapCell({ ratio, quadrant }: { ratio: number | null; quadrant: Quadrant }) {
  const intensity = ratio === null ? 0 : Math.min(1, ratio / 2);
  const bg = quadrantColor(quadrant);
  return (
    <div
      className={cn('h-5 w-5 rounded-sm cursor-default', bg)}
      style={{ opacity: 0.3 + 0.7 * intensity }}
      title={coverageTooltip(ratio)}
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LicenseOptimizerPage() {
  const { profile, roles } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<'historical' | 'forward'>('historical');
  const [filterState, setFilterState] = useState('');
  const [filterProvider, setFilterProvider] = useState('');

  const { data: snapshots = [], isLoading, refetch, isRefetching } = useSnapshots(view);
  const { data: lastSync } = useSyncRuns();
  const { data: activeStates = new Set() } = useStateActivation();

  const userRole = roles.includes('admin') ? 'admin'
    : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  // ── Derived data ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = snapshots;
    if (filterState) rows = rows.filter(s => s.state_abbreviation === filterState.toUpperCase());
    if (filterProvider) {
      const term = filterProvider.toLowerCase();
      rows = rows.filter(s => providerDisplayName(s).toLowerCase().includes(term));
    }
    return rows;
  }, [snapshots, filterState, filterProvider]);

  // Unique states and dates in filtered set
  const states = useMemo(() =>
    [...new Set(filtered.map(s => s.state_abbreviation))].sort(),
    [filtered]);

  const dates = useMemo(() =>
    [...new Set(filtered.map(s => s.snapshot_date))].sort().slice(-14),
    [filtered]);

  // Heatmap: state → date → dominant quadrant + avg coverage
  const heatmapData = useMemo(() => {
    const map = new Map<string, Map<string, { ratio: number | null; quadrant: Quadrant }>>();
    for (const s of filtered) {
      if (!map.has(s.state_abbreviation)) map.set(s.state_abbreviation, new Map());
      const dateMap = map.get(s.state_abbreviation)!;
      const existing = dateMap.get(s.snapshot_date);
      if (!existing) {
        dateMap.set(s.snapshot_date, { ratio: s.coverage_ratio, quadrant: s.quadrant });
      } else {
        // Average coverage ratios from multiple providers
        const avgRatio = (existing.ratio ?? 0) + (s.coverage_ratio ?? 0);
        dateMap.set(s.snapshot_date, { ratio: avgRatio / 2, quadrant: s.quadrant });
      }
    }
    return map;
  }, [filtered]);

  // KPIs
  const kpis = useMemo(() => {
    const deficitCount = [...new Set(filtered.filter(s => s.quadrant === 'DEFICIT').map(s => s.state_abbreviation))].length;
    const surplusCount = [...new Set(filtered.filter(s => s.quadrant === 'SURPLUS').map(s => s.state_abbreviation))].length;
    const wastedHours = filtered.filter(s => s.wasted_flag).reduce((sum, s) => sum + (s.allocated_hours ?? 0), 0);
    const avgSla = filtered.reduce((sum, s) => sum + (s.sla_pct ?? 0), 0) / (filtered.filter(s => s.sla_pct !== null).length || 1);
    return { deficitCount, surplusCount, wastedHours, avgSla };
  }, [filtered]);

  // Wasted hours by provider
  const wastedByProvider = useMemo(() => {
    const map = new Map<string, { name: string; hours: number; states: Set<string> }>();
    for (const s of filtered.filter(s => s.wasted_flag)) {
      const name = providerDisplayName(s);
      if (!map.has(s.profile_id)) map.set(s.profile_id, { name, hours: 0, states: new Set() });
      const entry = map.get(s.profile_id)!;
      entry.hours += s.allocated_hours ?? 0;
      entry.states.add(s.state_abbreviation);
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours).slice(0, 10);
  }, [filtered]);

  // Recommendations from DEFICIT/SURPLUS patterns
  const recommendations = useMemo(() => {
    const deficitStates = new Set(filtered.filter(s => s.quadrant === 'DEFICIT').map(s => s.state_abbreviation));
    const surplusStates = new Set(filtered.filter(s => s.quadrant === 'SURPLUS').map(s => s.state_abbreviation));

    // Group by provider: which states they cover, their avg allocated hours in surplus states
    const providerInfo = new Map<string, { name: string; surplusHours: number; surplusStates: string[] }>();
    for (const s of filtered) {
      if (!providerInfo.has(s.profile_id)) {
        providerInfo.set(s.profile_id, { name: providerDisplayName(s), surplusHours: 0, surplusStates: [] });
      }
      const info = providerInfo.get(s.profile_id)!;
      if (s.quadrant === 'SURPLUS' && s.allocated_hours) {
        info.surplusHours += s.allocated_hours;
        if (!info.surplusStates.includes(s.state_abbreviation)) {
          info.surplusStates.push(s.state_abbreviation);
        }
      }
    }

    const recs: { type: 'ACTIVATE' | 'DEACTIVATE'; provider: string; state: string; impact: number; rationale: string }[] = [];
    for (const [, info] of providerInfo) {
      if (info.surplusHours > 0 && info.surplusStates.length > 0) {
        for (const surplusState of info.surplusStates) {
          if (deficitStates.size > 0) {
            recs.push({
              type: 'DEACTIVATE',
              provider: info.name,
              state: surplusState,
              impact: Math.round(info.surplusHours * 10) / 10,
              rationale: `Hours in ${surplusState} (SURPLUS) could be redistributed to ${[...deficitStates].slice(0, 3).join(', ')}`,
            });
          }
        }
      }
    }

    return recs.sort((a, b) => b.impact - a.impact).slice(0, 15);
  }, [filtered]);

  // ── Trigger sync ────────────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-homebase`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Homebase sync complete' });
      queryClient.invalidateQueries({ queryKey: ['homebase_sync_runs'] });
      queryClient.invalidateQueries({ queryKey: ['license_optimizer_snapshots'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Sync failed', description: err.message, variant: 'destructive' });
    },
  });

  const computeMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compute-license-utilization`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (result) => {
      toast({ title: `Optimization computed`, description: `${result.snapshots_written} snapshots written` });
      queryClient.invalidateQueries({ queryKey: ['license_optimizer_snapshots'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Compute failed', description: err.message, variant: 'destructive' });
    },
  });

  // ── CSV upload handler ──────────────────────────────────────────────────────
  const handleCsvUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    endpoint: string,
    buildBody: (rows: string[][]) => object
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const [header, ...dataRows] = text.trim().split('\n');
    const cols = header.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const rows = dataRows.map(line =>
      line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    ).map(vals => Object.fromEntries(cols.map((c, i) => [c, vals[i]])));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildBody(rows as any)),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      toast({ title: `Imported ${result.inserted} rows`, description: result.errors?.length ? `${result.errors.length} rows skipped` : undefined });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    }
    e.target.value = '';
  };

  const lastSyncTime = lastSync?.finished_at
    ? new Date(lastSync.finished_at).toLocaleString()
    : 'Never';

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

          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">License Optimizer</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Supply vs. demand across active markets · last Homebase sync: {lastSyncTime}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline" size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                {syncMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <RefreshCw className="h-4 w-4 mr-2" />}
                Sync Homebase
              </Button>
              <Button
                size="sm"
                onClick={() => computeMutation.mutate()}
                disabled={computeMutation.isPending}
              >
                {computeMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <Zap className="h-4 w-4 mr-2" />}
                Recompute
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {/* View toggle */}
          <Tabs value={view} onValueChange={v => setView(v as 'historical' | 'forward')}>
            <TabsList>
              <TabsTrigger value="historical">
                <Clock className="h-4 w-4 mr-1.5" /> Historical
              </TabsTrigger>
              <TabsTrigger value="forward">
                <TrendingUp className="h-4 w-4 mr-1.5" /> Forward
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Deficit states"
              value={String(kpis.deficitCount)}
              sub="coverage < 100%"
              icon={TrendingDown}
              color="bg-red-500"
            />
            <KpiCard
              title="Surplus states"
              value={String(kpis.surplusCount)}
              sub="coverage ≥ 130%"
              icon={TrendingUp}
              color="bg-blue-500"
            />
            <KpiCard
              title="Wasted hrs/day"
              value={kpis.wastedHours.toFixed(1)}
              sub="into surplus/inactive states"
              icon={AlertTriangle}
              color="bg-amber-500"
            />
            <KpiCard
              title="Avg SLA attainment"
              value={`${kpis.avgSla.toFixed(1)}%`}
              sub="target ≥ 95%"
              icon={BarChart3}
              color={kpis.avgSla >= 95 ? 'bg-emerald-500' : kpis.avgSla >= 85 ? 'bg-amber-500' : 'bg-red-500'}
            />
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <Input
              placeholder="Filter by state (e.g. PA)"
              value={filterState}
              onChange={e => setFilterState(e.target.value)}
              className="w-40"
            />
            <Input
              placeholder="Filter by provider name"
              value={filterProvider}
              onChange={e => setFilterProvider(e.target.value)}
              className="w-56"
            />
          </div>

          {/* Heatmap */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                Coverage heatmap
                <span className="flex items-center gap-1 ml-auto text-xs font-normal text-muted-foreground">
                  <span className="h-3 w-3 rounded-sm bg-red-500 inline-block" /> Deficit
                  <span className="h-3 w-3 rounded-sm bg-emerald-500 inline-block ml-2" /> Balanced
                  <span className="h-3 w-3 rounded-sm bg-blue-400 inline-block ml-2" /> Surplus
                  <span className="h-3 w-3 rounded-sm bg-amber-400 inline-block ml-2" /> Anomaly
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : states.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No data yet. Click <strong>Sync Homebase</strong> then <strong>Recompute</strong> to populate.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs border-separate border-spacing-0.5">
                    <thead>
                      <tr>
                        <th className="text-left pr-3 py-1 font-medium text-muted-foreground w-12">State</th>
                        {dates.map(d => (
                          <th key={d} className="font-normal text-muted-foreground px-0.5" title={d}>
                            {d.slice(5)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {states.map(state => (
                        <tr key={state}>
                          <td className="pr-3 py-0.5 font-medium text-xs">
                            <span className="flex items-center gap-1">
                              {state}
                              {activeStates.has(state) && (
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Active market" />
                              )}
                            </span>
                          </td>
                          {dates.map(date => {
                            const cell = heatmapData.get(state)?.get(date);
                            return (
                              <td key={date} className="px-0.5 py-0.5">
                                <HeatmapCell
                                  ratio={cell?.ratio ?? null}
                                  quadrant={cell?.quadrant ?? 'UNKNOWN'}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Wasted hours panel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Wasted hours (SURPLUS states)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {wastedByProvider.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No wasted hours detected.</p>
                ) : (
                  <div className="space-y-3">
                    {wastedByProvider.map(p => (
                      <div key={p.name} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{[...p.states].join(', ')}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-amber-600">
                            {p.hours.toFixed(1)} hrs/day
                          </p>
                          <Progress value={Math.min(100, p.hours * 10)} className="h-1 w-20" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recommendations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Optimization recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recommendations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recommendations available.</p>
                ) : (
                  <div className="space-y-2">
                    {recommendations.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg border bg-card text-sm">
                        <Badge
                          variant={r.type === 'ACTIVATE' ? 'secondary' : 'outline'}
                          className="shrink-0 mt-0.5 text-xs"
                        >
                          {r.type === 'ACTIVATE'
                            ? <><CheckCircle2 className="h-3 w-3 mr-1" />Activate</>
                            : <><XCircle className="h-3 w-3 mr-1" />Deactivate</>}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{r.provider} · {r.state}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{r.rationale}</p>
                        </div>
                        <span className="text-xs font-semibold text-primary shrink-0">
                          {r.impact.toFixed(1)} hrs
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* State detail table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">State-level detail</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-4">State</th>
                      <th className="text-left py-2 pr-4">Date</th>
                      <th className="text-right py-2 pr-4">Supply hrs</th>
                      <th className="text-right py-2 pr-4">Demand hrs</th>
                      <th className="text-right py-2 pr-4">Coverage</th>
                      <th className="text-right py-2 pr-4">SLA %</th>
                      <th className="text-left py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 100).map((s, i) => (
                      <tr key={i} className={cn('border-b last:border-0', s.wasted_flag && 'bg-amber-50/40')}>
                        <td className="py-2 pr-4 font-medium">{s.state_abbreviation}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{s.snapshot_date}</td>
                        <td className="py-2 pr-4 text-right">{s.allocated_hours?.toFixed(1) ?? '—'}</td>
                        <td className="py-2 pr-4 text-right">{s.estimated_demand_hours?.toFixed(1) ?? '—'}</td>
                        <td className="py-2 pr-4 text-right">
                          {s.coverage_ratio !== null
                            ? `${(s.coverage_ratio * 100).toFixed(0)}%`
                            : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {s.sla_pct !== null ? `${s.sla_pct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2">
                          <Badge variant={quadrantBadgeVariant(s.quadrant)} className="text-xs">
                            {s.quadrant}
                          </Badge>
                          {s.wasted_flag && (
                            <Badge variant="outline" className="text-xs ml-1 text-amber-600 border-amber-300">
                              wasted
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filtered.length > 100 && (
                      <tr>
                        <td colSpan={7} className="py-2 text-xs text-muted-foreground text-center">
                          Showing 100 of {filtered.length} rows. Use filters to narrow results.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* CSV upload section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4" /> Upload CSV data
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Export your .numbers files as CSV and upload here. After uploading all files, click
                <strong> Recompute</strong> to refresh the optimizer.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                <CsvUploadCard
                  label="Leftover slots (historical)"
                  columns="state, date, slots"
                  onChange={e => handleCsvUpload(e, 'import-leftover-slots', rows =>
                    ({ rows: rows.map((r: any) => ({ state: r.state, date: r['date_actual: Day'] || r.date, slots: r['Sum of same_next_day_available_slots'] || r.slots })), window_type: 'historical' })
                  )}
                />

                <CsvUploadCard
                  label="Leftover slots (forecast)"
                  columns="state, date, slots"
                  onChange={e => handleCsvUpload(e, 'import-leftover-slots', rows =>
                    ({ rows: rows.map((r: any) => ({ state: r.state, date: r['date_actual: Day'] || r.date, slots: r['Sum of same_next_day_available_slots'] || r.slots })), window_type: 'forecast' })
                  )}
                />

                <CsvUploadCard
                  label="SLA attainment (long window)"
                  columns="State, SLA Attainment Rate"
                  onChange={e => handleCsvUpload(e, 'import-sla-attainment', rows =>
                    ({ rows: rows.map((r: any) => ({ state: r.State || r.state, sla: r['SLA Attainment Rate'] || r.sla })), window_label: 'feb2026_current' })
                  )}
                />

                <CsvUploadCard
                  label="SLA attainment (past 2 weeks)"
                  columns="State, SLA Attainment Rate"
                  onChange={e => handleCsvUpload(e, 'import-sla-attainment', rows =>
                    ({ rows: rows.map((r: any) => ({ state: r.State || r.state, sla: r['SLA Attainment Rate'] || r.sla })), window_label: 'past_2_weeks' })
                  )}
                />

                <CsvUploadCard
                  label="Provider utilization (14 days)"
                  columns="Provider, Total Timeslots, Avg Time Slot Utilization"
                  onChange={e => {
                    const today = new Date().toISOString().slice(0, 10);
                    const start = new Date(); start.setDate(start.getDate() - 14);
                    handleCsvUpload(e, 'import-provider-utilization', rows =>
                      ({
                        rows: rows.map((r: any) => ({
                          provider: r.Provider || r.provider,
                          total_timeslots: r['Total Timeslots'] || r.total_timeslots,
                          avg_utilization: r['Avg Time Slot Utilization'] || r.avg_utilization,
                        })),
                        window_start: start.toISOString().slice(0, 10),
                        window_end: today,
                      })
                    );
                  }}
                />

                <CsvUploadCard
                  label="Daily utilization rate"
                  columns="Period, %"
                  onChange={e => handleCsvUpload(e, 'import-utilization-daily', rows =>
                    ({ rows: rows.map((r: any) => ({ date: r.Period || r.period || r.date, pct: r['%'] || r.pct })) })
                  )}
                />
              </div>
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}

function CsvUploadCard({
  label, columns, onChange,
}: {
  label: string; columns: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 p-3 border rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{columns}</span>
      <input type="file" accept=".csv" className="hidden" onChange={onChange} />
      <span className="flex items-center gap-1 text-xs text-primary mt-1">
        <Upload className="h-3 w-3" /> Upload CSV
      </span>
    </label>
  );
}
