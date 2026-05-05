import { useMemo, useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Info, Loader2, ArrowLeft, Check, Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useProviderShiftSummary,
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

const ShiftPlanPage = () => {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin')
    ? 'admin'
    : roles.includes('pod_lead')
    ? 'pod_lead'
    : 'provider';

  const [month, setMonth] = useState('2026-06-01');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const summaryQ = useProviderShiftSummary(month);
  const detailQ = useShiftRecommendations(month, selectedProvider);
  const updateMutation = useUpdateShiftStatus();

  const summaries = summaryQ.data ?? [];
  const details = detailQ.data ?? [];
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
    const acc = { publishCount: 0, cutCount: 0, publishHours: 0, cutHours: 0, pendingPublish: 0, published: 0, confirmed: 0 };
    for (const r of summaries) {
      acc.publishCount += r.publish_count ?? 0;
      acc.cutCount += r.cut_count ?? 0;
      acc.publishHours += Number(r.publish_hours ?? 0);
      acc.cutHours += Number(r.cut_hours ?? 0);
      acc.pendingPublish += r.pending_publish ?? 0;
      acc.published += r.published_count ?? 0;
      acc.confirmed += r.confirmed_count ?? 0;
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
      // eslint-disable-next-line no-alert
      alert(`Failed to download: ${error.message}`);
      return;
    }
    downloadCSV(
      (data ?? []).map((r: any) => ({
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
    const next =
      row.publish_status === 'pending'
        ? 'published_to_homebase'
        : row.publish_status === 'published_to_homebase'
        ? 'pending'
        : row.publish_status;
    updateMutation.mutate({ id: row.id, publish_status: next as any });
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
            <div className="flex items-center gap-2">
              {selectedProvider && (
                <Button variant="outline" size="sm" onClick={() => setSelectedProvider(null)}>
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  All providers
                </Button>
              )}
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

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Each row is one concrete shift. <code>publish</code> rows go into Homebase; <code>cut</code> rows are documented for the provider record but not scheduled.
              MD-only states (AL, IN, GA, MS, MO, SC, TN, LA) only allow MD/DO providers — NPs are filtered out at allocation time.
            </AlertDescription>
          </Alert>

          {!selectedProvider && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Publish shifts" value={`${networkTotals.publishCount}`} sub={`${networkTotals.publishHours.toFixed(0)} hrs`} />
              <KpiCard label="Cut shifts" value={`${networkTotals.cutCount}`} sub={`${networkTotals.cutHours.toFixed(0)} hrs trimmed`} />
              <KpiCard label="Pending publish" value={`${networkTotals.pendingPublish}`} sub="awaiting Homebase entry" accent={networkTotals.pendingPublish > 0 ? 'warn' : 'good'} />
              <KpiCard label="Published" value={`${networkTotals.published}`} sub={`${networkTotals.confirmed} confirmed`} accent={networkTotals.published > 0 ? 'good' : 'neutral'} />
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
                          <th className="text-left py-2 px-2 font-medium">Status</th>
                          <th className="py-2 px-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {details.map(row => (
                          <tr
                            key={row.id}
                            className={`hover:bg-muted/30 ${row.recommendation === 'cut' ? 'opacity-60' : ''}`}
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
                              <PublishStatusBadge status={row.publish_status} />
                            </td>
                            <td className="py-2 px-2 text-right">
                              {row.recommendation === 'publish' && (
                                <Button
                                  variant={row.publish_status === 'published_to_homebase' ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => togglePublished(row)}
                                  disabled={updateMutation.isPending}
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
