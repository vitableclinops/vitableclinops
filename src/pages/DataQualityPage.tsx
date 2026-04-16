import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle2, AlertTriangle, XCircle, Clock, Users,
  Database, FileText, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Data hooks ────────────────────────────────────────────────────────────────

function useLastSync() {
  return useQuery({
    queryKey: ['dq_last_sync'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('homebase_sync_runs')
        .select('finished_at, status, employees_matched, employees_unmatched')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data ?? null;
    },
    staleTime: 60_000,
  });
}

function useLastRecompute() {
  return useQuery({
    queryKey: ['dq_last_recompute'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('license_optimization_snapshots')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data?.snapshot_date ?? null;
    },
    staleTime: 60_000,
  });
}

function useUnmatchedEmployees() {
  return useQuery({
    queryKey: ['dq_unmatched_employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('homebase_employees')
        .select('id, first_name, last_name, normalized_name, match_confidence')
        .is('profile_id', null)
        .order('normalized_name');
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 5 * 60_000,
  });
}

function useLowConfidenceMatches() {
  return useQuery({
    queryKey: ['dq_low_confidence'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('homebase_employees')
        .select('id, first_name, last_name, normalized_name, match_confidence, profile_id')
        .not('profile_id', 'is', null)
        .lt('match_confidence', 0.9)
        .order('match_confidence');
      if (error) throw error;

      if (!data || data.length === 0) return [];

      const profileIds = data.map((e: any) => e.profile_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name')
        .in('id', profileIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [
        p.id,
        p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '—',
      ]));

      return data.map((e: any) => ({
        ...e,
        matched_name: profileMap.get(e.profile_id) ?? '—',
      }));
    },
    staleTime: 5 * 60_000,
  });
}

function useProvidersWithoutLicenses() {
  return useQuery({
    queryKey: ['dq_providers_no_licenses'],
    queryFn: async () => {
      // Get all active providers
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, credentials')
        .eq('is_active', true);
      if (profilesError) throw profilesError;

      if (!profiles || profiles.length === 0) return [];

      // Get all profile IDs with at least one active license
      const { data: licenses } = await supabase
        .from('provider_licenses')
        .select('profile_id')
        .eq('status', 'active');

      const licensedIds = new Set((licenses ?? []).map((l: any) => l.profile_id));

      return (profiles as any[])
        .filter((p) => !licensedIds.has(p.id))
        .map((p) => ({
          ...p,
          display_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '—',
        }));
    },
    staleTime: 5 * 60_000,
  });
}

function useProvidersNotInHomebase() {
  return useQuery({
    queryKey: ['dq_providers_not_in_homebase'],
    queryFn: async () => {
      // Get providers with at least one active license
      const { data: licenses } = await supabase
        .from('provider_licenses')
        .select('profile_id')
        .eq('status', 'active');

      const licensedIds = [...new Set((licenses ?? []).map((l: any) => l.profile_id))];
      if (licensedIds.length === 0) return [];

      // Get which of those are matched in Homebase
      const { data: matched } = await supabase
        .from('homebase_employees')
        .select('profile_id')
        .in('profile_id', licensedIds);

      const matchedIds = new Set((matched ?? []).map((e: any) => e.profile_id));
      const unmatchedIds = licensedIds.filter((id) => !matchedIds.has(id));
      if (unmatchedIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, credentials')
        .in('id', unmatchedIds);

      return (profiles ?? []).map((p: any) => ({
        ...p,
        display_name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '—',
      }));
    },
    staleTime: 5 * 60_000,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function FreshnessChip({ days }: { days: number | null }) {
  if (days === null) return <Badge variant="outline" className="text-xs">Never</Badge>;
  if (days === 0) return <Badge className="bg-emerald-500 text-white text-xs">Today</Badge>;
  if (days <= 1) return <Badge className="bg-emerald-500 text-white text-xs">{days}d ago</Badge>;
  if (days <= 3) return <Badge className="bg-yellow-500 text-white text-xs">{days}d ago</Badge>;
  return <Badge variant="destructive" className="text-xs">{days}d ago</Badge>;
}

function IssueCount({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {n === 0
        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
      <span className="text-sm">
        <span className={cn('font-semibold', n > 0 && 'text-amber-600')}>{n}</span>
        {' '}{label}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DataQualityPage() {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin') ? 'admin' : roles.includes('pod_lead') ? 'pod_lead' : 'provider';

  const { data: lastSync } = useLastSync();
  const { data: lastRecomputeDate } = useLastRecompute();
  const { data: unmatched = [] } = useUnmatchedEmployees();
  const { data: lowConf = [] } = useLowConfidenceMatches();
  const { data: noLicenses = [] } = useProvidersWithoutLicenses();
  const { data: notInHomebase = [] } = useProvidersNotInHomebase();

  const syncDays = daysAgo(lastSync?.finished_at ?? null);
  const recomputeDays = daysAgo(lastRecomputeDate);

  const totalIssues = unmatched.length + lowConf.length + noLicenses.length + notInHomebase.length
    + (syncDays !== null && syncDays > 3 ? 1 : 0)
    + (recomputeDays !== null && recomputeDays > 3 ? 1 : 0);

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
          <div>
            <h1 className="text-2xl font-bold">Data Quality & Methodology</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Verify that providers, licenses, and schedules are correctly linked — and understand how every metric is calculated.
            </p>
          </div>

          {totalIssues > 0 && (
            <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-sm">
                <span className="font-semibold">{totalIssues} issue{totalIssues !== 1 ? 's' : ''} found</span>
                {' '}— optimization metrics may be inaccurate until these are resolved. Review the Audit tab below.
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="audit">
            <TabsList>
              <TabsTrigger value="audit" className="gap-1.5">
                <Database className="h-3.5 w-3.5" />
                Data Audit
                {totalIssues > 0 && (
                  <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0">{totalIssues}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="methodology" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Methodology
              </TabsTrigger>
            </TabsList>

            {/* ── AUDIT TAB ──────────────────────────────────────────────────── */}
            <TabsContent value="audit" className="space-y-6 mt-4">

              {/* Data freshness */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" /> Data Freshness
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">Last Homebase Sync</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {lastSync?.finished_at
                            ? new Date(lastSync.finished_at).toLocaleString()
                            : 'Never synced'}
                        </p>
                        {lastSync && (
                          <p className="text-xs text-muted-foreground">
                            {lastSync.employees_matched ?? 0} matched · {lastSync.employees_unmatched ?? 0} unmatched
                          </p>
                        )}
                      </div>
                      <FreshnessChip days={syncDays} />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">Last Optimization Recompute</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {lastRecomputeDate
                            ? `Snapshots through ${lastRecomputeDate}`
                            : 'Never computed'}
                        </p>
                      </div>
                      <FreshnessChip days={recomputeDays} />
                    </div>
                  </div>
                  {(syncDays !== null && syncDays > 3) && (
                    <p className="text-xs text-amber-600 font-medium">
                      Homebase sync is {syncDays} days old. Go to License Optimizer → Sync Homebase to refresh provider schedules.
                    </p>
                  )}
                  {(recomputeDays !== null && recomputeDays > 3) && (
                    <p className="text-xs text-amber-600 font-medium">
                      Snapshots are {recomputeDays} days old. Click Recompute in License Optimizer to recalculate coverage ratios.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Issue summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4 text-muted-foreground" /> Issue Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <IssueCount n={unmatched.length}   label="Homebase employees with no provider match" />
                  <IssueCount n={lowConf.length}     label="Low-confidence Homebase matches (review recommended)" />
                  <IssueCount n={noLicenses.length}  label="Active providers with no active licenses" />
                  <IssueCount n={notInHomebase.length} label="Licensed providers missing from Homebase" />
                </CardContent>
              </Card>

              {/* Unmatched Homebase employees */}
              {unmatched.length > 0 && (
                <Card className="border-amber-200">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-destructive" />
                      Unmatched Homebase Employees ({unmatched.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      These employees exist in Homebase but couldn't be matched to a provider profile.
                      Their scheduled hours are <strong>not counted</strong> in supply or coverage calculations.
                      To fix: verify their name spelling in Homebase matches their profile, or add a manual override mapping.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name in Homebase</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Normalized</th>
                          </tr>
                        </thead>
                        <tbody>
                          {unmatched.map((e: any) => (
                            <tr key={e.id} className="border-b hover:bg-muted/30">
                              <td className="px-3 py-2 font-medium">{[e.first_name, e.last_name].filter(Boolean).join(' ') || '—'}</td>
                              <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{e.normalized_name ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Low-confidence matches */}
              {lowConf.length > 0 && (
                <Card className="border-yellow-200">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Low-Confidence Homebase Matches ({lowConf.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      These Homebase employees were matched to a provider profile using fuzzy name matching,
                      but the confidence score is below 90%. Verify these are correct — a wrong match
                      means hours are assigned to the wrong provider in coverage calculations.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Homebase Name</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Matched To</th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lowConf.map((e: any) => (
                            <tr key={e.id} className="border-b hover:bg-muted/30">
                              <td className="px-3 py-2 font-medium">
                                {[e.first_name, e.last_name].filter(Boolean).join(' ') || e.normalized_name || '—'}
                              </td>
                              <td className="px-3 py-2">{e.matched_name}</td>
                              <td className="px-3 py-2 text-right">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-xs',
                                    e.match_confidence >= 0.85 ? 'text-yellow-600 border-yellow-300' : 'text-destructive border-destructive/30'
                                  )}
                                >
                                  {(e.match_confidence * 100).toFixed(0)}%
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Active providers with no licenses */}
              {noLicenses.length > 0 && (
                <Card className="border-amber-200">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Active Providers With No Active Licenses ({noLicenses.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      These providers are marked active in the system but have no active state licenses on record.
                      They will generate <strong>zero supply</strong> in the coverage optimizer, even if they
                      have Homebase shifts scheduled. Add their licenses in the Provider Directory.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {noLicenses.map((p: any) => (
                        <Badge key={p.id} variant="outline" className="text-sm">
                          {p.display_name}
                          {p.credentials && <span className="text-muted-foreground ml-1">({p.credentials})</span>}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Licensed providers not in Homebase */}
              {notInHomebase.length > 0 && (
                <Card className="border-amber-200">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Licensed Providers Not Found in Homebase ({notInHomebase.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3">
                      These providers have active licenses in the system but no corresponding employee record
                      in Homebase. Their hours are <strong>not being tracked</strong> — they contribute no
                      supply to coverage calculations. Verify they are active in Homebase and that their name
                      matches their profile exactly.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {notInHomebase.map((p: any) => (
                        <Badge key={p.id} variant="outline" className="text-sm">
                          {p.display_name}
                          {p.credentials && <span className="text-muted-foreground ml-1">({p.credentials})</span>}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {totalIssues === 0 && (
                <Card>
                  <CardContent className="p-6 flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
                    <div>
                      <p className="font-medium">No data quality issues found</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        All providers are matched in Homebase, all licensed providers have active licenses,
                        and data is fresh. Optimization calculations should be accurate.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ── METHODOLOGY TAB ───────────────────────────────────────────── */}
            <TabsContent value="methodology" className="space-y-6 mt-4">

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Overview</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>
                    The optimization system answers one question: <strong className="text-foreground">do we have enough provider capacity in each state to meet patient demand?</strong>
                    It does this by combining three external data sources — provider schedules from Homebase,
                    appointment availability data from the EMR (via Metabase), and SLA attainment reports —
                    and running a nightly calculation that produces a coverage ratio for every
                    provider-state-day combination.
                  </p>
                  <p>
                    The result is a daily snapshot database that powers the License Optimizer heatmap,
                    Demand Matching Engine, Utilization Tracker, and Routing Intelligence pages.
                  </p>
                </CardContent>
              </Card>

              {/* Data sources */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" /> Data Sources
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4 text-sm">
                    {[
                      {
                        source: 'Homebase (synced hourly)',
                        provides: 'Provider scheduled hours per day',
                        how: 'The sync-homebase edge function calls the Homebase API, pulls all employee shifts, and matches each employee to a provider profile by email (exact), then by canonicalized full name (fuzzy ≥85% score), then by manual override. Unmatched employees are flagged in the Data Audit tab above.',
                        used_for: 'Supply side of the coverage ratio — how many hours each provider is scheduled to work.',
                      },
                      {
                        source: 'Metabase CSVs (uploaded weekly)',
                        provides: 'Leftover/unfilled appointment slots per state per day',
                        how: 'Exported from the Metabase "Available Visits" and "Leftover Slots" questions. Uploaded via the License Optimizer upload panel. Two windows are expected: a 14-day historical window and a current-week window.',
                        used_for: 'Used to infer actual patient demand. Unfilled slots = capacity that wasn\'t booked. Booked slots = total capacity minus unfilled.',
                      },
                      {
                        source: 'Metabase CSVs (uploaded weekly)',
                        provides: 'SLA attainment % per state',
                        how: 'Exported from the Metabase "SLA Attainment" question. Two windows: past 2 weeks (preferred) and a longer historical baseline. The most recent window is used in calculations.',
                        used_for: 'Adjusts the demand estimate — a 90% SLA means 90% of demand is currently being met. We back-calculate total demand from booked slots ÷ SLA%.',
                      },
                      {
                        source: 'Provider Licenses table (maintained in-app)',
                        provides: 'Which states each provider is actively licensed in',
                        how: 'Managed through the Provider Directory and provider onboarding flow. Status can be "active", "pending", "expired", or "inactive". Only "active" licenses are used in coverage calculations.',
                        used_for: 'Determines which states a provider\'s scheduled hours are distributed across.',
                      },
                    ].map((item) => (
                      <div key={item.source} className="p-3 rounded-lg border space-y-1.5">
                        <p className="font-semibold text-foreground">{item.source}</p>
                        <p><span className="text-foreground font-medium">Provides: </span>{item.provides}</p>
                        <p><span className="text-foreground font-medium">How it works: </span>{item.how}</p>
                        <p><span className="text-foreground font-medium">Used for: </span>{item.used_for}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Core formulas */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4 text-muted-foreground" /> Core Calculation (nightly, per provider-state-day)
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-4">
                  <p className="text-muted-foreground">
                    Each night, the <code className="bg-muted px-1 rounded">compute-license-utilization</code> function
                    runs over a 30-day window (±30 days from today) and produces one snapshot row
                    per provider × state × day.
                  </p>

                  <div className="space-y-3">
                    {[
                      {
                        step: '1. Allocate provider hours to states',
                        formula: 'allocated_hours = total_scheduled_hours ÷ number_of_active_licensed_states',
                        explanation: 'A provider\'s scheduled hours for the day are split evenly across all states where they hold an active license that is also operationally active. This is a simplification — it assumes equal routing across all eligible states. The Demand Matching Engine uses a more sophisticated greedy allocation by deficit priority.',
                      },
                      {
                        step: '2. Calculate supply slots',
                        formula: 'supply_slots = allocated_hours × 2',
                        explanation: 'Each hour of provider time contains 2 appointment slots (30 minutes each: 20 min visit + 10 min charting/admin). This is the theoretical maximum number of patients the provider could see in that state.',
                      },
                      {
                        step: '3. Calculate booked slots',
                        formula: 'booked_slots = supply_slots − unfilled_slots',
                        explanation: 'Unfilled slots come from the Metabase leftover-visits CSV. This gives the number of appointments that were actually scheduled (or are likely to be scheduled for future dates).',
                      },
                      {
                        step: '4. Back-calculate total demand',
                        formula: 'demand_slots = booked_slots ÷ (sla_pct ÷ 100)',
                        explanation: 'If SLA is 90%, that means we\'re meeting 90% of demand. So total demand = booked ÷ 0.90. This adjusts for the fact that some patient demand goes unmet — we\'re estimating the true size of the demand signal, not just what we captured.',
                      },
                      {
                        step: '5. Convert to hours',
                        formula: 'demand_hours = demand_slots ÷ 2',
                        explanation: 'Converts demand back to hours using the same 2-slots-per-hour rate.',
                      },
                      {
                        step: '6. Calculate coverage ratio',
                        formula: 'coverage_ratio = allocated_hours ÷ demand_hours',
                        explanation: 'The core metric. A ratio of 1.0 means supply exactly meets demand. Below 1.0 = deficit (not enough coverage). Above 1.3 = surplus (more capacity than demand). The 1.3 buffer allows for scheduling variability and last-minute demand spikes.',
                      },
                    ].map((item) => (
                      <div key={item.step} className="p-3 rounded-lg border space-y-1.5">
                        <p className="font-semibold text-foreground">{item.step}</p>
                        <code className="block bg-muted rounded px-2 py-1 text-xs font-mono text-foreground">
                          {item.formula}
                        </code>
                        <p className="text-muted-foreground">{item.explanation}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Quadrant classification */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Coverage Quadrants</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-3">
                  <p className="text-muted-foreground">
                    Each provider-state-day snapshot is classified into one of four quadrants
                    based on the coverage ratio and SLA attainment. These drive the heatmap colors
                    and optimization recommendations.
                  </p>
                  <div className="space-y-2">
                    {[
                      {
                        name: 'DEFICIT',
                        color: 'bg-red-100 border-red-300 text-red-800',
                        condition: 'coverage_ratio < 1.0  (or SLA < 85% and unfilled slots below the 25th percentile)',
                        meaning: 'Demand exceeds supply. Patients may be waiting longer than SLA targets allow. Action: route more provider hours here, or add capacity.',
                      },
                      {
                        name: 'BALANCED',
                        color: 'bg-emerald-100 border-emerald-300 text-emerald-800',
                        condition: '1.0 ≤ coverage_ratio < 1.3',
                        meaning: 'Supply is meeting demand with a healthy buffer. The 30% buffer above 1.0 accounts for scheduling variability. No immediate action needed.',
                      },
                      {
                        name: 'SURPLUS',
                        color: 'bg-blue-100 border-blue-300 text-blue-800',
                        condition: 'coverage_ratio ≥ 1.3  (or SLA ≥ 95% and unfilled slots above the 75th percentile)',
                        meaning: 'More capacity than demand. Provider hours are being paid for but not generating patient visits. Action: deactivate routing for this state or redirect the provider to a deficit state.',
                      },
                      {
                        name: 'ANOMALY',
                        color: 'bg-amber-100 border-amber-300 text-amber-800',
                        condition: 'SLA < 85% AND unfilled slots above the 75th percentile',
                        meaning: 'Contradictory signal — low SLA (demand not being met) but also many empty slots (capacity not being used). Usually a data quality issue: mismatched date ranges between SLA and slot data, or a provider scheduling error. Investigate before acting.',
                      },
                    ].map((q) => (
                      <div key={q.name} className={cn('p-3 rounded-lg border', q.color)}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold">{q.name}</span>
                          <code className="text-xs font-mono bg-black/10 rounded px-1">{q.condition}</code>
                        </div>
                        <p className="text-sm">{q.meaning}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Wasted hours */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Wasted Hours Definition</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2 text-muted-foreground">
                  <p>
                    A provider's hours are flagged as <strong className="text-foreground">wasted</strong> when
                    they meet both conditions:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>The state they are routing to is classified as <strong className="text-foreground">SURPLUS</strong></li>
                    <li>The coverage ratio in that state exceeds <strong className="text-foreground">2.0</strong> (supply is more than double demand)</li>
                  </ol>
                  <p>
                    This is intentionally conservative — a state at 1.4× coverage is technically surplus
                    but may absorb demand spikes. We only flag hours as "wasted" when the ratio is extreme (2×+),
                    meaning the excess capacity is unlikely to be utilized.
                  </p>
                  <p>
                    Wasted hours represent <strong className="text-foreground">direct cost inefficiency</strong>:
                    provider payroll is being applied to a market that cannot absorb the volume.
                    The Routing Intelligence page breaks this down as "Structural Waste."
                  </p>
                </CardContent>
              </Card>

              {/* Demand matching algorithm */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Demand Matching Engine Algorithm</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2 text-muted-foreground">
                  <p>
                    The Demand Matching Engine runs a separate, forward-looking calculation (not the nightly snapshot).
                    It uses a <strong className="text-foreground">greedy assignment algorithm</strong>:
                  </p>
                  <ol className="list-decimal list-inside space-y-2 ml-2">
                    <li>For each provider, identify the states where they hold active licenses.</li>
                    <li>Sort those states by current coverage ratio — most under-covered (lowest ratio) first.</li>
                    <li>Split the provider's total scheduled hours evenly across their licensed states.</li>
                    <li>
                      Designate the most-needed half of states as <strong className="text-foreground">Primary</strong>{' '}
                      (first 50%) and the rest as <strong className="text-foreground">Overflow</strong>.
                    </li>
                    <li>Aggregate total supply per state and compare to forecast demand.</li>
                  </ol>
                  <p className="mt-2">
                    Demand for the matching engine is estimated as:
                  </p>
                  <code className="block bg-muted rounded px-2 py-1 text-xs font-mono text-foreground">
                    demand_hours = projected_visits × 0.75
                  </code>
                  <p>
                    The 0.75 factor assumes each visit takes 45 minutes of provider time (30 min visit + 15 min admin/charting buffer).
                    This is slightly different from the snapshot formula (which uses the 30-min slot model)
                    because the matching engine uses forecast visit counts, not slot-level EMR data.
                  </p>
                </CardContent>
              </Card>

              {/* Limitations */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" /> Known Limitations
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  {[
                    'Hours are split evenly across all licensed states, which does not reflect actual routing decisions. A provider may be primarily working one state even if licensed in five.',
                    'Leftover slot data and SLA data come from different Metabase exports and may cover slightly different date ranges, which can produce ANOMALY classifications. Always check the upload timestamps before acting on anomaly states.',
                    'The coverage ratio uses the same SLA percentage for every day of the snapshot window, even though SLA can vary day-to-day. A monthly average SLA smooths out peaks and valleys.',
                    'Providers who are scheduled in Homebase but not yet matched to a profile contribute zero supply. Check the Data Audit tab for unmatched employees before running weekly reviews.',
                    'The "surplus > 2x" threshold for wasted hours is a heuristic, not a strict financial calculation. Actual cost impact depends on provider hourly rate, which is tracked separately in Provider Ops Info.',
                  ].map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 font-semibold text-foreground">{i + 1}.</span>
                      <p>{l}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

            </TabsContent>
          </Tabs>

        </div>
      </main>
    </div>
  );
}
