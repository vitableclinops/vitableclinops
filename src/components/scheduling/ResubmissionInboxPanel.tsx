import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
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
import {
  AlertCircle,
  Check,
  Inbox,
  Loader2,
  PauseCircle,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  canonicalizeParsedShifts,
  canonicalShiftHours,
  diffParsedShifts,
  extractProviderNotes,
  type CanonicalSubmission,
  type SubmissionDiff,
} from '@/lib/scheduling/submissionDiff';
import { ProviderNoteIndicator, ProviderNotesCard } from '@/components/scheduling/ProviderNotesCard';
import {
  groupSubmissionsForInbox,
  isHomebaseDone,
  isEhrDone,
  useResolveResubmission,
  useShiftRecommendationsInboxWindow,
  type ResubmissionGroup,
  type ShiftRow,
  type SubmissionForInbox,
} from '@/hooks/useMonthlyPublish';

const formatDow = (s: string) =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const formatMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return iso;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatMonthShort = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  if (!y || !m) return iso;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const formatTimestamp = (iso: string) => new Date(iso).toLocaleString();

const formatRelative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

const formatTime = (min: number): string => {
  const safe = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const describeRange = (startMin: number, endMin: number) =>
  `${formatTime(startMin)}–${formatTime(endMin)}`;

// Operating-hours window (mirrors the evaluator).
const isOutsideOperatingHours = (
  dateIso: string | null,
  startMin: number,
  endMin: number,
): boolean => {
  let isWeekend = false;
  if (dateIso) {
    const [y, m, d] = dateIso.split('-').map(Number);
    if (y && m && d) {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      isWeekend = dow === 0 || dow === 6;
    }
  }
  const winStart = isWeekend ? 9 * 60 : 9 * 60;
  const winEnd = isWeekend ? 12 * 60 : 21 * 60;
  return startMin < winStart || endMin > winEnd;
};

type NecessitySignals = {
  publishedShiftHits: ShiftRow[];
  offHoursAdditions: string[];
  hoursDeltaWeekly: number;
  hoursDeltaOneOff: number;
  hoursDeltaInHome: number;
};

function computeNecessity(
  diff: SubmissionDiff,
  prior: CanonicalSubmission,
  next: CanonicalSubmission,
  publishedShifts: ShiftRow[],
): NecessitySignals {
  // Touches-already-published: which prior shifts were removed or modified
  // and already have publish_status=published_to_homebase or confirmed?
  const removedOrModifiedDates = new Set<string>();
  for (const r of diff.oneOff.removed) removedOrModifiedDates.add(r.date);
  for (const r of diff.oneOff.modified) removedOrModifiedDates.add(r.before.date);
  for (const r of diff.inHome.removed) removedOrModifiedDates.add(r.date);
  for (const r of diff.inHome.modified) removedOrModifiedDates.add(r.before.date);
  // For recurring changes, treat all dates of that weekday as candidates.
  const removedOrModifiedDows = new Set<string>();
  for (const r of diff.recurring.removed) removedOrModifiedDows.add(r.dayOfWeek.toLowerCase());
  for (const r of diff.recurring.modified)
    removedOrModifiedDows.add(r.before.dayOfWeek.toLowerCase());

  const publishedShiftHits: ShiftRow[] = [];
  const DOW_NAME = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const s of publishedShifts) {
    if (!isHomebaseDone(s) && !isEhrDone(s)) continue;
    if (removedOrModifiedDates.has(s.shift_date)) {
      publishedShiftHits.push(s);
      continue;
    }
    const [y, m, d] = s.shift_date.split('-').map(Number);
    if (!y || !m || !d) continue;
    const dow = DOW_NAME[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    if (removedOrModifiedDows.has(dow)) publishedShiftHits.push(s);
  }

  // Off-hours additions
  const offHoursAdditions: string[] = [];
  for (const r of diff.recurring.added) {
    if (isOutsideOperatingHours(null, r.startMin, r.endMin)) {
      offHoursAdditions.push(`${formatDow(r.dayOfWeek)} ${describeRange(r.startMin, r.endMin)}`);
    }
  }
  for (const r of diff.recurring.modified) {
    if (isOutsideOperatingHours(null, r.after.startMin, r.after.endMin)) {
      offHoursAdditions.push(
        `${formatDow(r.after.dayOfWeek)} (modified) ${describeRange(r.after.startMin, r.after.endMin)}`,
      );
    }
  }
  for (const r of diff.oneOff.added) {
    if (isOutsideOperatingHours(r.date, r.startMin, r.endMin)) {
      offHoursAdditions.push(`${formatDate(r.date)} ${describeRange(r.startMin, r.endMin)}`);
    }
  }
  for (const r of diff.oneOff.modified) {
    if (isOutsideOperatingHours(r.after.date, r.after.startMin, r.after.endMin)) {
      offHoursAdditions.push(
        `${formatDate(r.after.date)} (modified) ${describeRange(r.after.startMin, r.after.endMin)}`,
      );
    }
  }

  const priorHours = canonicalShiftHours(prior);
  const nextHours = canonicalShiftHours(next);

  return {
    publishedShiftHits,
    offHoursAdditions,
    hoursDeltaWeekly: Math.round((nextHours.recurringWeekly - priorHours.recurringWeekly) * 10) / 10,
    hoursDeltaOneOff: Math.round((nextHours.oneOffTotal - priorHours.oneOffTotal) * 10) / 10,
    hoursDeltaInHome: Math.round((nextHours.inHomeTotal - priorHours.inHomeTotal) * 10) / 10,
  };
}

type EnrichedGroup = ResubmissionGroup & {
  diff: SubmissionDiff;
  prior: SubmissionForInbox & { canonical: CanonicalSubmission };
  latest: SubmissionForInbox & { canonical: CanonicalSubmission };
  signals: NecessitySignals;
};

export function ResubmissionInboxPanel({
  anchorMonth,
  submissions,
  isLoading,
}: {
  anchorMonth: string;
  submissions: SubmissionForInbox[];
  isLoading: boolean;
}) {
  // Cross-month published-shifts map so the "touches already-published"
  // signal stays accurate for resubmissions that span multiple months.
  const { data: windowShifts = [] } = useShiftRecommendationsInboxWindow(anchorMonth);
  const shiftsByProvider = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of windowShifts) {
      if (!s.provider_id) continue;
      if (!map.has(s.provider_id)) map.set(s.provider_id, []);
      map.get(s.provider_id)!.push(s);
    }
    return map;
  }, [windowShifts]);

  const allEnriched: EnrichedGroup[] = useMemo(() => {
    const groups = groupSubmissionsForInbox(submissions);
    return groups
      .map(g => {
        const priorCanonical = canonicalizeParsedShifts(g.prior.parsed_shifts);
        const latestCanonical = canonicalizeParsedShifts(g.latest.parsed_shifts);
        const diff = diffParsedShifts(g.prior.parsed_shifts, g.latest.parsed_shifts);
        const publishedShifts = shiftsByProvider.get(g.provider_id) ?? [];
        const signals = computeNecessity(diff, priorCanonical, latestCanonical, publishedShifts);
        return {
          ...g,
          diff,
          prior: { ...g.prior, canonical: priorCanonical },
          latest: { ...g.latest, canonical: latestCanonical },
          signals,
        };
      })
      .filter(g => g.diff.hasChanges || g.latest.human_review_state === 'pending');
  }, [submissions, shiftsByProvider]);

  // Month chips for filtering. Default = all months in scope. Provider may
  // resubmit May while we're scheduling June, so showing every month at once
  // is the default.
  const monthsInScope = useMemo(() => {
    const set = new Set(allEnriched.map(g => g.target_month));
    return Array.from(set).sort();
  }, [allEnriched]);

  const [monthFilter, setMonthFilter] = useState<string>('all');

  const enriched = useMemo(
    () => (monthFilter === 'all' ? allEnriched : allEnriched.filter(g => g.target_month === monthFilter)),
    [allEnriched, monthFilter],
  );

  const [open, setOpen] = useState<EnrichedGroup | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading inbox
        </CardContent>
      </Card>
    );
  }

  if (allEnriched.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No resubmissions to review. Every provider has either one submission
          per month or no content-changing follow-ups.
        </AlertDescription>
      </Alert>
    );
  }

  // Group counts per month for the filter labels.
  const countsByMonth = new Map<string, number>();
  for (const g of allEnriched) {
    countsByMonth.set(g.target_month, (countsByMonth.get(g.target_month) ?? 0) + 1);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4 text-blue-600" />
                Resubmission inbox
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {allEnriched.length} resubmission{allEnriched.length === 1 ? '' : 's'} across{' '}
                {monthsInScope.length} month{monthsInScope.length === 1 ? '' : 's'}. Providers can
                resubmit any month at any time — each (provider, month) is reviewed independently.
                Open a card to see prior vs new, the diff, and whether the change is worth taking
                on (Approve) or pushing back on (Park).
              </p>
            </div>
            {monthsInScope.length > 1 && (
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All months ({allEnriched.length})</SelectItem>
                  {monthsInScope.map(m => (
                    <SelectItem key={m} value={m}>
                      {formatMonthShort(m)} ({countsByMonth.get(m) ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>For month</TableHead>
                <TableHead>Latest submission</TableHead>
                <TableHead>Top changes</TableHead>
                <TableHead className="text-right">Signals</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map(g => (
                <TableRow
                  key={`${g.provider_id}|${g.target_month}`}
                  className="cursor-pointer"
                  onClick={() => setOpen(g)}
                >
                  <TableCell>
                    <div className="font-medium">{g.provider_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.others.length > 0
                        ? `${g.others.length + 2} total submissions`
                        : '2 submissions'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-900">
                      {formatMonthShort(g.target_month)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>{formatRelative(g.latest.submitted_at)}</div>
                    <div className="text-[10px] opacity-70">
                      {formatTimestamp(g.latest.submitted_at)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-md">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {g.diff.summary.slice(0, 2).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                      {g.diff.summary.length > 2 && (
                        <li className="text-muted-foreground italic">
                          +{g.diff.summary.length - 2} more
                        </li>
                      )}
                    </ul>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 flex-wrap">
                      <ProviderNoteIndicator parsedShifts={g.latest.parsed_shifts} />
                      {g.signals.publishedShiftHits.length > 0 && (
                        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
                          {g.signals.publishedShiftHits.length} published
                        </Badge>
                      )}
                      {g.signals.offHoursAdditions.length > 0 && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          off-hours
                        </Badge>
                      )}
                      {g.signals.hoursDeltaWeekly !== 0 && (
                        <Badge className="bg-slate-100 text-slate-800 hover:bg-slate-100">
                          {g.signals.hoursDeltaWeekly > 0 ? '+' : ''}
                          {g.signals.hoursDeltaWeekly}h/wk
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="h-7">
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <ResubmissionDialog
          group={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function ResubmissionDialog({
  group,
  onClose,
}: {
  group: EnrichedGroup;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState('');
  const resolve = useResolveResubmission();

  const handle = (action: 'approved' | 'parked') => {
    resolve.mutate(
      {
        submission_id: group.latest.id,
        action,
        notes: notes.trim() || undefined,
        provider_id: group.provider_id,
        target_month: group.target_month,
      },
      {
        onSuccess: () => {
          toast.success(
            action === 'approved'
              ? `Approved ${group.provider_name}'s ${formatMonthShort(group.target_month)} submission · re-evaluating`
              : `Parked ${group.provider_name}'s ${formatMonthShort(group.target_month)} submission`,
          );
          onClose();
        },
        onError: e => toast.error(`Could not save: ${(e as Error).message}`),
      },
    );
  };

  const handleUnpark = () => {
    resolve.mutate(
      {
        submission_id: group.latest.id,
        action: 'pending',
        notes: notes.trim() || undefined,
        provider_id: group.provider_id,
        target_month: group.target_month,
      },
      {
        onSuccess: () => {
          toast.success(`Returned ${group.provider_name}'s submission to the inbox`);
          onClose();
        },
        onError: e => toast.error(`Could not save: ${(e as Error).message}`),
      },
    );
  };

  return (
    <Dialog open={true} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-blue-600" />
            {group.provider_name} · {formatMonth(group.target_month)}
          </DialogTitle>
          <DialogDescription>
            Latest submission {formatRelative(group.latest.submitted_at)} (
            {formatTimestamp(group.latest.submitted_at)}). Prior submission{' '}
            {formatRelative(group.prior.submitted_at)} (
            {formatTimestamp(group.prior.submitted_at)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ProviderNotesCard
            parsedShifts={group.latest.parsed_shifts}
            title="Provider's note on the new submission"
          />
          <ProviderNotesCard
            parsedShifts={group.prior.parsed_shifts}
            title="Provider's note on the prior submission"
          />
          <SignalsCard signals={group.signals} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What changed</CardTitle>
            </CardHeader>
            <CardContent>
              {group.diff.summary.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  {group.diff.filteredPastCount > 0
                    ? `Only past-date entries differ (${group.diff.filteredPastCount} ignored as stale). Providers add hours incrementally during the month — past dates not re-listed aren't a real removal. If this provider needs to CANCEL a future date, they should add it to the "When will you be unavailable" section of the form.`
                    : 'No structural changes detected (likely a duplicate submission).'}
                </p>
              ) : (
                <>
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    {group.diff.summary.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                  {group.diff.filteredPastCount > 0 && (
                    <p className="text-xs text-muted-foreground italic mt-3">
                      {group.diff.filteredPastCount} past-date entr
                      {group.diff.filteredPastCount === 1 ? 'y was' : 'ies were'} ignored —
                      providers add hours throughout the month and stale past entries aren't
                      real changes. Future-date cancellations should be entered in the
                      "unavailable" section instead.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SubmissionDetail
              title="Prior submission"
              subtitle={formatRelative(group.prior.submitted_at)}
              canonical={group.prior.canonical}
            />
            <SubmissionDetail
              title="New submission"
              subtitle={formatRelative(group.latest.submitted_at)}
              canonical={group.latest.canonical}
              highlight
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Notes (optional)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="e.g. Confirmed via Slack — provider needs to keep PA Tuesday but cut FL one-offs"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
              />
              {group.latest.human_review_state === 'parked' && (
                <p className="text-xs text-amber-700 mt-2">
                  This submission is currently parked. Approve to use it as authoritative, or
                  un-park to return it to the inbox.
                </p>
              )}
              {group.latest.human_review_state === 'pending' && (
                <p className="text-xs text-blue-700 mt-2">
                  Pending review. The evaluator is gated on this group until you Approve or
                  Park.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={resolve.isPending}>
            Cancel
          </Button>
          {group.latest.human_review_state === 'parked' && (
            <Button
              variant="outline"
              onClick={handleUnpark}
              disabled={resolve.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Un-park
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => handle('parked')}
            disabled={resolve.isPending}
          >
            <PauseCircle className="h-4 w-4 mr-1" />
            Park
          </Button>
          <Button onClick={() => handle('approved')} disabled={resolve.isPending}>
            {resolve.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignalsCard({ signals }: { signals: NecessitySignals }) {
  const noConcerns =
    signals.publishedShiftHits.length === 0 &&
    signals.offHoursAdditions.length === 0 &&
    signals.hoursDeltaWeekly === 0 &&
    signals.hoursDeltaOneOff === 0 &&
    signals.hoursDeltaInHome === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Is this change necessary?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {noConcerns ? (
          <p className="text-muted-foreground italic">
            No high-impact signals. Safe to approve if the diff looks correct.
          </p>
        ) : (
          <ul className="space-y-1">
            {signals.publishedShiftHits.length > 0 && (
              <li className="flex items-start gap-2">
                <span className="inline-block w-2 h-2 mt-1.5 rounded-full bg-red-500 shrink-0" />
                <span>
                  <strong>{signals.publishedShiftHits.length} already-published shift
                    {signals.publishedShiftHits.length === 1 ? '' : 's'}</strong>{' '}
                  would be affected by this change — see list below. Reverting Homebase /
                  EHR is manual work, so push back if the change isn't justified.
                </span>
              </li>
            )}
            {signals.offHoursAdditions.length > 0 && (
              <li className="flex items-start gap-2">
                <span className="inline-block w-2 h-2 mt-1.5 rounded-full bg-amber-500 shrink-0" />
                <span>
                  <strong>{signals.offHoursAdditions.length} new shift
                    {signals.offHoursAdditions.length === 1 ? '' : 's'} outside operating hours</strong>{' '}
                  (9a–9p ET weekdays / 9a–12p ET weekends) — these will be auto-trimmed by the
                  evaluator, so they aren't useful capacity.
                </span>
              </li>
            )}
            {(signals.hoursDeltaWeekly !== 0 ||
              signals.hoursDeltaOneOff !== 0 ||
              signals.hoursDeltaInHome !== 0) && (
              <li className="flex items-start gap-2">
                <span className="inline-block w-2 h-2 mt-1.5 rounded-full bg-slate-500 shrink-0" />
                <span>
                  Net change in submitted capacity:
                  {signals.hoursDeltaWeekly !== 0 && (
                    <>
                      {' '}
                      <strong>
                        {signals.hoursDeltaWeekly > 0 ? '+' : ''}
                        {signals.hoursDeltaWeekly}h/wk
                      </strong>{' '}
                      recurring
                    </>
                  )}
                  {signals.hoursDeltaOneOff !== 0 && (
                    <>
                      ,{' '}
                      <strong>
                        {signals.hoursDeltaOneOff > 0 ? '+' : ''}
                        {signals.hoursDeltaOneOff}h
                      </strong>{' '}
                      one-off
                    </>
                  )}
                  {signals.hoursDeltaInHome !== 0 && (
                    <>
                      ,{' '}
                      <strong>
                        {signals.hoursDeltaInHome > 0 ? '+' : ''}
                        {signals.hoursDeltaInHome}h
                      </strong>{' '}
                      in-home
                    </>
                  )}
                  .
                </span>
              </li>
            )}
          </ul>
        )}
        {signals.publishedShiftHits.length > 0 && (
          <div className="mt-2 border-l-2 border-red-300 pl-3">
            <p className="text-xs text-muted-foreground mb-1">Affected published shifts:</p>
            <ul className="text-xs space-y-0.5">
              {signals.publishedShiftHits.slice(0, 6).map(s => (
                <li key={s.id}>
                  {formatDate(s.shift_date)} · {describeRange(s.start_min, s.end_min)} ·{' '}
                  <span className="text-muted-foreground">
                    {isEhrDone(s) ? 'Homebase + EHR' : 'Homebase'}
                  </span>
                </li>
              ))}
              {signals.publishedShiftHits.length > 6 && (
                <li className="text-muted-foreground italic">
                  + {signals.publishedShiftHits.length - 6} more
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SubmissionDetail({
  title,
  subtitle,
  canonical,
  highlight,
}: {
  title: string;
  subtitle: string;
  canonical: CanonicalSubmission;
  highlight?: boolean;
}) {
  const hours = canonicalShiftHours(canonical);
  return (
    <Card className={highlight ? 'border-blue-300 bg-blue-50/30' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {hours.recurringWeekly}h/wk recurring · {hours.oneOffTotal}h one-off ·{' '}
          {hours.inHomeTotal}h in-home
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {canonical.recurring.length > 0 && (
          <div>
            <div className="font-medium text-muted-foreground mb-1">Recurring</div>
            <ul className="space-y-0.5">
              {canonical.recurring.map((r, i) => (
                <li key={i}>
                  {formatDow(r.dayOfWeek)} {describeRange(r.startMin, r.endMin)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canonical.oneOff.length > 0 && (
          <div>
            <div className="font-medium text-muted-foreground mb-1">One-off virtual</div>
            <ul className="space-y-0.5">
              {canonical.oneOff.map((r, i) => (
                <li key={i}>
                  {formatDate(r.date)} {describeRange(r.startMin, r.endMin)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canonical.inHome.length > 0 && (
          <div>
            <div className="font-medium text-muted-foreground mb-1">In-home / clinic</div>
            <ul className="space-y-0.5">
              {canonical.inHome.map((r, i) => (
                <li key={i}>
                  {formatDate(r.date)} {describeRange(r.startMin, r.endMin)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canonical.unavailableDates.length > 0 && (
          <div>
            <div className="font-medium text-muted-foreground mb-1">
              Days off ({canonical.unavailableDates.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {canonical.unavailableDates.map(d => (
                <Badge
                  key={d}
                  variant="outline"
                  className="bg-amber-50 border-amber-200 text-amber-900 font-normal"
                >
                  {formatDate(d)}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {canonical.recurring.length === 0 &&
          canonical.oneOff.length === 0 &&
          canonical.inHome.length === 0 &&
          canonical.unavailableDates.length === 0 && (
            <p className="text-muted-foreground italic">No shifts submitted.</p>
          )}
      </CardContent>
    </Card>
  );
}
