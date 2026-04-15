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
    queryFn: async (): Promise<Snapshot[]> => {
      const query = supabase
        .from('license_optimization_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: true })
        .limit(2000);

      if (view === 'historical') {
        query.lte('snapshot_date', today);
      } else {
        query.gte('snapshot_date', today);
      }

      const { data, error } = await query;
      if (error) throw error;

      const snapshots: Snapshot[] = (data ?? []) as Snapshot[];
      const profileIds = [...new Set(snapshots.map((row) => row.profile_id).filter(Boolean))] as string[];

      if (profileIds.length === 0) {
        return snapshots;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name')
        .in('id', profileIds);

      if (profilesError) throw profilesError;

      const profilesById = new Map<string, NonNullable<Snapshot['profiles']>>(
        (profiles ?? []).map((profile: any) => [
          profile.id,
          {
            full_name: profile.full_name ?? null,
            first_name: profile.first_name ?? null,
            last_name: profile.last_name ?? null,
          },
        ])
      );

      return snapshots.map<Snapshot>((snapshot) => ({
        ...snapshot,
        profiles: profilesById.get(snapshot.profile_id),
      }));
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
      const { data, error } = await supabase.functions.invoke('sync-homebase', {
        method: 'POST',
      });
      if (error) throw error;
      return data;
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
      const { data, error } = await supabase.functions.invoke('compute-license-utilization', {
        method: 'POST',
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      toast({ title: `Optimization computed`, description: `${result.snapshots_written} snapshots written` });
      queryClient.invalidateQueries({ queryKey: ['license_optimizer_snapshots'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Compute failed', description: err.message, variant: 'destructive' });
    },
  });

  // ── Smart CSV upload — auto-detects file type from headers ─────────────────
  const [uploadStatuses, setUploadStatuses] = useState<{ name: string; status: 'uploading' | 'done' | 'error'; msg: string }[]>([]);

  const parseCSV = (text: string) => {
    const [header, ...dataRows] = text.trim().split('\n');
    // Auto-detect delimiter: tab wins if more tabs than commas in header
    const delim = (header.match(/\t/g) || []).length >= (header.match(/,/g) || []).length ? '\t' : ',';
    const cols = header.split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
    return { cols, rows: dataRows.map(line =>
      line.split(delim).map(v => v.trim().replace(/^"|"$/g, ''))
    ).map(vals => Object.fromEntries(cols.map((c, i) => [c, vals[i]]))) };
  };

  const detectAndUpload = async (file: File): Promise<{ name: string; status: 'done' | 'error'; msg: string }> => {
    // Normalize line endings explicitly before parsing
    const raw = await file.text();
    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const { cols, rows } = parseCSV(text);

    // Helper: check if any column partially matches a keyword (case-insensitive)
    const has = (...keywords: string[]) =>
      keywords.every(kw => cols.some(c => c.toLowerCase().includes(kw.toLowerCase())));
    const hasAny = (...keywords: string[]) =>
      keywords.some(kw => cols.some(c => c.toLowerCase().includes(kw.toLowerCase())));

    // Helper: find the actual column name that contains a keyword
    const col = (kw: string) => cols.find(c => c.toLowerCase().includes(kw.toLowerCase())) ?? '';

    const today = new Date().toISOString().slice(0, 10);
    const start14 = new Date(); start14.setDate(start14.getDate() - 14);
    const fname = file.name.toLowerCase();

    let endpoint = '';
    let body: object = {};

    // Utility: get value from row using first column whose name contains keyword
    const val = (r: any, ...kws: string[]) => {
      for (const kw of kws) {
        const k = cols.find(c => c.toLowerCase().includes(kw.toLowerCase()));
        if (k && r[k] !== undefined && r[k] !== '') return r[k];
      }
      // Fallback: return values by position based on which file type this is
      return undefined;
    };

    // Detect by filename first (most reliable for Metabase generic column names),
    // then fall back to column content matching.
    const isProvider    = fname.includes('provider') || fname.includes('utilization') && fname.includes('last');
    const isSlaLong     = fname.includes('feb') || (fname.includes('current') && fname.includes('sla'));
    const isSlaShort    = fname.includes('2 week') || fname.includes('2week') || fname.includes('past') && fname.includes('week');
    const isForecast    = fname.includes('future') || fname.includes('forecast') || fname.includes('next_day') && fname.includes('available');
    const isLeftover    = fname.includes('leftover') || fname.includes('visit') || (fname.includes('available') && !isForecast);
    const isDailyUtil   = fname.includes('utilization') && (fname.includes('month') || fname.includes('rate') || fname.includes('booking'));
    // SLA attainment: filename contains sla OR "same day" without "available" pattern
    const isSla         = fname.includes('sla') || fname.includes('attainment') || isSlaLong || isSlaShort;

    if (isProvider && !isSla) {
      endpoint = 'import-provider-utilization';
      body = {
        rows: rows.map((r: any) => ({
          provider: val(r, 'provider', 'name') ?? Object.values(r)[0],
          total_timeslots: val(r, 'timeslot', 'total', 'slot') ?? Object.values(r)[1],
          avg_utilization: val(r, 'utilization', 'avg', 'rate') ?? Object.values(r)[2],
        })),
        window_start: start14.toISOString().slice(0, 10),
        window_end: today,
      };
    } else if (isSla) {
      endpoint = 'import-sla-attainment';
      body = {
        rows: rows.map((r: any) => ({
          state: val(r, 'state') ?? Object.values(r)[0],
          sla: val(r, 'sla', 'attainment', 'rate', '%') ?? Object.values(r)[1],
        })),
        window_label: (isSlaShort && !isSlaLong) ? 'past_2_weeks' : 'feb2026_current',
      };
    } else if (isForecast || isLeftover) {
      endpoint = 'import-leftover-slots';
      body = {
        rows: rows.map((r: any) => ({
          state: val(r, 'state') ?? Object.values(r)[0],
          date: val(r, 'date', 'day', 'period', 'time') ?? Object.values(r)[1],
          slots: val(r, 'available', 'slot', 'same_next', 'count', 'sum') ?? Object.values(r)[2],
        })),
        window_type: isForecast ? 'forecast' : 'historical',
      };
    } else if (isDailyUtil) {
      endpoint = 'import-utilization-daily';
      body = {
        rows: rows.map((r: any) => ({
          date: val(r, 'date', 'period', 'time', 'day') ?? Object.values(r)[0],
          pct: val(r, '%', 'pct', 'utilization', 'rate', 'booking') ?? Object.values(r)[1],
        })),
      };
    } else {
      // Last resort: try column-content matching
      if (has('provider') && has('timeslot')) {
        endpoint = 'import-provider-utilization';
        body = { rows: rows.map((r: any) => ({ provider: val(r, 'provider'), total_timeslots: val(r, 'timeslot'), avg_utilization: val(r, 'utilization', 'avg') })), window_start: start14.toISOString().slice(0, 10), window_end: today };
      } else if (has('sla') || has('attainment')) {
        endpoint = 'import-sla-attainment';
        body = { rows: rows.map((r: any) => ({ state: val(r, 'state') ?? Object.values(r)[0], sla: val(r, 'sla', 'attainment') ?? Object.values(r)[1] })), window_label: 'past_2_weeks' };
      } else {
        return { name: file.name, status: 'error', msg: `Could not identify file. Rename it to include: "provider", "leftover", "future", "sla", "feb2026", or "utilization". Columns: ${cols.slice(0,4).join(' | ')}` };
      }
    }

    try {
      const { data: result, error } = await supabase.functions.invoke(endpoint, { method: 'POST', body });
      if (error) throw error;
      return { name: file.name, status: 'done', msg: `${result.inserted ?? '?'} rows imported` };
    } catch (err: any) {
      return { name: file.name, status: 'error', msg: err.message };
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadStatuses(files.map(f => ({ name: f.name, status: 'uploading', msg: 'Uploading…' })));
    const results = await Promise.all(files.map(detectAndUpload));
    setUploadStatuses(results);
    const ok = results.filter(r => r.status === 'done').length;
    const fail = results.filter(r => r.status === 'error').length;
    toast({
      title: `${ok} file${ok !== 1 ? 's' : ''} imported${fail ? `, ${fail} failed` : ''}`,
      description: fail ? 'Check the upload panel for details.' : 'Click Recompute to refresh the heatmap.',
      variant: fail && !ok ? 'destructive' : 'default',
    });
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

          {/* CSV upload section — single multi-file uploader */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Upload className="h-4 w-4" /> Upload data files
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Export your <strong>.numbers</strong> files as CSV (File → Export → CSV in Numbers),
                then select <strong>all of them at once</strong> below. The system auto-detects which
                file is which. After uploading, click <strong>Recompute</strong>.
              </p>

              <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Click to select all 6 CSV files at once</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    leftover visits (×2) · SLA attainment (×2) · provider utilization · daily utilization
                  </p>
                </div>
                <input
                  type="file"
                  accept=".csv"
                  multiple
                  className="hidden"
                  onChange={handleBulkUpload}
                />
              </label>

              {uploadStatuses.length > 0 && (
                <div className="space-y-2">
                  {uploadStatuses.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm p-2 rounded-md bg-muted/40">
                      {s.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                      {s.status === 'done'      && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                      {s.status === 'error'     && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <span className="flex-1 truncate font-medium">{s.name}</span>
                      <span className={cn('text-xs shrink-0', s.status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                        {s.msg}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}

