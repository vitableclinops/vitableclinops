import { useEffect, useMemo, useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Info, Loader2, ArrowLeft, Check, Clock, RefreshCw, CheckCircle2, AlertTriangle, CircleDashed, CalendarRange } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  useProviderShiftSummary,
  useRefreshHomebaseMonth,
  useShiftRecommendations,
  useUpdateShiftStatus,
  formatTime,
  SHIFT_TYPE_LABEL,
  type ProviderShiftSummary,
  type ShiftRecommendation,
} from '@/hooks/useShiftRecommendations';
import { downloadCSV } from '@/lib/utils';

const MONTH_OPTIONS = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'];

const formatMonthLabel = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const getMonthEndIso = (iso: string) => {
  const [year, month] = iso.split('-').map(Number);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
};
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const ShiftPlanPage = () => {
  const { profile, roles } = useAuth();
  const { toast } = useToast();
  const userRole = roles.includes('admin')
    ? 'admin'
    : roles.includes('pod_lead')
    ? 'pod_lead'
    : 'provider';

  const [month, setMonth] = useState('2026-06-01');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [homebaseStartDate, setHomebaseStartDate] = useState(month);
  const [homebaseEndDate, setHomebaseEndDate] = useState(getMonthEndIso(month));
  const [showHomebaseRange, setShowHomebaseRange] = useState(false);
  const monthEndDate = useMemo(() => getMonthEndIso(month), [month]);
  const homebaseWindow = useMemo(
    () => ({ startDate: homebaseStartDate, endDate: homebaseEndDate }),
    [homebaseStartDate, homebaseEndDate],
  );
  const customHomebaseWindow = homebaseStartDate !== month || homebaseEndDate !== monthEndDate;
  const invalidHomebaseWindow =
    !isIsoDate(homebaseStartDate) ||
    !isIsoDate(homebaseEndDate) ||
    homebaseStartDate > homebaseEndDate;

  useEffect(() => {
    setHomebaseStartDate(month);
    setHomebaseEndDate(monthEndDate);
  }, [month, monthEndDate]);

  const summaryQ = useProviderShiftSummary(month, homebaseWindow);
  const detailQ = useShiftRecommendations(month, selectedProvider, homebaseWindow);
  const updateMutation = useUpdateShiftStatus();
  const refreshHomebaseMutation = useRefreshHomebaseMonth();

  const summaries = useMemo(() => summaryQ.data ?? [], [summaryQ.data]);
  const details = useMemo(() => detailQ.data ?? [], [detailQ.data]);
  const selectedSummary = useMemo(
    () => summaries.find(s => s.provider_id === selectedProvider) ?? null,
    [summaries, selectedProvider],
  );

  const sortedSummaries = useMemo(
    () =>
      [...summaries].sort((a, b) =>
        Number(b.publish_hours ?? 0) - Number(a.publish_hours ?? 0)
        || (a.provider_name ?? '').localeCompare(b.provider_name ?? ''),
      ),
    [summaries],
  );

  const networkTotals = useMemo(() => {
    const acc = {
      publishCount: 0,
      cutCount: 0,
      publishHours: 0,
      cutHours: 0,
      pendingPublish: 0,
      published: 0,
      confirmed: 0,
      homebasePublished: 0,
      homebaseUnpublished: 0,
      homebaseUnscheduled: 0,
      homebaseMissing: 0,
    };
    for (const r of summaries) {
      acc.publishCount += r.publish_count ?? 0;
      acc.cutCount += r.cut_count ?? 0;
      acc.publishHours += Number(r.publish_hours ?? 0);
      acc.cutHours += Number(r.cut_hours ?? 0);
      acc.pendingPublish += r.pending_publish ?? 0;
      acc.published += r.published_count ?? 0;
      acc.confirmed += r.confirmed_count ?? 0;
      acc.homebasePublished += r.homebase_published_count ?? 0;
      acc.homebaseUnpublished += r.homebase_unpublished_count ?? 0;
      acc.homebaseUnscheduled += r.homebase_unscheduled_count ?? 0;
      acc.homebaseMissing += r.homebase_missing_count ?? 0;
    }
    return acc;
  }, [summaries]);

  const downloadProviderCsv = (rows: ShiftRecommendation[], providerName: string) => {
    const publishRows = rows.filter(r => r.recommendation === 'publish');
    downloadCSV(
      publishRows.map(r => ({
        provider: providerName,
        date: r.shift_date,
        start_time_et: formatTime(r.start_min),
        end_time_et: formatTime(r.end_min),
        hours: r.hours,
        state: r.assigned_state ?? '',
        shift_type: SHIFT_TYPE_LABEL[r.shift_type] ?? r.shift_type,
        publish_status: r.publish_status,
        homebase_shift_id: r.homebase_shift_id ?? '',
        homebase_sync_status: r.homebase_confirmation.status,
        homebase_confirmed_shift_id: r.homebase_confirmation.homebase_shift_id ?? '',
        homebase_last_synced_at: r.homebase_confirmation.synced_at ?? '',
      })),
      `${providerName.replace(/\s+/g, '_')}_${month}_publish.csv`,
    );
  };

  const downloadAllPublishCsv = async () => {
    // Fetch all publish rows for the month in one go
    const { clinopsSupabase } = await import('@/integrations/supabase/clinopsClient');
    const { data, error } = await clinopsSupabase
      .from('shift_recommendations')
      .select('provider_name, shift_date, start_min, end_min, hours, assigned_state, shift_type, publish_status, homebase_shift_id')
      .eq('target_month', month)
      .eq('recommendation', 'publish')
      .order('provider_name')
      .order('shift_date')
      .order('start_min')
      .range(0, 9999);
    if (error) {
      toast({ title: 'Download failed', description: error.message, variant: 'destructive' });
      return;
    }
    downloadCSV(
      (data ?? []).map(r => ({
        provider: r.provider_name,
        date: r.shift_date,
        start_time_et: formatTime(r.start_min),
        end_time_et: formatTime(r.end_min),
        hours: r.hours,
        state: r.assigned_state ?? '',
        shift_type: SHIFT_TYPE_LABEL[r.shift_type] ?? r.shift_type,
        publish_status: r.publish_status,
        homebase_shift_id: r.homebase_shift_id ?? '',
      })),
      `all_publish_shifts_${month}.csv`,
    );
  };

  const togglePublished = (row: ShiftRecommendation) => {
    if (row.recommendation !== 'publish') return;
    let next: 'pending' | 'published_to_homebase' | 'confirmed' | 'cancelled' = 'pending';
    if (row.publish_status === 'pending') {
      next = 'published_to_homebase';
    } else if (row.publish_status === 'published_to_homebase') {
      next = 'pending';
    } else if (row.publish_status === 'confirmed' || row.publish_status === 'cancelled') {
      next = row.publish_status;
    }
    updateMutation.mutate({ id: row.id, publish_status: next });
  };

  const refreshHomebase = () => {
    if (invalidHomebaseWindow) {
      toast({
        title: 'Check Homebase dates',
        description: 'The Homebase end date must be on or after the start date.',
        variant: 'destructive',
      });
      return;
    }

    refreshHomebaseMutation.mutate(homebaseWindow, {
      onSuccess: (result) => {
        toast({
          title: 'Homebase refreshed',
          description: `${result?.shifts_synced ?? 0} shifts synced for ${homebaseStartDate} through ${homebaseEndDate}.`,
        });
      },
      onError: (error) => {
        toast({
          title: 'Homebase refresh failed',
          description: error instanceof Error ? error.message : 'Unable to sync Homebase for this date range.',
          variant: 'destructive',
        });
      },
    });
  };

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

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Clock className="h-6 w-6 text-emerald-600" />
                Shift Plan {selectedProvider && selectedSummary ? `· ${selectedSummary.provider_name}` : ''}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Per-shift publish/cut recommendations. The team executes by entering "publish" rows into Homebase, then ticks each off as they go.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedProvider && (
                <Button variant="outline" size="sm" onClick={() => setSelectedProvider(null)}>
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  All providers
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={refreshHomebase}
                disabled={refreshHomebaseMutation.isPending || invalidHomebaseWindow}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${refreshHomebaseMutation.isPending ? 'animate-spin' : ''}`} />
                Sync Homebase
              </Button>
              <Button
                variant={showHomebaseRange || customHomebaseWindow ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setShowHomebaseRange(open => !open)}
              >
                <CalendarRange className="h-4 w-4 mr-1" />
                Change Homebase range
              </Button>
              <Select value={month} onValueChange={(v) => { setMonth(v); setSelectedProvider(null); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map(m => (
                    <SelectItem key={m} value={m}>{formatMonthLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {showHomebaseRange && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Homebase range</span>
              <Input
                type="date"
                value={homebaseStartDate}
                onChange={(event) => setHomebaseStartDate(event.target.value)}
                aria-label="Homebase start date"
                className="h-9 w-[150px]"
              />
              <Input
                type="date"
                value={homebaseEndDate}
                onChange={(event) => setHomebaseEndDate(event.target.value)}
                aria-label="Homebase end date"
                className="h-9 w-[150px]"
              />
              {customHomebaseWindow && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHomebaseStartDate(month);
                    setHomebaseEndDate(monthEndDate);
                  }}
                >
                  Reset to selected month
                </Button>
              )}
              {invalidHomebaseWindow && (
                <span className="text-xs font-medium text-destructive">End date must be on or after start date.</span>
              )}
            </div>
          )}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Each row is one concrete shift. Homebase status is automatic from {customHomebaseWindow ? 'the custom Homebase date range' : 'the selected month'}; Ops status is the team's manual review marker.
              MD-only states (AL, IN, GA, MS, MO, SC, TN, LA) only allow MD/DO providers — NPs are filtered out at allocation time.
            </AlertDescription>
          </Alert>

          {!selectedProvider && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiCard label="Publish shifts" value={`${networkTotals.publishCount}`} sub={`${networkTotals.publishHours.toFixed(0)} hrs`} />
              <KpiCard label="Cut shifts" value={`${networkTotals.cutCount}`} sub={`${networkTotals.cutHours.toFixed(0)} hrs trimmed`} />
              <KpiCard label="Pending publish" value={`${networkTotals.pendingPublish}`} sub="awaiting Homebase entry" accent={networkTotals.pendingPublish > 0 ? 'warn' : 'good'} />
              <KpiCard label="Published" value={`${networkTotals.published}`} sub={`${networkTotals.confirmed} confirmed`} accent={networkTotals.published > 0 ? 'good' : 'neutral'} />
              <KpiCard
                label="Homebase confirmed"
                value={`${networkTotals.homebasePublished}`}
                sub={`${networkTotals.homebaseMissing} missing · ${networkTotals.homebaseUnpublished + networkTotals.homebaseUnscheduled} needs publish`}
                accent={networkTotals.homebaseMissing > 0 || networkTotals.homebaseUnpublished > 0 ? 'warn' : 'good'}
              />
            </div>
          )}

          {!selectedProvider ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Providers · {formatMonthLabel(month)}</CardTitle>
                <Button variant="outline" size="sm" onClick={downloadAllPublishCsv} disabled={!summaries.length}>
                  <Download className="h-4 w-4 mr-1" />
                  All publish shifts CSV
                </Button>
              </CardHeader>
              <CardContent>
                {summaryQ.isLoading ? (
                  <div className="py-12 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : sortedSummaries.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No shift recommendations for {formatMonthLabel(month)}. Run the evaluator + emit functions for this month.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="text-left py-2 px-2 font-medium">Provider</th>
                          <th className="text-right py-2 px-2 font-medium">Publish</th>
                          <th className="text-right py-2 px-2 font-medium">Cut</th>
                          <th className="text-right py-2 px-2 font-medium">Hrs publish</th>
                          <th className="text-right py-2 px-2 font-medium">Hrs cut</th>
                          <th className="text-right py-2 px-2 font-medium">Homebase</th>
                          <th className="text-right py-2 px-2 font-medium">Status</th>
                          <th className="py-2 px-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sortedSummaries.map(row => (
                          <tr key={row.provider_id ?? row.provider_name ?? Math.random()} className="hover:bg-muted/30">
                            <td className="py-2 px-2 font-medium">{row.provider_name}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{row.publish_count ?? 0}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{row.cut_count ?? 0}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{Number(row.publish_hours ?? 0).toFixed(1)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{Number(row.cut_hours ?? 0).toFixed(1)}</td>
                            <td className="py-2 px-2 text-right">
                              <ProviderHomebaseBadge row={row} />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <ProviderStatusBadge row={row} />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <Button variant="ghost" size="sm" onClick={() => row.provider_id && setSelectedProvider(row.provider_id)} disabled={!row.provider_id}>
                                Open →
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  {selectedSummary?.provider_name} · {formatMonthLabel(month)}
                  {selectedSummary && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({selectedSummary.publish_count ?? 0} publish · {selectedSummary.cut_count ?? 0} cut · {Number(selectedSummary.publish_hours ?? 0).toFixed(1)}h)
                    </span>
                  )}
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => downloadProviderCsv(details, selectedSummary?.provider_name ?? 'provider')} disabled={!details.length}>
                  <Download className="h-4 w-4 mr-1" />
                  Provider CSV
                </Button>
              </CardHeader>
              <CardContent>
                {detailQ.isLoading ? (
                  <div className="py-12 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : details.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No shifts for this provider in {formatMonthLabel(month)}.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-muted-foreground border-b">
                        <tr>
                          <th className="text-left py-2 px-2 font-medium">Date</th>
                          <th className="text-left py-2 px-2 font-medium">Time (ET)</th>
                          <th className="text-right py-2 px-2 font-medium">Hours</th>
                          <th className="text-left py-2 px-2 font-medium">Type</th>
                          <th className="text-left py-2 px-2 font-medium">State</th>
                          <th className="text-left py-2 px-2 font-medium">Decision</th>
                          <th className="text-left py-2 px-2 font-medium">Homebase</th>
                          <th className="text-left py-2 px-2 font-medium">Ops Status</th>
                          <th className="py-2 px-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {details.map(row => (
                          <tr
                            key={row.id}
                            className={`hover:bg-muted/30 ${homebaseRowClass(row)} ${row.recommendation === 'cut' ? 'opacity-60' : ''}`}
                          >
                            <td className="py-2 px-2 whitespace-nowrap">{formatDate(row.shift_date)}</td>
                            <td className="py-2 px-2 whitespace-nowrap font-mono text-xs">
                              {formatTime(row.start_min)}–{formatTime(row.end_min)}
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums">{Number(row.hours).toFixed(1)}</td>
                            <td className="py-2 px-2 text-xs text-muted-foreground">{SHIFT_TYPE_LABEL[row.shift_type] ?? row.shift_type}</td>
                            <td className="py-2 px-2 font-medium">{row.assigned_state ?? '—'}</td>
                            <td className="py-2 px-2">
                              <Badge variant={row.recommendation === 'publish' ? 'default' : 'secondary'}>
                                {row.recommendation}
                              </Badge>
                            </td>
                            <td className="py-2 px-2">
                              <HomebaseStatusBadge confirmation={row.homebase_confirmation} />
                            </td>
                            <td className="py-2 px-2">
                              <PublishStatusBadge status={row.publish_status} />
                            </td>
                            <td className="py-2 px-2 text-right">
                              {row.recommendation === 'publish' && (
                                <Button
                                  variant={row.publish_status === 'published_to_homebase' ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => togglePublished(row)}
                                  disabled={updateMutation.isPending}
                                  title="Toggle Ops review status"
                                >
                                  <Check className={`h-4 w-4 ${row.publish_status === 'published_to_homebase' ? '' : 'opacity-50'}`} />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

interface KpiCardProps { label: string; value: string; sub?: string; accent?: 'good' | 'warn' | 'bad' | 'neutral'; }
const KpiCard = ({ label, value, sub, accent = 'neutral' }: KpiCardProps) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${
        accent === 'good' ? 'text-emerald-600'
        : accent === 'warn' ? 'text-amber-600'
        : accent === 'bad' ? 'text-red-600'
        : ''
      }`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </CardContent>
  </Card>
);

const ProviderStatusBadge = ({ row }: { row: ProviderShiftSummary }) => {
  const pending = row.pending_publish ?? 0;
  const published = row.published_count ?? 0;
  const confirmed = row.confirmed_count ?? 0;
  const total = row.publish_count ?? 0;
  if (total === 0) return <Badge variant="secondary">no publish</Badge>;
  if (confirmed === total) return <Badge className="bg-emerald-600">all confirmed</Badge>;
  if (published + confirmed === total) return <Badge variant="default">published</Badge>;
  if (published + confirmed > 0) return <Badge variant="secondary">{published + confirmed}/{total} done</Badge>;
  return <Badge variant="outline">{pending} pending</Badge>;
};

const ProviderHomebaseBadge = ({ row }: { row: ProviderShiftSummary }) => {
  const total = row.publish_count ?? 0;
  const published = row.homebase_published_count ?? 0;
  const unpublished = row.homebase_unpublished_count ?? 0;
  const unscheduled = row.homebase_unscheduled_count ?? 0;
  const missing = row.homebase_missing_count ?? 0;

  if (total === 0) return <Badge variant="secondary">no publish</Badge>;
  if (published === total) {
    return <Badge className="bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />all synced</Badge>;
  }
  if (published > 0) {
    return (
      <Badge variant="secondary">
        {published}/{total} synced
      </Badge>
    );
  }
  if (unpublished + unscheduled > 0) {
    return <Badge className="bg-amber-600"><AlertTriangle className="h-3 w-3 mr-1" />needs publish</Badge>;
  }
  return <Badge variant="outline">{missing}/{total} missing</Badge>;
};

const HomebaseStatusBadge = ({ confirmation }: { confirmation: ShiftRecommendation['homebase_confirmation'] }) => {
  if (confirmation.status === 'published') {
    return <Badge className="bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />Homebase</Badge>;
  }
  if (confirmation.status === 'unpublished') {
    return <Badge className="bg-amber-600"><AlertTriangle className="h-3 w-3 mr-1" />Unpublished</Badge>;
  }
  if (confirmation.status === 'unscheduled') {
    return <Badge className="bg-amber-600"><AlertTriangle className="h-3 w-3 mr-1" />Unscheduled</Badge>;
  }
  if (confirmation.status === 'not_applicable') {
    return <Badge variant="secondary">N/A</Badge>;
  }
  return <Badge variant="outline"><CircleDashed className="h-3 w-3 mr-1" />Not found</Badge>;
};

const homebaseRowClass = (row: ShiftRecommendation) => {
  if (row.recommendation !== 'publish') return '';
  if (row.homebase_confirmation.status === 'published') return 'bg-emerald-50/50 dark:bg-emerald-950/10';
  if (row.homebase_confirmation.status === 'unpublished' || row.homebase_confirmation.status === 'unscheduled') {
    return 'bg-amber-50/50 dark:bg-amber-950/10';
  }
  return '';
};

const PublishStatusBadge = ({ status }: { status: string }) => {
  const variant: 'default' | 'outline' | 'secondary' | 'destructive' =
    status === 'confirmed' ? 'default'
    : status === 'published_to_homebase' ? 'default'
    : status === 'cancelled' ? 'destructive'
    : 'outline';
  const label = status.replace(/_/g, ' ');
  return <Badge variant={variant} className={status === 'confirmed' ? 'bg-emerald-600' : status === 'published_to_homebase' ? 'bg-blue-600' : ''}>{label}</Badge>;
};

export default ShiftPlanPage;
