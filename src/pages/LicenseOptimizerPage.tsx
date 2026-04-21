import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { cn, downloadCSV } from '@/lib/utils';
import { InfoTooltip } from '@/components/InfoTooltip';
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
  Download,
  Info,
  ChevronDown,
  ArrowRight,
  PlusCircle,
  Search,
} from 'lucide-react';
import { isNPProhibitedState } from '@/constants/stateRestrictions';

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
    queryKey: ['license_optimizer_snapshots', view, today],
    queryFn: async (): Promise<Snapshot[]> => {
      const query = supabase
        .from('license_optimization_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: false })
        .limit(2000);

      if (view === 'historical') {
        // Recent past only — 7 days back is enough context
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        query
          .lte('snapshot_date', today)
          .gte('snapshot_date', weekAgo.toISOString().slice(0, 10));
      } else {
        // Today + next 7 days — only actionable reallocation window
        const weekAhead = new Date();
        weekAhead.setDate(weekAhead.getDate() + 7);
        query
          .gte('snapshot_date', today)
          .lte('snapshot_date', weekAhead.toISOString().slice(0, 10));
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

/**
 * All inactive provider licenses with provider names.
 * Used to power "Activate existing license" recommendations.
 */
function useInactiveLicenses() {
  return useQuery({
    queryKey: ['inactive_provider_licenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_licenses')
        .select('profile_id, state_abbreviation, status')
        .in('status', ['inactive', 'pending']);
      if (error) throw error;
      // profile_id → Set<state>
      const byProvider = new Map<string, Set<string>>();
      for (const row of (data ?? [])) {
        if (!row.profile_id || !row.state_abbreviation) continue;
        if (!byProvider.has(row.profile_id)) byProvider.set(row.profile_id, new Set());
        byProvider.get(row.profile_id)!.add(row.state_abbreviation);
      }
      return byProvider;
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
  title, value, sub, icon: Icon, color, tooltip,
}: {
  title: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
  tooltip?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={cn('rounded-lg p-2', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
            {title}
            {tooltip && <InfoTooltip label={`About: ${title}`}>{tooltip}</InfoTooltip>}
          </p>
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
  const [showGuide, setShowGuide] = useState(false);

  const { data: snapshots = [], isLoading, refetch, isRefetching } = useSnapshots(view);
  const { data: lastSync } = useSyncRuns();
  const { data: activeStates = new Set() } = useStateActivation();
  const { data: inactiveLicenses = new Map<string, Set<string>>() } = useInactiveLicenses();

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

  // Heatmap: state → date → coverage ratio + dominant quadrant.
  //
  // CORRECTNESS: Coverage ratio is non-linear, so averaging per-provider ratios
  // is wrong (e.g. provider A=0.5 + provider B=2.0 averaged = 1.25 "balanced",
  // but the state is genuinely simultaneously deficit and surplus on a per-
  // provider basis). Aggregate supply (allocated_hours) and demand
  // (estimated_demand_hours) separately per (state, date), then compute one
  // ratio. Quadrant is chosen by hour-weighted majority across the day's
  // provider snapshots so a single low-hour provider can't dominate.
  const heatmapData = useMemo(() => {
    type Bucket = {
      supply: number;
      demand: number;
      hasDemand: boolean;
      quadrantHours: Record<string, number>;
    };
    const buckets = new Map<string, Map<string, Bucket>>();

    for (const s of filtered) {
      if (!buckets.has(s.state_abbreviation)) buckets.set(s.state_abbreviation, new Map());
      const dateMap = buckets.get(s.state_abbreviation)!;
      let bucket = dateMap.get(s.snapshot_date);
      if (!bucket) {
        bucket = { supply: 0, demand: 0, hasDemand: false, quadrantHours: {} };
        dateMap.set(s.snapshot_date, bucket);
      }
      const supply = s.allocated_hours ?? 0;
      bucket.supply += supply;
      if (s.estimated_demand_hours !== null && s.estimated_demand_hours !== undefined) {
        bucket.demand += s.estimated_demand_hours;
        bucket.hasDemand = true;
      }
      // Weight quadrant vote by allocated hours (fall back to 1 so non-shift
      // snapshots still contribute something).
      const w = supply > 0 ? supply : 1;
      bucket.quadrantHours[s.quadrant] = (bucket.quadrantHours[s.quadrant] ?? 0) + w;
    }

    const map = new Map<string, Map<string, { ratio: number | null; quadrant: Quadrant }>>();
    for (const [state, dateMap] of buckets) {
      const out = new Map<string, { ratio: number | null; quadrant: Quadrant }>();
      for (const [date, b] of dateMap) {
        const ratio = b.hasDemand && b.demand > 0
          ? b.supply / b.demand
          : (b.hasDemand ? null : null);
        const quadrant = (Object.entries(b.quadrantHours)
          .sort((a, x) => x[1] - a[1])[0]?.[0] ?? 'UNKNOWN') as Quadrant;
        out.set(date, { ratio, quadrant });
      }
      map.set(state, out);
    }
    return map;
  }, [filtered]);

  // KPIs
  // State-level detail rows: aggregate per (state, date) so "Supply hrs" reflects
  // the entire state's daily capacity (sum across providers), not a single
  // provider's even-split slice. Coverage is recomputed from totals; SLA and
  // quadrant come from the per-state values (identical across providers in a
  // given day, but we take the hour-weighted majority quadrant for safety).
  type StateDetailRow = {
    state_abbreviation: string;
    snapshot_date: string;
    allocated_hours: number;
    estimated_demand_hours: number | null;
    coverage_ratio: number | null;
    sla_pct: number | null;
    quadrant: Quadrant;
    wasted_flag: boolean;
    provider_count: number;
  };
  const stateDetailRows = useMemo<StateDetailRow[]>(() => {
    type Bucket = {
      supply: number;
      demand: number;
      hasDemand: boolean;
      slaSum: number;
      slaCount: number;
      quadrantHours: Record<string, number>;
      wasted: boolean;
      providers: Set<string>;
    };
    const buckets = new Map<string, Bucket>();
    for (const s of filtered) {
      const key = `${s.state_abbreviation}|${s.snapshot_date}`;
      let b = buckets.get(key);
      if (!b) {
        b = { supply: 0, demand: 0, hasDemand: false, slaSum: 0, slaCount: 0, quadrantHours: {}, wasted: false, providers: new Set() };
        buckets.set(key, b);
      }
      const supply = s.allocated_hours ?? 0;
      b.supply += supply;
      if (s.estimated_demand_hours != null) {
        b.demand += s.estimated_demand_hours;
        b.hasDemand = true;
      }
      if (s.sla_pct != null) { b.slaSum += s.sla_pct; b.slaCount += 1; }
      const w = supply > 0 ? supply : 1;
      b.quadrantHours[s.quadrant] = (b.quadrantHours[s.quadrant] ?? 0) + w;
      if (s.wasted_flag) b.wasted = true;
      b.providers.add(s.profile_id);
    }
    const rows: StateDetailRow[] = [];
    for (const [key, b] of buckets) {
      const [state, date] = key.split('|');
      const quadrant = (Object.entries(b.quadrantHours).sort((a, x) => x[1] - a[1])[0]?.[0] ?? 'UNKNOWN') as Quadrant;
      const ratio = b.hasDemand && b.demand > 0 ? b.supply / b.demand : null;
      rows.push({
        state_abbreviation: state,
        snapshot_date: date,
        allocated_hours: b.supply,
        estimated_demand_hours: b.hasDemand ? b.demand : null,
        coverage_ratio: ratio,
        sla_pct: b.slaCount > 0 ? b.slaSum / b.slaCount : null,
        quadrant,
        wasted_flag: b.wasted,
        provider_count: b.providers.size,
      });
    }
    return rows.sort((a, b) =>
      a.snapshot_date.localeCompare(b.snapshot_date) ||
      a.state_abbreviation.localeCompare(b.state_abbreviation),
    );
  }, [filtered]);

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

  // ── Smarter recommendations ────────────────────────────────────────────────
  // Produces 4 typed action items, each with a concrete next step:
  //   1. ACTIVATE     — provider has inactive license in DEFICIT state → activate it
  //   2. APPLY_LICENSE — DEFICIT state with no surplus provider holds inactive license → apply for new
  //   3. REDUCE       — provider holds 4+ surplus-state licenses → drop the lowest-demand one
  //   4. ANOMALY      — low SLA but high unfilled slots → likely data-quality or routing bug
  // Sorted by impact_hours/day, NP-prohibited states are filtered out for NP recos.
  type RecKind = 'ACTIVATE' | 'APPLY_LICENSE' | 'REDUCE' | 'ANOMALY';
  interface Rec {
    kind: RecKind;
    provider: string;          // e.g. provider name OR "—" for state-level recos
    profile_id?: string;
    state: string;
    impact: number;            // hrs/day routed or freed
    rationale: string;         // why this matters
    nextStep: string;          // concrete CTA
    metric?: string;           // optional secondary metric (e.g. "SLA 72%")
  }

  const recommendations = useMemo<Rec[]>(() => {
    if (filtered.length === 0) return [];

    // Aggregate quadrant by state (majority across days)
    const stateQuadrantCounts = new Map<string, Record<string, number>>();
    const stateAvgDemand = new Map<string, { sum: number; n: number }>();
    const stateAvgSla = new Map<string, { sum: number; n: number }>();
    const stateAvgUnfilled = new Map<string, { sum: number; n: number }>();
    for (const s of filtered) {
      const st = s.state_abbreviation;
      if (!stateQuadrantCounts.has(st)) stateQuadrantCounts.set(st, {});
      const counts = stateQuadrantCounts.get(st)!;
      counts[s.quadrant] = (counts[s.quadrant] ?? 0) + 1;

      if (s.estimated_demand_hours != null) {
        const cur = stateAvgDemand.get(st) ?? { sum: 0, n: 0 };
        stateAvgDemand.set(st, { sum: cur.sum + s.estimated_demand_hours, n: cur.n + 1 });
      }
      if (s.sla_pct != null) {
        const cur = stateAvgSla.get(st) ?? { sum: 0, n: 0 };
        stateAvgSla.set(st, { sum: cur.sum + s.sla_pct, n: cur.n + 1 });
      }
      if (s.unfilled_slots != null) {
        const cur = stateAvgUnfilled.get(st) ?? { sum: 0, n: 0 };
        stateAvgUnfilled.set(st, { sum: cur.sum + s.unfilled_slots, n: cur.n + 1 });
      }
    }
    const stateQuadrant = new Map<string, Quadrant>();
    for (const [st, counts] of stateQuadrantCounts) {
      const dom = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'BALANCED') as Quadrant;
      stateQuadrant.set(st, dom);
    }
    const avg = (m: Map<string, { sum: number; n: number }>, k: string) => {
      const v = m.get(k);
      return v && v.n ? v.sum / v.n : null;
    };

    const deficitStates = [...stateQuadrant.entries()]
      .filter(([, q]) => q === 'DEFICIT')
      .sort((a, b) => (avg(stateAvgDemand, b[0]) ?? 0) - (avg(stateAvgDemand, a[0]) ?? 0))
      .map(([s]) => s);

    // Per-provider footprint: avg daily allocated hours per state
    const providerStateHours = new Map<string, Map<string, { hours: number; days: number; quadrant: Quadrant }>>();
    const providerNames = new Map<string, string>();
    for (const s of filtered) {
      if (!providerStateHours.has(s.profile_id)) providerStateHours.set(s.profile_id, new Map());
      providerNames.set(s.profile_id, providerDisplayName(s));
      const stMap = providerStateHours.get(s.profile_id)!;
      const cur = stMap.get(s.state_abbreviation) ?? { hours: 0, days: 0, quadrant: s.quadrant };
      stMap.set(s.state_abbreviation, {
        hours: cur.hours + (s.allocated_hours ?? 0),
        days: cur.days + 1,
        quadrant: s.quadrant,
      });
    }

    const recs: Rec[] = [];

    // 1️⃣ ACTIVATE — provider has inactive license in a DEFICIT state
    for (const [profileId, inactiveStates] of inactiveLicenses) {
      const name = providerNames.get(profileId);
      if (!name) continue; // provider not in current snapshot window
      const stMap = providerStateHours.get(profileId)!;
      const activeCount = [...stMap.keys()].filter(s => activeStates.has(s)).length || 1;
      const totalHours = [...stMap.values()].reduce((sum, v) => sum + (v.hours / Math.max(v.days, 1)), 0);

      for (const defState of deficitStates) {
        if (!inactiveStates.has(defState)) continue;
        // Skip NP-prohibited states (we can't infer role here, but these are universally MD-only)
        if (isNPProhibitedState(defState)) continue;
        const newCount = activeCount + 1;
        const impact = totalHours / newCount;
        const demandHrs = avg(stateAvgDemand, defState);
        recs.push({
          kind: 'ACTIVATE',
          provider: name,
          profile_id: profileId,
          state: defState,
          impact,
          rationale: `${name} holds an inactive ${defState} license. Activating it routes ~${impact.toFixed(1)} hrs/day to a deficit market${demandHrs ? ` (avg demand ${demandHrs.toFixed(1)} hrs/day)` : ''}.`,
          nextStep: `Open ${name}'s licensure record → mark ${defState} license active`,
          metric: demandHrs ? `${demandHrs.toFixed(1)} hrs/day demand` : undefined,
        });
      }
    }

    // 2️⃣ APPLY_LICENSE — top deficit state with no provider holding ANY (active OR inactive) license
    //     Suggest the 3 highest-bandwidth providers currently in surplus states as candidates.
    const stateHasAnyProviderLicensed = (st: string): boolean => {
      for (const stMap of providerStateHours.values()) {
        if (stMap.has(st)) return true;
      }
      for (const inactiveSet of inactiveLicenses.values()) {
        if (inactiveSet.has(st)) return true;
      }
      return false;
    };

    for (const defState of deficitStates.slice(0, 5)) {
      if (isNPProhibitedState(defState)) continue;
      if (stateHasAnyProviderLicensed(defState)) continue; // already covered above by ACTIVATE
      const demandHrs = avg(stateAvgDemand, defState) ?? 0;
      // Find candidates: providers with at least one SURPLUS state who could be relicensed
      const candidates: { name: string; surplusHrs: number }[] = [];
      for (const [pid, stMap] of providerStateHours) {
        let surplusHrs = 0;
        for (const [st, v] of stMap) {
          if (v.quadrant === 'SURPLUS') surplusHrs += v.hours / Math.max(v.days, 1);
        }
        if (surplusHrs > 0.5) {
          candidates.push({ name: providerNames.get(pid) ?? '—', surplusHrs });
        }
      }
      candidates.sort((a, b) => b.surplusHrs - a.surplusHrs);
      const top3 = candidates.slice(0, 3).map(c => c.name).join(', ') || 'any provider with surplus capacity';
      recs.push({
        kind: 'APPLY_LICENSE',
        provider: '—',
        state: defState,
        impact: demandHrs,
        rationale: `${defState} is in DEFICIT and no Vitable provider holds a license here.${demandHrs ? ` Avg demand ${demandHrs.toFixed(1)} hrs/day is unmet.` : ''}`,
        nextStep: `Submit a new ${defState} license application for: ${top3}`,
        metric: demandHrs ? `${demandHrs.toFixed(1)} hrs/day demand` : undefined,
      });
    }

    // 3️⃣ REDUCE — provider holds 4+ active surplus-state licenses → drop the lowest-demand
    for (const [profileId, stMap] of providerStateHours) {
      const surplusEntries = [...stMap.entries()]
        .filter(([, v]) => v.quadrant === 'SURPLUS')
        .map(([st, v]) => ({
          state: st,
          hoursPerDay: v.hours / Math.max(v.days, 1),
          demandHrs: avg(stateAvgDemand, st) ?? 0,
        }));
      if (surplusEntries.length < 4) continue;
      // Drop the surplus state with the LOWEST demand (safest to release)
      surplusEntries.sort((a, b) => a.demandHrs - b.demandHrs);
      const drop = surplusEntries[0];
      const name = providerNames.get(profileId) ?? '—';
      const activeCount = [...stMap.keys()].filter(s => activeStates.has(s)).length;
      const freed = drop.hoursPerDay;
      recs.push({
        kind: 'REDUCE',
        provider: name,
        profile_id: profileId,
        state: drop.state,
        impact: freed,
        rationale: `${name} is licensed in ${activeCount} states, ${surplusEntries.length} of which are SURPLUS. Dropping ${drop.state} (lowest demand at ${drop.demandHrs.toFixed(1)} hrs/day) reduces renewal/CPA overhead with no coverage impact.`,
        nextStep: `Schedule ${drop.state} license non-renewal for ${name}`,
        metric: `Frees ${freed.toFixed(1)} hrs/day for redistribution`,
      });
    }

    // 4️⃣ ANOMALY — state with low SLA AND high unfilled slots simultaneously (data quality flag)
    for (const [st, q] of stateQuadrant) {
      if (q !== 'ANOMALY') continue;
      const sla = avg(stateAvgSla, st);
      const unfilled = avg(stateAvgUnfilled, st);
      if (sla === null || unfilled === null) continue;
      recs.push({
        kind: 'ANOMALY',
        provider: '—',
        state: st,
        impact: 0, // not directly actionable in hours
        rationale: `${st} shows SLA ${sla.toFixed(0)}% with ${unfilled.toFixed(0)} unfilled slots/day — patients can't book despite open capacity. Likely a routing/availability mismatch, not a license issue.`,
        nextStep: `Audit ${st} routing rules and provider availability windows in Homebase`,
        metric: `SLA ${sla.toFixed(0)}% · ${unfilled.toFixed(0)} unfilled`,
      });
    }

    // Sort: ACTIVATE first (highest impact wins), then APPLY, then REDUCE, then ANOMALY
    const order: Record<RecKind, number> = { ACTIVATE: 0, APPLY_LICENSE: 1, REDUCE: 2, ANOMALY: 3 };
    return recs
      .sort((a, b) => order[a.kind] - order[b.kind] || b.impact - a.impact)
      .slice(0, 20);
  }, [filtered, inactiveLicenses, activeStates]);

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
                  <p className="font-semibold text-foreground">Purpose: evaluate whether each provider's licenses are being used efficiently — identify wasted capacity in over-licensed states and gaps in under-licensed states.</p>
                  <p className="font-medium text-foreground text-muted-foreground">Weekly refresh workflow (takes ~5 min):</p>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">Sync Homebase</span>
                      {' '}(top-right button) — pulls the latest provider schedules and shift hours. Do this first every week. The header shows the last sync timestamp.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Upload your Metabase CSVs</span>
                      {' '}using the upload section at the bottom. Drag all 6 files at once — the system auto-detects each type:{' '}
                      leftover slots (×2), SLA attainment (×2), provider utilization, daily utilization.
                      Rename files to include keywords if auto-detect fails (e.g. "sla_attainment.csv", "leftover_visits.csv").
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Click Recompute</span>
                      {' '}— runs the optimization algorithm against fresh data. The heatmap and KPIs update immediately.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Read the heatmap</span>
                      {' '}— each cell is a provider × state × date combination. Red = DEFICIT (demand exceeds supply). Blue = SURPLUS (too much capacity). Green = BALANCED. Amber = anomaly (data issue). Use "Historical" view for past performance; "Forward" for planning.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Act on recommendations</span>
                      {' '}— the right panel lists specific DEACTIVATE actions (providers in surplus states who should be redirected to deficit states). Share these with your scheduling team.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Review wasted hours</span>
                      {' '}— the left panel shows which providers are burning hours in over-saturated states. These are candidates for reallocation or license expansion into deficit markets.
                    </li>
                  </ol>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Quadrant definitions:</span>
                    {' '}DEFICIT = coverage ratio {'<'} 100% · BALANCED = 100–130% · SURPLUS = {'>'}130% · ANOMALY = missing or inconsistent data (investigate before acting).
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">For leadership:</span>
                    {' '}"Avg SLA attainment" KPI and "Wasted hrs/day" are the headline metrics for efficiency reporting. Export the state-level table for board decks. Filter by a specific state to drill into its providers.
                  </p>
                </AlertDescription>
              </Alert>
            </CollapsibleContent>
          </Collapsible>

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
              tooltip="States where available provider-hours fall short of expected demand. Drives recommendations to add licenses or add providers."
            />
            <KpiCard
              title="Surplus states"
              value={String(kpis.surplusCount)}
              sub="coverage ≥ 130%"
              icon={TrendingUp}
              color="bg-blue-500"
              tooltip="States where we have ≥ 30% more provider-hours than expected demand. Candidates for scaling back licenses or re-routing capacity."
            />
            <KpiCard
              title="Wasted hrs/day"
              value={kpis.wastedHours.toFixed(1)}
              sub="into surplus/inactive states"
              icon={AlertTriangle}
              color="bg-amber-500"
              tooltip="Provider hours/day going into states that don't need them (surplus states or inactive states). Reclaiming these is the optimizer's main lever."
            />
            <KpiCard
              title="Avg SLA attainment"
              value={`${kpis.avgSla.toFixed(1)}%`}
              sub="target ≥ 95%"
              icon={BarChart3}
              color={kpis.avgSla >= 95 ? 'bg-emerald-500' : kpis.avgSla >= 85 ? 'bg-amber-500' : 'bg-red-500'}
              tooltip="Network-wide average of the % of requested appointments we actually delivered, weighted across active states."
            />
          </div>

          {/* Leadership briefing */}
          {snapshots.length > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-semibold">Leadership Summary</p>
                  <p className="text-sm text-muted-foreground">
                    {(() => {
                      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      const slaStatus = kpis.avgSla >= 95 ? 'above target' : kpis.avgSla >= 85 ? 'near target' : 'below target';
                      const wasteStr = kpis.wastedHours > 0
                        ? ` ${kpis.wastedHours.toFixed(1)} provider hrs/day are wasted in over-licensed states.`
                        : '';
                      const topRec = recommendations[0];
                      const recStr = topRec ? ` Top action: ${topRec.nextStep}.` : '';
                      return `As of ${today}: Network SLA is ${kpis.avgSla.toFixed(1)}% (${slaStatus}). ${kpis.deficitCount} state${kpis.deficitCount !== 1 ? 's' : ''} under-covered, ${kpis.surplusCount} with excess capacity.${wasteStr}${recStr}`;
                    })()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-xs"
                  onClick={() => {
                    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    const slaStatus = kpis.avgSla >= 95 ? 'above target' : kpis.avgSla >= 85 ? 'near target' : 'below target';
                    const text = [
                      `License Optimizer Update — ${today}`,
                      '',
                      `SLA Attainment: ${kpis.avgSla.toFixed(1)}% (${slaStatus}, target ≥95%)`,
                      `Deficit States: ${kpis.deficitCount} (coverage <100%)`,
                      `Surplus States: ${kpis.surplusCount} (coverage ≥130%)`,
                      `Wasted Capacity: ${kpis.wastedHours.toFixed(1)} hrs/day`,
                      '',
                      'Top Recommendations:',
                      ...recommendations.slice(0, 5).map((r, i) =>
                        `${i + 1}. [${r.kind.replace('_', ' ')}] ${r.state}${r.provider !== '—' ? ` · ${r.provider}` : ''} → ${r.nextStep}${r.impact ? ` (~${r.impact.toFixed(1)} hrs/day)` : ''}`
                      ),
                      ...(recommendations.length === 0 ? ['  None'] : []),
                    ].join('\n');
                    navigator.clipboard.writeText(text);
                    toast({ title: 'Summary copied to clipboard' });
                  }}
                >
                  Copy
                </Button>
              </CardContent>
            </Card>
          )}

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
                  Recommended next actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recommendations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recommendations available.</p>
                ) : (
                  <div className="space-y-2.5">
                    {recommendations.map((r, i) => {
                      const meta: Record<typeof r.kind, { label: string; Icon: typeof CheckCircle2; variant: 'secondary' | 'outline' | 'default' | 'destructive' }> = {
                        ACTIVATE:      { label: 'Activate license',  Icon: CheckCircle2, variant: 'secondary' },
                        APPLY_LICENSE: { label: 'Apply for license', Icon: PlusCircle,   variant: 'default' },
                        REDUCE:        { label: 'Reduce footprint',  Icon: XCircle,      variant: 'outline' },
                        ANOMALY:       { label: 'Investigate',       Icon: Search,       variant: 'destructive' },
                      };
                      const { label, Icon, variant } = meta[r.kind];
                      return (
                        <div key={i} className="flex flex-col gap-1.5 p-3 rounded-lg border bg-card text-sm">
                          <div className="flex items-start gap-2.5">
                            <Badge variant={variant} className="shrink-0 mt-0.5 text-xs">
                              <Icon className="h-3 w-3 mr-1" />{label}
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium">
                                {r.state}
                                {r.provider !== '—' && <span className="text-muted-foreground"> · {r.provider}</span>}
                              </p>
                            </div>
                            {r.impact > 0 && (
                              <span className="text-xs font-semibold text-primary shrink-0">
                                {r.impact.toFixed(1)} hrs/day
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground pl-1">{r.rationale}</p>
                          <div className="flex items-center gap-1.5 pl-1 pt-0.5 text-xs">
                            <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                            <span className="font-medium text-foreground">{r.nextStep}</span>
                            {r.metric && (
                              <span className="text-muted-foreground ml-auto shrink-0">{r.metric}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* State detail table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">State-level detail</CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={stateDetailRows.length === 0}
                onClick={() =>
                  downloadCSV(
                    stateDetailRows.map((s) => ({
                      state: s.state_abbreviation,
                      date: s.snapshot_date,
                      providers: s.provider_count,
                      supply_hrs: s.allocated_hours.toFixed(2),
                      demand_hrs: s.estimated_demand_hours != null ? s.estimated_demand_hours.toFixed(2) : '',
                      coverage_pct: s.coverage_ratio != null
                        ? `${(s.coverage_ratio * 100).toFixed(0)}%` : '',
                      sla_pct: s.sla_pct != null ? `${s.sla_pct.toFixed(1)}%` : '',
                      quadrant: s.quadrant,
                      wasted: s.wasted_flag ? 'yes' : 'no',
                    })),
                    `license-optimizer-${view}-${new Date().toISOString().slice(0, 10)}.csv`
                  )
                }
              >
                <Download className="h-3.5 w-3.5" />
                Export ({stateDetailRows.length})
              </Button>
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
                      <th className="text-right py-2 pr-4">Providers</th>
                      <th className="text-right py-2 pr-4">Supply hrs</th>
                      <th className="text-right py-2 pr-4">Demand hrs</th>
                      <th className="text-right py-2 pr-4">Coverage</th>
                      <th className="text-right py-2 pr-4">SLA %</th>
                      <th className="text-left py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stateDetailRows.slice(0, 100).map((s, i) => (
                      <tr key={i} className={cn('border-b last:border-0', s.wasted_flag && 'bg-amber-50/40')}>
                        <td className="py-2 pr-4 font-medium">{s.state_abbreviation}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{s.snapshot_date}</td>
                        <td className="py-2 pr-4 text-right text-muted-foreground">{s.provider_count}</td>
                        <td className="py-2 pr-4 text-right">{s.allocated_hours.toFixed(1)}</td>
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
                    {stateDetailRows.length > 100 && (
                      <tr>
                        <td colSpan={8} className="py-2 text-xs text-muted-foreground text-center">
                          Showing 100 of {stateDetailRows.length} rows. Use filters to narrow results.
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

