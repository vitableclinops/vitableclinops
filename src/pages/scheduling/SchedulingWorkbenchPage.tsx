import { useMemo, useState, Fragment } from 'react';
import SchedulingShell from './SchedulingShell';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  Calendar,
  AlertCircle,
  CalendarCheck,
  CalendarX,
  RefreshCw,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import {
  useMonthlyPublishView,
  useTogglePublishStep,
  useBulkMarkPublishStep,
  useReevaluateMonth,
  type ProviderPublishView,
  type DecisionStatus,
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

const formatHours = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toFixed(1);

const formatDateLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

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

export default function SchedulingWorkbenchPage() {
  const [month, setMonth] = useState('2026-06-01');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded(p => ({ ...p, [id]: !p[id] }));

  const { data: rows = [], isLoading, refetch } = useMonthlyPublishView(month);
  const toggle = useTogglePublishStep();
  const bulk = useBulkMarkPublishStep();
  const reevaluate = useReevaluateMonth();

  const acceptedRows = useMemo(
    () =>
      rows.filter(
        r =>
          r.submission?.decision_status === 'accepted' ||
          r.submission?.decision_status === 'partial',
      ),
    [rows],
  );

  const declinedRows = useMemo(
    () => rows.filter(r => r.submission?.decision_status === 'declined'),
    [rows],
  );

  const filteredAccepted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return acceptedRows;
    return acceptedRows.filter(
      r =>
        r.provider_name.toLowerCase().includes(q) ||
        (r.profession ?? '').toLowerCase().includes(q),
    );
  }, [acceptedRows, filter]);

  const summary = useMemo(() => {
    const total = acceptedRows.length;
    const homebaseDone = acceptedRows.filter(r => r.publish?.homebase_posted_at).length;
    const ehrDone = acceptedRows.filter(r => r.publish?.ehr_posted_at).length;
    const declinedCount = declinedRows.length;
    return { total, homebaseDone, ehrDone, declinedCount };
  }, [acceptedRows, declinedRows]);

  const handleToggle = (row: ProviderPublishView, step: 'homebase' | 'ehr', done: boolean) => {
    toggle.mutate(
      { provider_id: row.provider_id, target_month: month, step, done },
      { onError: e => toast.error(`Could not save: ${(e as Error).message}`) },
    );
  };

  const handleBulkAll = (step: 'homebase' | 'ehr') => {
    const ids = filteredAccepted.map(r => r.provider_id);
    if (ids.length === 0) {
      toast.info('No providers to mark.');
      return;
    }
    bulk.mutate(
      { provider_ids: ids, target_month: month, step, done: true },
      {
        onSuccess: () =>
          toast.success(
            `Marked ${ids.length} provider${ids.length === 1 ? '' : 's'} as posted to ${
              step === 'homebase' ? 'Homebase' : 'the EHR'
            }`,
          ),
        onError: e => toast.error(`Bulk mark failed: ${(e as Error).message}`),
      },
    );
  };

  const handleBulkProvider = (row: ProviderPublishView, step: 'homebase' | 'ehr') => {
    handleToggle(row, step, true);
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

  return (
    <SchedulingShell>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-emerald-600" />
            Scheduling Workbench
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review accepted shifts, then mark each provider as posted to Homebase and the EHR.
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Providers to publish" value={summary.total.toString()} />
        <SummaryCard
          label="Posted to Homebase"
          value={`${summary.total ? Math.round((summary.homebaseDone / summary.total) * 100) : 0}%`}
          sub={`${summary.homebaseDone} of ${summary.total}`}
        />
        <SummaryCard
          label="Posted to EHR"
          value={`${summary.total ? Math.round((summary.ehrDone / summary.total) * 100) : 0}%`}
          sub={`${summary.ehrDone} of ${summary.total}`}
        />
        <SummaryCard label="Declined" value={summary.declinedCount.toString()} />
      </div>

      {!isLoading && rows.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No submissions found for {formatMonthLabel(month)}. Pick a different month or run the
            evaluator.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="provider">
        <TabsList>
          <TabsTrigger value="provider">By Provider</TabsTrigger>
          <TabsTrigger value="day">By Day</TabsTrigger>
          <TabsTrigger value="declined">Declined</TabsTrigger>
        </TabsList>

        <TabsContent value="provider" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <CardTitle className="text-base">
                  Approved providers · {formatMonthLabel(month)}
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Filter by name or profession"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="md:w-64"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulk.isPending || filteredAccepted.length === 0}
                    onClick={() => handleBulkAll('homebase')}
                  >
                    <CalendarCheck className="h-4 w-4 mr-1" />
                    Mark all Homebase
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulk.isPending || filteredAccepted.length === 0}
                    onClick={() => handleBulkAll('ehr')}
                  >
                    <CalendarCheck className="h-4 w-4 mr-1" />
                    Mark all EHR
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <LoadingRow label="Loading providers" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-center">Homebase</TableHead>
                      <TableHead className="text-center">EHR</TableHead>
                      <TableHead className="text-right">Confirm</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAccepted.map(row => {
                      const sub = row.submission!;
                      const homebaseDone = !!row.publish?.homebase_posted_at;
                      const ehrDone = !!row.publish?.ehr_posted_at;
                      const shifts = Array.isArray(sub.parsed_shifts) ? sub.parsed_shifts : [];
                      const isOpen = !!expanded[row.provider_id];
                      return (
                        <Fragment key={row.provider_id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleExpanded(row.provider_id)}
                        >
                          <TableCell className="w-8 align-top">
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.provider_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.profession ?? '—'}
                              {row.employment_type ? ` · ${row.employment_type}` : ''}
                              {' · '}
                              {shifts.length} shift{shifts.length === 1 ? '' : 's'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={sub.decision_status} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatHours(sub.accepted_hours)}
                          </TableCell>
                          <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={homebaseDone}
                              onCheckedChange={c => handleToggle(row, 'homebase', !!c)}
                            />
                          </TableCell>
                          <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={ehrDone}
                              onCheckedChange={c => handleToggle(row, 'ehr', !!c)}
                            />
                          </TableCell>
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              {!homebaseDone && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => handleBulkProvider(row, 'homebase')}
                                >
                                  HB
                                </Button>
                              )}
                              {!ehrDone && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => handleBulkProvider(row, 'ehr')}
                                >
                                  EHR
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={6} className="py-2">
                              {shifts.length === 0 ? (
                                <div className="text-xs text-muted-foreground italic">
                                  No shifts parsed for this submission.
                                </div>
                              ) : (
                                <ul className="text-xs space-y-1">
                                  {shifts
                                    .slice()
                                    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
                                    .map((s, i) => (
                                      <li key={i} className="flex items-center gap-2 tabular-nums">
                                        <span className="font-medium w-32">
                                          {s.date ? formatDateLabel(s.date) : '—'}
                                        </span>
                                        <span className="text-muted-foreground w-32">
                                          {(s.start_time ?? '?')}–{(s.end_time ?? '?')}
                                        </span>
                                        <span className="w-16 text-right">
                                          {formatHours(s.hours ?? null)}h
                                        </span>
                                        {s.state && (
                                          <Badge variant="outline" className="text-[10px]">
                                            {s.state}
                                          </Badge>
                                        )}
                                        {s.shift_type && (
                                          <span className="text-muted-foreground">
                                            {s.shift_type}
                                          </span>
                                        )}
                                        {s.notes && (
                                          <span className="text-muted-foreground italic">
                                            {s.notes}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                </ul>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      );
                    })}
                    {filteredAccepted.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No approved providers match.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="day" className="mt-4 space-y-4">
          <ByDayPanel
            month={month}
            acceptedRows={acceptedRows}
            isLoading={isLoading}
            onMarkProvider={handleToggle}
          />
        </TabsContent>

        <TabsContent value="declined" className="mt-4 space-y-4">
          <DeclinedPanel month={month} declinedRows={declinedRows} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </SchedulingShell>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      {label}
    </div>
  );
}

type DayBucket = {
  date: string;
  entries: Array<{
    row: ProviderPublishView;
    shift: ParsedShift;
  }>;
};

function ByDayPanel({
  month,
  acceptedRows,
  isLoading,
  onMarkProvider,
}: {
  month: string;
  acceptedRows: ProviderPublishView[];
  isLoading: boolean;
  onMarkProvider: (row: ProviderPublishView, step: 'homebase' | 'ehr', done: boolean) => void;
}) {
  const days = useMemo<DayBucket[]>(() => {
    const map = new Map<string, DayBucket>();
    for (const row of acceptedRows) {
      const raw = row.submission?.parsed_shifts;
      const shifts = Array.isArray(raw) ? raw : [];
      for (const s of shifts) {
        if (!s.date) continue;
        if (!map.has(s.date)) map.set(s.date, { date: s.date, entries: [] });
        map.get(s.date)!.entries.push({ row, shift: s });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [acceptedRows]);

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading shifts" />
        </CardContent>
      </Card>
    );
  }

  if (days.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No accepted shifts have a date set for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {days.map(day => {
        const providersOnDay = Array.from(
          new Map(day.entries.map(e => [e.row.provider_id, e.row])).values(),
        );
        const homebaseLeft = providersOnDay.filter(r => !r.publish?.homebase_posted_at);
        const ehrLeft = providersOnDay.filter(r => !r.publish?.ehr_posted_at);
        return (
          <Card key={day.date}>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{formatDateLabel(day.date)}</CardTitle>
                  <div className="text-xs text-muted-foreground mt-1">
                    {day.entries.length} shift{day.entries.length === 1 ? '' : 's'} ·{' '}
                    {providersOnDay.length} provider{providersOnDay.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={homebaseLeft.length === 0}
                    onClick={() =>
                      homebaseLeft.forEach(r => onMarkProvider(r, 'homebase', true))
                    }
                  >
                    Mark day Homebase ({homebaseLeft.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ehrLeft.length === 0}
                    onClick={() => ehrLeft.forEach(r => onMarkProvider(r, 'ehr', true))}
                  >
                    Mark day EHR ({ehrLeft.length})
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Hrs</TableHead>
                    <TableHead className="text-center">Homebase</TableHead>
                    <TableHead className="text-center">EHR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {day.entries.map((e, idx) => {
                    const homebaseDone = !!e.row.publish?.homebase_posted_at;
                    const ehrDone = !!e.row.publish?.ehr_posted_at;
                    return (
                      <TableRow key={`${e.row.provider_id}-${idx}`}>
                        <TableCell className="font-medium">{e.row.provider_name}</TableCell>
                        <TableCell className="text-xs">
                          {e.shift.start_time ?? '—'} – {e.shift.end_time ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs">{e.shift.shift_type ?? '—'}</TableCell>
                        <TableCell className="text-xs">{e.shift.state ?? '—'}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {e.shift.hours != null ? Number(e.shift.hours).toFixed(1) : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={homebaseDone}
                            onCheckedChange={c => onMarkProvider(e.row, 'homebase', !!c)}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={ehrDone}
                            onCheckedChange={c => onMarkProvider(e.row, 'ehr', !!c)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DeclinedPanel({
  month,
  declinedRows,
  isLoading,
}: {
  month: string;
  declinedRows: ProviderPublishView[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading declined" />
        </CardContent>
      </Card>
    );
  }

  if (declinedRows.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No declined submissions for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarX className="h-4 w-4 text-red-600" />
          Declined submissions · {formatMonthLabel(month)}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Declined hrs</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {declinedRows.map(r => {
              const sub = r.submission!;
              return (
                <TableRow key={r.provider_id}>
                  <TableCell>
                    <div className="font-medium">{r.provider_name}</div>
                    <div className="text-xs text-muted-foreground">{r.profession ?? '—'}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(sub.declined_hours)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(sub.submitted_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md whitespace-pre-wrap">
                    {sub.decision_notes ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}