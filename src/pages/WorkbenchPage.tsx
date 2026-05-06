import { useMemo, useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { downloadCSV } from '@/lib/utils';
import { useStateCoverage } from '@/hooks/useStateCoverage';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, RefreshCw, Calendar, AlertCircle, Download, MapPin } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useMonthlyPublishView,
  useTogglePublishStep,
  useUpdatePublishNotes,
  useReevaluateMonth,
  type DecisionStatus,
  type ProviderPublishView,
  type ParsedShift,
} from '@/hooks/useMonthlyPublish';
import { toast } from 'sonner';

const MONTH_OPTIONS = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'];

const formatMonthLabel = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatHours = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toFixed(1);

const STATUS_STYLE: Record<DecisionStatus, { label: string; className: string }> = {
  accepted: { label: 'Accepted', className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' },
  partial: { label: 'Partial', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100' },
  declined: { label: 'Declined', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
  needs_review: {
    label: 'Needs review',
    className: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  },
  pending: { label: 'Pending', className: 'bg-slate-100 text-slate-700 hover:bg-slate-100' },
  superseded: { label: 'Superseded', className: 'bg-slate-50 text-slate-500 hover:bg-slate-50' },
};

const StatusBadge = ({ status }: { status: DecisionStatus | null | undefined }) => {
  if (!status) {
    return (
      <Badge variant="outline" className="text-slate-500">
        No submission
      </Badge>
    );
  }
  const s = STATUS_STYLE[status];
  return <Badge className={s.className}>{s.label}</Badge>;
};

const WorkbenchPage = () => {
  const { profile, hasRole } = useAuth();
  const userRole = hasRole('admin')
    ? 'admin'
    : hasRole('pod_lead')
    ? 'pod_lead'
    : hasRole('physician')
    ? 'physician'
    : 'provider';

  const [month, setMonth] = useState('2026-06-01');
  const [filter, setFilter] = useState('');
  const [drillRow, setDrillRow] = useState<ProviderPublishView | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  const { data: rows = [], isLoading, refetch } = useMonthlyPublishView(month);
  const toggle = useTogglePublishStep();
  const updateNotes = useUpdatePublishNotes();
  const reevaluate = useReevaluateMonth();

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      r =>
        r.provider_name.toLowerCase().includes(q) ||
        (r.profession ?? '').toLowerCase().includes(q) ||
        (r.submission?.decision_status ?? '').toLowerCase().includes(q),
    );
  }, [rows, filter]);

  const summary = useMemo(() => {
    let accepted = 0;
    let declined = 0;
    let homebaseDone = 0;
    let ehrDone = 0;
    let withSubmission = 0;
    let acceptedRows = 0;
    for (const r of rows) {
      if (r.submission) {
        withSubmission += 1;
        accepted += Number(r.submission.accepted_hours ?? 0);
        declined += Number(r.submission.declined_hours ?? 0);
        if (r.submission.decision_status === 'accepted' || r.submission.decision_status === 'partial') {
          acceptedRows += 1;
          if (r.publish?.homebase_posted_at) homebaseDone += 1;
          if (r.publish?.ehr_posted_at) ehrDone += 1;
        }
      }
    }
    const homebasePct = acceptedRows ? Math.round((homebaseDone / acceptedRows) * 100) : 0;
    const ehrPct = acceptedRows ? Math.round((ehrDone / acceptedRows) * 100) : 0;
    return {
      accepted,
      declined,
      homebasePct,
      ehrPct,
      withSubmission,
      acceptedRows,
      homebaseDone,
      ehrDone,
    };
  }, [rows]);

  const handleToggle = (
    row: ProviderPublishView,
    step: 'homebase' | 'ehr',
    nextChecked: boolean,
  ) => {
    toggle.mutate(
      {
        provider_id: row.provider_id,
        target_month: month,
        step,
        done: nextChecked,
      },
      {
        onError: e => toast.error(`Could not save: ${(e as Error).message}`),
      },
    );
  };

  const openDrill = (row: ProviderPublishView) => {
    setDrillRow(row);
    setNotesDraft(row.publish?.notes ?? '');
  };

  const saveNotes = () => {
    if (!drillRow) return;
    updateNotes.mutate(
      {
        provider_id: drillRow.provider_id,
        target_month: month,
        notes: notesDraft.trim() ? notesDraft : null,
      },
      {
        onSuccess: () => toast.success('Notes saved'),
        onError: e => toast.error(`Could not save notes: ${(e as Error).message}`),
      },
    );
  };

  const reevaluateNow = () => {
    reevaluate.mutate(month, {
      onSuccess: () => {
        toast.success(`Re-evaluated ${formatMonthLabel(month)}`);
        refetch();
      },
      onError: e => toast.error(`Re-evaluation failed: ${(e as Error).message}`),
    });
  };

  const drillShifts: ParsedShift[] = useMemo(() => {
    if (!drillRow?.submission?.parsed_shifts) return [];
    const raw = drillRow.submission.parsed_shifts;
    return Array.isArray(raw) ? raw : [];
  }, [drillRow]);

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
                <Calendar className="h-6 w-6 text-emerald-600" />
                Workbench · Monthly Publish
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Review accepted and declined hours per provider, then mark each provider as
                posted to Homebase and the EHR.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map(m => (
                    <SelectItem key={m} value={m}>
                      {formatMonthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={reevaluateNow}
                disabled={reevaluate.isPending}
              >
                {reevaluate.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Re-run evaluator
              </Button>
            </div>
          </div>

          <Tabs defaultValue="publish">
            <TabsList>
              <TabsTrigger value="publish">Monthly Publish</TabsTrigger>
              <TabsTrigger value="state">State Coverage</TabsTrigger>
            </TabsList>

            <TabsContent value="publish" className="space-y-6 mt-4">

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Accepted hours
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.accepted.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  across {summary.acceptedRows} providers
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Declined hours
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.declined.toFixed(0)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Posted to Homebase
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.homebasePct}%</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {summary.homebaseDone} of {summary.acceptedRows}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Posted to EHR
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.ehrPct}%</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {summary.ehrDone} of {summary.acceptedRows}
                </div>
              </CardContent>
            </Card>
          </div>

          {!isLoading && rows.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No submissions found for {formatMonthLabel(month)}. Run the evaluator or pick a
                different month.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <CardTitle className="text-base">
                  Providers · {formatMonthLabel(month)}
                </CardTitle>
                <Input
                  placeholder="Filter by name, status, profession"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  className="md:w-72"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading submissions
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Accepted</TableHead>
                      <TableHead className="text-right">Declined</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-center">Homebase</TableHead>
                      <TableHead className="text-center">EHR</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(row => {
                      const sub = row.submission;
                      const canPublish =
                        sub?.decision_status === 'accepted' ||
                        sub?.decision_status === 'partial';
                      const homebaseDone = !!row.publish?.homebase_posted_at;
                      const ehrDone = !!row.publish?.ehr_posted_at;
                      return (
                        <TableRow key={row.provider_id}>
                          <TableCell>
                            <div className="font-medium">{row.provider_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.profession ?? '—'}
                              {row.employment_type ? ` · ${row.employment_type}` : ''}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={sub?.decision_status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatHours(sub?.accepted_hours)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatHours(sub?.declined_hours)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {sub ? formatDateTime(sub.submitted_at) : '—'}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <Checkbox
                                checked={homebaseDone}
                                disabled={!canPublish || toggle.isPending}
                                onCheckedChange={v => handleToggle(row, 'homebase', !!v)}
                                aria-label={`Homebase posted for ${row.provider_name}`}
                              />
                              {homebaseDone && (
                                <span className="text-[10px] text-muted-foreground">
                                  {formatDateTime(row.publish?.homebase_posted_at ?? null)}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <Checkbox
                                checked={ehrDone}
                                disabled={!canPublish || toggle.isPending}
                                onCheckedChange={v => handleToggle(row, 'ehr', !!v)}
                                aria-label={`EHR posted for ${row.provider_name}`}
                              />
                              {ehrDone && (
                                <span className="text-[10px] text-muted-foreground">
                                  {formatDateTime(row.publish?.ehr_posted_at ?? null)}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => openDrill(row)}>
                              Details
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No matching providers.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="state" className="space-y-6 mt-4">
              <StateCoveragePanel month={month} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Dialog open={!!drillRow} onOpenChange={o => !o && setDrillRow(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{drillRow?.provider_name}</DialogTitle>
            <DialogDescription>
              {drillRow ? formatMonthLabel(month) : ''} · submission detail
            </DialogDescription>
          </DialogHeader>

          {drillRow?.submission ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <StatusBadge status={drillRow.submission.decision_status} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Accepted</div>
                  <div className="font-medium">
                    {formatHours(drillRow.submission.accepted_hours)} hrs
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Declined</div>
                  <div className="font-medium">
                    {formatHours(drillRow.submission.declined_hours)} hrs
                  </div>
                </div>
              </div>

              {drillRow.submission.decision_notes && (
                <Alert>
                  <AlertDescription className="text-xs whitespace-pre-wrap">
                    {drillRow.submission.decision_notes}
                  </AlertDescription>
                </Alert>
              )}

              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Submitted shifts ({drillShifts.length})
                </div>
                {drillShifts.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No parsed shifts.</div>
                ) : (
                  <div className="border rounded-md max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Time</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Hours</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {drillShifts.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{s.date ?? '—'}</TableCell>
                            <TableCell className="text-xs">
                              {s.start_time ?? '—'} – {s.end_time ?? '—'}
                            </TableCell>
                            <TableCell className="text-xs">{s.shift_type ?? '—'}</TableCell>
                            <TableCell className="text-xs">{s.state ?? '—'}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {s.hours ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Publish notes
                </div>
                <Input
                  value={notesDraft}
                  onChange={e => setNotesDraft(e.target.value)}
                  placeholder="Anything the team should know about this provider's posting"
                />
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No submission for this provider yet.
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDrillRow(null)}>
              Close
            </Button>
            {drillRow?.submission && (
              <Button onClick={saveNotes} disabled={updateNotes.isPending}>
                {updateNotes.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : null}
                Save notes
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const StateCoveragePanel = ({ month }: { month: string }) => {
  const { data, isLoading } = useStateCoverage(month);
  const rows = data?.rows ?? [];
  const inHomeHours = data?.inHomeHours ?? 0;
  const inHomeBreakdown = data?.inHomeBreakdown ?? [];
  const otherUnassigned = data?.otherUnassignedHours ?? 0;

  const totals = rows.reduce(
    (acc, r) => {
      acc.needed += r.needed;
      acc.filled += r.filled;
      acc.leftover += r.leftover;
      return acc;
    },
    { needed: 0, filled: 0, leftover: 0 },
  );

  const exportCsv = () => {
    downloadCSV(
      rows.map(r => ({
        state: r.state,
        needed_hours: r.needed.toFixed(1),
        filled_hours: r.filled.toFixed(1),
        leftover_hours: r.leftover.toFixed(1),
        pct_filled: r.pct_filled.toFixed(0),
      })),
      `state-coverage-${month}.csv`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Needed (network)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.needed.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground mt-1">hours / month</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Filled (network)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.filled.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {totals.needed > 0
                ? `${Math.round((totals.filled / totals.needed) * 100)}% of need`
                : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Leftover (gap)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                totals.leftover > 0 ? 'text-red-600' : 'text-emerald-600'
              }`}
            >
              {totals.leftover.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {totals.leftover > 0 ? 'hours under target' : 'fully covered'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              In-home / clinic
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inHomeHours.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              hours, scheduled outside telehealth forecast
            </div>
          </CardContent>
        </Card>
      </div>

      {(inHomeBreakdown.length > 0 || otherUnassigned > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">In-home / clinic shifts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Shifts</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inHomeBreakdown.map(p => (
                  <TableRow key={p.provider_name}>
                    <TableCell className="font-medium">{p.provider_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.shifts}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.hours.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
                {otherUnassigned > 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground italic">
                      Other unassigned (data gap, please review)
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right tabular-nums">
                      {otherUnassigned.toFixed(1)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600" />
              Coverage by state
            </CardTitle>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No demand or filled shifts for this month yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Needed</TableHead>
                  <TableHead className="text-right">Filled</TableHead>
                  <TableHead className="text-right">Leftover</TableHead>
                  <TableHead className="w-[200px]">% filled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const pct = Math.min(100, r.pct_filled);
                  const isOver = r.leftover < 0;
                  const isShort = r.leftover > 0 && r.needed > 0;
                  return (
                    <TableRow key={r.state}>
                      <TableCell className="font-medium">{r.state}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.needed.toFixed(0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.filled.toFixed(0)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          isShort ? 'text-red-600' : isOver ? 'text-amber-600' : ''
                        }`}
                      >
                        {r.leftover.toFixed(0)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-2 flex-1" />
                          <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                            {r.pct_filled > 999 ? '999+' : `${Math.round(r.pct_filled)}%`}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WorkbenchPage;
