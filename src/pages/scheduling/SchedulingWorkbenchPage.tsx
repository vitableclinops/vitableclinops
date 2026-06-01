import { useMemo, useState, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import SchedulingShell from './SchedulingShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Loader2,
  Calendar,
  AlertCircle,
  CalendarX,
  RefreshCw,
  CalendarOff,
  History,
  Inbox,
  UserCheck,
  ChevronRight,
  ChevronDown,
  Upload,
  X,
  Brain,
  UserX,
  Copy,
  LayoutDashboard,
  TrendingUp,
  Map as MapIcon,
  Send,
  ArrowRight,
} from 'lucide-react';
import {
  useMonthlyPublishView,
  useTogglePublishStep,
  useReevaluateMonth,
  extractUnavailableRanges,
  usePublishAuditLog,
  useResubmissionInbox,
  groupSubmissionsForInbox,
  type PublishAuditEntry,
  useShiftRecommendationsForMonth,
  useTogglePublishShift,
  useBulkMarkPublishShifts,
  useResolveNeedsReview,
  formatShiftTime,
  isHomebaseDone,
  isEhrDone,
  type ProviderPublishView,
  type DecisionStatus,
  type ParsedShift,
  type ShiftRow,
  type ShiftPublishStep,
} from '@/hooks/useMonthlyPublish';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { parseJotformCsv, buildShiftCandidates } from '@/lib/juneSchedule/parseJotform';
import { normName, normEmail } from '@/lib/juneSchedule/normalize';
import { ResubmissionInboxPanel } from '@/components/scheduling/ResubmissionInboxPanel';
import { OnboardingReadinessPanel } from '@/components/scheduling/OnboardingReadinessPanel';
import { UnmatchedSubmissionsPanel } from '@/components/scheduling/UnmatchedSubmissionsPanel';
import { ProviderNoteIndicator, ProviderNotesCard } from '@/components/scheduling/ProviderNotesCard';
import { diffParsedShifts } from '@/lib/scheduling/submissionDiff';
import {
  useOnboardingReadiness,
  useUnmatchedSubmissions,
} from '@/hooks/useMonthlyPublish';
import { useMonthlyDemand } from '@/hooks/useMonthlySchedulingForecast';
import { useStateCoverage } from '@/hooks/useStateCoverage';
import { cohortFor, COHORT_BUFFER_PCT, type Cohort } from '@/lib/scheduling/cohorts';

const MONTH_OPTIONS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];

const MH_PROFESSIONS = new Set([
  'mental_health_coach',
  'mh_coach',
  'lpc',
  'therapist',
  'health_coach',
]);

const isMentalHealth = (profession: string | null | undefined) =>
  !!profession && MH_PROFESSIONS.has(profession.toLowerCase().replace(/\s+/g, '_'));

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

const formatRelativeTime = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

const attributionLabel = (entry: PublishAuditEntry | undefined): string => {
  if (!entry) return '';
  const who = entry.actor_label || (entry.actor_id ? 'someone' : 'system');
  const verb =
    entry.action === 'preserved'
      ? 'preserved through evaluator re-run'
      : entry.action === 'reverted'
        ? 'reverted'
        : 'marked';
  return `${verb} by ${who} · ${formatRelativeTime(entry.created_at)}`;
};

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

const SHIFT_TYPE_LABEL: Record<string, string> = {
  virtual_recurring: 'Recurring virtual',
  virtual_oneoff: 'One-off virtual',
  in_home_clinic: 'In-home / clinic',
};

const labelShiftType = (t: string | null | undefined) => {
  if (!t) return '—';
  return SHIFT_TYPE_LABEL[t] ?? t;
};

export default function SchedulingWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState('2026-07-01');
  const initialTab = (() => {
    const t = searchParams.get('tab');
    return ['overview', 'forecast', 'availability', 'coverage', 'publish'].includes(t ?? '')
      ? (t as string)
      : 'overview';
  })();
  const [topTab, setTopTab] = useState(initialTab);
  const onTopTabChange = (v: string) => {
    setTopTab(v);
    const next = new URLSearchParams(searchParams);
    if (v === 'overview') next.delete('tab');
    else next.set('tab', v);
    setSearchParams(next, { replace: true });
  };
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded(p => ({ ...p, [id]: !p[id] }));

  const { data: dbRows = [], isLoading, refetch } = useMonthlyPublishView(month);
  const { data: shiftRows = [], isLoading: shiftsLoading, refetch: refetchShifts } =
    useShiftRecommendationsForMonth(month);
  const { data: auditEntries = [] } = usePublishAuditLog(month);
  const { data: inboxSubmissions = [], isLoading: inboxLoading } =
    useResubmissionInbox(month);
  const { data: unmatchedSubs = [] } = useUnmatchedSubmissions();
  const { data: readinessRows = [] } = useOnboardingReadiness(30);
  const setupIssuesCount = useMemo(
    () => readinessRows.filter(r => !r.readyForSubmissions).length,
    [readinessRows],
  );
  // Latest audit entry per (shift_recommendation_id, step). Used by the
  // attribution tooltips on the per-shift Homebase/EHR checkboxes.
  const auditByShift = useMemo(() => {
    const map = new Map<string, { homebase?: PublishAuditEntry; ehr?: PublishAuditEntry }>();
    for (const entry of auditEntries) {
      if (!entry.shift_recommendation_id) continue;
      const slot = map.get(entry.shift_recommendation_id) ?? {};
      if (entry.step === 'homebase' && !slot.homebase) slot.homebase = entry;
      if (entry.step === 'ehr' && !slot.ehr) slot.ehr = entry;
      map.set(entry.shift_recommendation_id, slot);
    }
    return map;
  }, [auditEntries]);
  const togglePerProvider = useTogglePublishStep();
  const togglePerShift = useTogglePublishShift();
  const bulkPerShift = useBulkMarkPublishShifts();
  const resolveReview = useResolveNeedsReview();
  const reevaluate = useReevaluateMonth();

  // Optional: override parsed_shifts from an uploaded Jotform availability file.
  const [override, setOverride] = useState<{
    fileName: string;
    byKey: Map<string, ParsedShift[]>;
    matchedProviders: number;
    totalShifts: number;
  } | null>(null);

  const handleUpload = async (file: File) => {
    try {
      let csvText: string;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        csvText = XLSX.utils.sheet_to_csv(ws);
      } else {
        csvText = await file.text();
      }
      const submissions = parseJotformCsv(csvText);
      const candidates = buildShiftCandidates(submissions, month);
      const byKey = new Map<string, ParsedShift[]>();
      for (const c of candidates) {
        const arr = byKey.get(c.providerKey) ?? [];
        arr.push({
          date: c.date,
          start_time: c.rawStart,
          end_time: c.rawEnd,
          hours: c.hours,
          shift_type: c.source,
        });
        byKey.set(c.providerKey, arr);
      }
      setOverride({
        fileName: file.name,
        byKey,
        matchedProviders: byKey.size,
        totalShifts: candidates.length,
      });
      toast.success(
        `Parsed ${candidates.length} shift${candidates.length === 1 ? '' : 's'} for ${byKey.size} provider${byKey.size === 1 ? '' : 's'} from ${file.name}`,
      );
    } catch (e) {
      toast.error(`Could not parse file: ${(e as Error).message}`);
    }
  };

  // Apply override (if any) by replacing parsed_shifts for providers whose
  // name or email matches a key in the uploaded file.
  const rows: ProviderPublishView[] = useMemo(() => {
    if (!override) return dbRows;
    return dbRows.map(r => {
      const sub = r.submission;
      const emailKey = normEmail((sub as unknown as { provider_email?: string })?.provider_email ?? null);
      const nameKey = normName(r.provider_name);
      const shifts =
        (emailKey && override.byKey.get(emailKey)) ||
        override.byKey.get(nameKey) ||
        null;
      if (!shifts) return r;
      const accepted_hours = shifts.reduce((acc, s) => acc + (s.hours ?? 0), 0);
      return {
        ...r,
        submission: sub
          ? { ...sub, parsed_shifts: shifts, accepted_hours }
          : ({
              id: `override-${r.provider_id}`,
              provider_id: r.provider_id,
              provider_name: r.provider_name,
              target_month: month,
              decision_status: 'accepted',
              accepted_hours,
              declined_hours: 0,
              decision_notes: `From uploaded file: ${override.fileName}`,
              parsed_shifts: shifts,
              submitted_at: new Date().toISOString(),
              decided_at: null,
              validation_status: null,
              validation_warnings: null,
              raw_requested_hours: accepted_hours,
              normalized_requested_hours: accepted_hours,
            } as unknown as ProviderPublishView['submission']),
      };
    });
  }, [dbRows, override, month]);

  // Group shift_recommendations rows by provider for the per-provider view.
  const shiftsByProvider = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of shiftRows) {
      if (!s.provider_id) continue;
      if (!map.has(s.provider_id)) map.set(s.provider_id, []);
      map.get(s.provider_id)!.push(s);
    }
    return map;
  }, [shiftRows]);

  // Telehealth-only set drives the main publishing flow. MH gets its own tab.
  const telehealthRows = useMemo(
    () => rows.filter(r => !isMentalHealth(r.profession)),
    [rows],
  );
  const mentalHealthRows = useMemo(
    () => rows.filter(r => isMentalHealth(r.profession)),
    [rows],
  );

  const acceptedRows = useMemo(
    () =>
      telehealthRows.filter(
        r =>
          r.submission?.decision_status === 'accepted' ||
          r.submission?.decision_status === 'partial',
      ),
    [telehealthRows],
  );

  // Include any provider with declined hours, not just status='declined'.
  // Partial accepts (oversupply trims, out-of-business-hours cuts) leave a
  // submission as 'accepted' or 'partial' but still have declined_hours > 0,
  // and ClinOps wants to see those alongside fully-declined submissions.
  const declinedRows = useMemo(
    () =>
      telehealthRows
        .filter(
          r =>
            r.submission?.decision_status === 'declined' ||
            Number(r.submission?.declined_hours ?? 0) > 0,
        )
        .sort(
          (a, b) =>
            Number(b.submission?.declined_hours ?? 0) -
              Number(a.submission?.declined_hours ?? 0),
        ),
    [telehealthRows],
  );

  const needsReviewRows = useMemo(
    () => rows.filter(r => r.submission?.decision_status === 'needs_review'),
    [rows],
  );

  const missingRows = useMemo(
    () => rows.filter(r => !r.submission),
    [rows],
  );

  // Resubmission inbox count — # of groups with a content-changing latest
  // submission that hasn't been resolved yet. Drives the tab badge.
  const inboxActionableCount = useMemo(() => {
    const groups = groupSubmissionsForInbox(inboxSubmissions);
    return groups.filter(g => {
      if (g.latest.human_review_state === 'approved') return false;
      const d = diffParsedShifts(g.prior.parsed_shifts, g.latest.parsed_shifts);
      return d.hasChanges;
    }).length;
  }, [inboxSubmissions]);

  // Providers who listed off-days for this month — Lindsay's request so MSS can
  // see at-a-glance who's unavailable when sourcing a licensed provider.
  type TimeOffEntry = {
    row: ProviderPublishView;
    ranges: ReturnType<typeof extractUnavailableRanges>;
    totalDays: number;
  };
  const timeOffRows: TimeOffEntry[] = useMemo(() => {
    const out: TimeOffEntry[] = [];
    for (const r of rows) {
      const sub = r.submission;
      if (!sub) continue;
      const ranges = extractUnavailableRanges(sub.parsed_shifts, month);
      if (ranges.length === 0) continue;
      const allDates = new Set<string>();
      for (const range of ranges) for (const d of range.dates) allDates.add(d);
      out.push({ row: r, ranges, totalDays: allDates.size });
    }
    return out.sort((a, b) =>
      a.row.provider_name.localeCompare(b.row.provider_name, undefined, { sensitivity: 'base' }),
    );
  }, [rows, month]);

  const filteredAccepted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = q
      ? acceptedRows.filter(
          r =>
            r.provider_name.toLowerCase().includes(q) ||
            (r.profession ?? '').toLowerCase().includes(q),
        )
      : acceptedRows;
    return [...base].sort((a, b) =>
      a.provider_name.localeCompare(b.provider_name, undefined, { sensitivity: 'base' }),
    );
  }, [acceptedRows, filter]);

  // Aggregate progress: count individual shifts so the headline reflects
  // Sarabjeet's actual workload, not just per-provider check-marks.
  const allFlatAccepted = useMemo(() => {
    const acceptedProviderIds = new Set(acceptedRows.map(r => r.provider_id));
    return shiftRows.filter(s => s.provider_id && acceptedProviderIds.has(s.provider_id));
  }, [acceptedRows, shiftRows]);

  const summary = useMemo(() => {
    const totalShifts = allFlatAccepted.length;
    const homebaseShifts = allFlatAccepted.filter(isHomebaseDone).length;
    const ehrShifts = allFlatAccepted.filter(isEhrDone).length;
    return {
      totalProviders: acceptedRows.length,
      totalShifts,
      homebaseShifts,
      ehrShifts,
      declinedCount: declinedRows.length,
      needsReviewCount: needsReviewRows.length,
      missingCount: missingRows.length,
    };
  }, [acceptedRows, allFlatAccepted, declinedRows, needsReviewRows, missingRows]);

  const handleToggleProvider = (
    row: ProviderPublishView,
    step: ShiftPublishStep,
    done: boolean,
  ) => {
    togglePerProvider.mutate(
      { provider_id: row.provider_id, target_month: month, step, done },
      { onError: e => toast.error(`Could not save: ${(e as Error).message}`) },
    );
  };

  const handleToggleShift = (
    shift: ShiftRow,
    step: ShiftPublishStep,
    done: boolean,
  ) => {
    togglePerShift.mutate(
      { shift, step, done },
      { onError: e => toast.error(`Could not save: ${(e as Error).message}`) },
    );
  };

  const handleBulkAllProviderShifts = (
    row: ProviderPublishView,
    step: ShiftPublishStep,
    done: boolean = true,
  ) => {
    const shifts = shiftsByProvider.get(row.provider_id) ?? [];
    if (shifts.length === 0) {
      // Fallback for providers with no shift_recommendations rows yet (eg.
      // submission hasn't been evaluated). Use the aggregate-level mark so the
      // page is still actionable.
      handleToggleProvider(row, step, done);
      return;
    }
    const target = done
      ? step === 'homebase'
        ? shifts.filter(s => !isHomebaseDone(s))
        : shifts.filter(s => isHomebaseDone(s) && !isEhrDone(s))
      : step === 'homebase'
        ? shifts.filter(s => isHomebaseDone(s))
        : shifts.filter(s => isEhrDone(s));
    if (target.length === 0) {
      toast.info(`Nothing left to ${done ? 'mark' : 'revert'} for ${row.provider_name}.`);
      return;
    }
    bulkPerShift.mutate(
      { shifts: target, step, done },
      {
        onSuccess: () => {
          if (done) handleToggleProvider(row, step, true);
          toast.success(
            `${done ? 'Marked' : 'Reverted'} ${target.length} shift${target.length === 1 ? '' : 's'} for ${row.provider_name}`,
          );
        },
        onError: e => toast.error(`Bulk ${done ? 'mark' : 'revert'} failed: ${(e as Error).message}`),
      },
    );
  };

  const reevaluateNow = () => {
    reevaluate.mutate(month, {
      onSuccess: () => {
        toast.success(`Re-evaluated ${formatMonthLabel(month)}`);
        refetch();
        refetchShifts();
      },
      onError: e => toast.error(`Re-evaluation failed: ${(e as Error).message}`),
    });
  };

  return (
    <SchedulingShell>
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-emerald-600" />
            July 2026 Scheduling Workbench
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            One place to move July from forecast → availability → coverage → publish.
            Pick a tab below. Every Homebase/EHR click is recorded with who and when.
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
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Re-runs the evaluator against the latest Jotform submissions.
              Already-published shifts keep their Homebase / EHR state — only
              shifts that change or disappear lose their progress.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <SopCard />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Shifts to publish"
          value={summary.totalShifts.toString()}
          sub={`${summary.totalProviders} provider${summary.totalProviders === 1 ? '' : 's'}`}
        />
        <SummaryCard
          label="Posted to Homebase"
          value={`${summary.totalShifts ? Math.round((summary.homebaseShifts / summary.totalShifts) * 100) : 0}%`}
          sub={`${summary.homebaseShifts} of ${summary.totalShifts} shifts`}
        />
        <SummaryCard
          label="Posted to EHR"
          value={`${summary.totalShifts ? Math.round((summary.ehrShifts / summary.totalShifts) * 100) : 0}%`}
          sub={`${summary.ehrShifts} of ${summary.totalShifts} shifts`}
        />
        <SummaryCard label="Declined" value={summary.declinedCount.toString()} />
      </div>

      {!shiftsLoading && shiftRows.length === 0 && acceptedRows.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No per-shift recommendations have been generated for{' '}
            {formatMonthLabel(month)}. Click "Re-run evaluator" to expand the Jotform
            submissions into individual shifts.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm">Shifts source</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {override
                  ? `Using uploaded file: ${override.fileName} · ${override.totalShifts} shift${override.totalShifts === 1 ? '' : 's'} matched to ${override.matchedProviders} provider${override.matchedProviders === 1 ? '' : 's'}`
                  : `Showing ${shiftRows.length} shift${shiftRows.length === 1 ? '' : 's'} from the evaluator. Upload a Jotform export only if you need to preview a not-yet-imported file.`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="jotform-upload"
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.currentTarget.value = '';
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => document.getElementById('jotform-upload')?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                {override ? 'Replace file' : 'Upload Jotform file'}
              </Button>
              {override && (
                <Button size="sm" variant="ghost" onClick={() => setOverride(null)}>
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

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
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="inbox">
            <Inbox className="h-3.5 w-3.5 mr-1" /> Inbox
            {inboxActionableCount > 0 && (
              <Badge className="ml-1 bg-blue-100 text-blue-800">
                {inboxActionableCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="unmatched">
            <AlertCircle className="h-3.5 w-3.5 mr-1" /> Unmatched
            {unmatchedSubs.length > 0 && (
              <Badge className="ml-1 bg-amber-100 text-amber-800">
                {unmatchedSubs.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="setup">
            <UserCheck className="h-3.5 w-3.5 mr-1" /> Setup
            {setupIssuesCount > 0 && (
              <Badge className="ml-1 bg-amber-100 text-amber-800">
                {setupIssuesCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="provider">By Provider</TabsTrigger>
          <TabsTrigger value="queue">
            Publishing Queue
            {summary.totalShifts > 0 && (
              <span className="ml-1 text-xs">
                ({summary.homebaseShifts}/{summary.totalShifts})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="day">By Day</TabsTrigger>
          <TabsTrigger value="review">
            Needs Review
            {summary.needsReviewCount > 0 && (
              <Badge className="ml-1 bg-orange-100 text-orange-800">
                {summary.needsReviewCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="declined">Declined</TabsTrigger>
          <TabsTrigger value="mh">
            <Brain className="h-3.5 w-3.5 mr-1" /> Mental Health
            {mentalHealthRows.length > 0 && (
              <span className="ml-1 text-xs">({mentalHealthRows.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="missing">
            <UserX className="h-3.5 w-3.5 mr-1" /> Missing
            {summary.missingCount > 0 && (
              <Badge className="ml-1 bg-slate-200 text-slate-700">
                {summary.missingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="timeoff">
            <CalendarOff className="h-3.5 w-3.5 mr-1" /> Time Off
            {timeOffRows.length > 0 && (
              <span className="ml-1 text-xs">({timeOffRows.length})</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-3.5 w-3.5 mr-1" /> History
            {auditEntries.length > 0 && (
              <span className="ml-1 text-xs">({auditEntries.length})</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4 space-y-4">
          <ResubmissionInboxPanel
            anchorMonth={month}
            submissions={inboxSubmissions}
            isLoading={inboxLoading}
          />
        </TabsContent>

        <TabsContent value="unmatched" className="mt-4 space-y-4">
          <UnmatchedSubmissionsPanel />
        </TabsContent>

        <TabsContent value="setup" className="mt-4 space-y-4">
          <OnboardingReadinessPanel />
        </TabsContent>

        <TabsContent value="provider" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">
                    Approved providers · {formatMonthLabel(month)}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sorted alphabetically. Use the per-row HB / EHR buttons to mark or
                    revert all shifts for a provider at once.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Filter by name or profession"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="md:w-64"
                  />
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
                      <TableHead className="w-44">Homebase</TableHead>
                      <TableHead className="w-44">EHR</TableHead>
                      <TableHead className="text-right">Quick</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAccepted.map(row => {
                      const sub = row.submission!;
                      const flats = shiftsByProvider.get(row.provider_id) ?? [];
                      const hbDone = flats.filter(isHomebaseDone).length;
                      const ehrDone = flats.filter(isEhrDone).length;
                      const isOpen = !!expanded[row.provider_id];
                      const totalShifts = flats.length;
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
                              <div className="font-medium flex items-center gap-2">
                                {row.provider_name}
                                <ProviderNoteIndicator parsedShifts={sub.parsed_shifts} />
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {row.profession ?? '—'}
                                {row.employment_type ? ` · ${row.employment_type}` : ''}
                                {' · '}
                                {totalShifts} shift{totalShifts === 1 ? '' : 's'}
                              </div>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={sub.decision_status} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatHours(sub.accepted_hours)}
                            </TableCell>
                            <TableCell onClick={e => e.stopPropagation()}>
                              <ShiftProgress done={hbDone} total={totalShifts} />
                            </TableCell>
                            <TableCell onClick={e => e.stopPropagation()}>
                              <ShiftProgress done={ehrDone} total={totalShifts} />
                            </TableCell>
                            <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                {totalShifts > 0 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                      handleBulkAllProviderShifts(
                                        row,
                                        'homebase',
                                        hbDone < totalShifts,
                                      )
                                    }
                                  >
                                    {hbDone < totalShifts ? 'HB all' : 'Revert HB'}
                                  </Button>
                                )}
                                {totalShifts > 0 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    disabled={ehrDone === 0 && hbDone < totalShifts}
                                    onClick={() =>
                                      handleBulkAllProviderShifts(
                                        row,
                                        'ehr',
                                        ehrDone < totalShifts,
                                      )
                                    }
                                  >
                                    {ehrDone < totalShifts ? 'EHR all' : 'Revert EHR'}
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell />
                              <TableCell colSpan={6} className="py-2 space-y-2">
                                <ProviderNotesCard
                                  parsedShifts={sub.parsed_shifts}
                                  variant="inline"
                                />
                                {flats.length === 0 ? (
                                  <div className="text-xs text-muted-foreground italic">
                                    No per-shift data — submission hasn't been expanded yet.
                                    Click "Re-run evaluator" above to generate the shift list.
                                  </div>
                                ) : (
                                  <ShiftListInline
                                    shifts={flats}
                                    onToggle={handleToggleShift}
                                    auditByShift={auditByShift}
                                  />
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

        <TabsContent value="queue" className="mt-4 space-y-4">
          <PublishingQueue
            month={month}
            shifts={allFlatAccepted}
            isLoading={shiftsLoading}
            onToggleShift={handleToggleShift}
            auditByShift={auditByShift}
            onBulkShifts={(shifts, step, done) =>
              bulkPerShift.mutate(
                { shifts, step, done },
                {
                  onSuccess: () =>
                    toast.success(
                      `Marked ${shifts.length} shift${shifts.length === 1 ? '' : 's'} ${
                        done ? 'posted' : 'unposted'
                      }`,
                    ),
                  onError: e => toast.error(`Bulk mark failed: ${(e as Error).message}`),
                },
              )
            }
          />
        </TabsContent>

        <TabsContent value="day" className="mt-4 space-y-4">
          <ByDayPanel
            month={month}
            shifts={allFlatAccepted}
            isLoading={shiftsLoading}
            onToggleShift={handleToggleShift}
            auditByShift={auditByShift}
          />
        </TabsContent>

        <TabsContent value="review" className="mt-4 space-y-4">
          <NeedsReviewPanel
            month={month}
            rows={needsReviewRows}
            isLoading={isLoading}
            onResolve={(args) =>
              resolveReview.mutate(args, {
                onSuccess: () => {
                  toast.success(`Marked ${args.decision} for ${args.provider_name}`);
                  refetch();
                  refetchShifts();
                },
                onError: e => toast.error(`Could not resolve: ${(e as Error).message}`),
              })
            }
            isPending={resolveReview.isPending}
          />
        </TabsContent>

        <TabsContent value="declined" className="mt-4 space-y-4">
          <DeclinedPanel month={month} declinedRows={declinedRows} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="mh" className="mt-4 space-y-4">
          <MentalHealthPanel
            month={month}
            rows={mentalHealthRows}
            shiftsByProvider={shiftsByProvider}
            isLoading={isLoading}
            onToggleShift={handleToggleShift}
            onToggleProvider={handleToggleProvider}
            auditByShift={auditByShift}
          />
        </TabsContent>

        <TabsContent value="missing" className="mt-4 space-y-4">
          <MissingSubmissionsPanel
            month={month}
            rows={missingRows}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="timeoff" className="mt-4 space-y-4">
          <TimeOffPanel
            month={month}
            entries={timeOffRows}
            isLoading={isLoading}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          <PublishHistoryPanel month={month} entries={auditEntries} />
        </TabsContent>
      </Tabs>
    </TooltipProvider>
    </SchedulingShell>
  );
}

function SopCard() {
  return (
    <Card className="bg-emerald-50/50 border-emerald-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Monthly cadence</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <SopStep day="Mon" label="Initial availability message" />
          <SopStep day="Fri" label="Reminder message" />
          <SopStep day="Tue" label="Chase missing + clear Needs Review" />
          <SopStep day="Wed" label="Publish to Homebase" />
          <SopStep day="Fri" label="Transfer to EHR" />
        </div>
      </CardContent>
    </Card>
  );
}

function SopStep({ day, label }: { day: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <Badge variant="outline" className="bg-white">
        {day}
      </Badge>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function ShiftProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    return <div className="text-xs text-muted-foreground">—</div>;
  }
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <Progress value={pct} className="h-2 flex-1" />
      <span className="text-xs tabular-nums w-12 text-right">
        {done}/{total}
      </span>
    </div>
  );
}

type ShiftAuditMap = Map<string, { homebase?: PublishAuditEntry; ehr?: PublishAuditEntry }>;

function PublishCheckbox({
  shift,
  step,
  checked,
  disabled,
  onToggle,
  audit,
}: {
  shift: ShiftRow;
  step: ShiftPublishStep;
  checked: boolean;
  disabled?: boolean;
  onToggle: (s: ShiftRow, step: ShiftPublishStep, done: boolean) => void;
  audit?: PublishAuditEntry;
}) {
  const box = (
    <Checkbox
      checked={checked}
      disabled={disabled}
      onCheckedChange={c => onToggle(shift, step, !!c)}
    />
  );
  if (!audit || !checked) return box;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{box}</span>
      </TooltipTrigger>
      <TooltipContent>{attributionLabel(audit)}</TooltipContent>
    </Tooltip>
  );
}

function ShiftListInline({
  shifts,
  onToggle,
  auditByShift,
}: {
  shifts: ShiftRow[];
  onToggle: (s: ShiftRow, step: ShiftPublishStep, done: boolean) => void;
  auditByShift?: ShiftAuditMap;
}) {
  const sorted = useMemo(
    () =>
      [...shifts].sort(
        (a, b) =>
          a.shift_date.localeCompare(b.shift_date) || a.start_min - b.start_min,
      ),
    [shifts],
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">Date</TableHead>
          <TableHead className="w-32">Time</TableHead>
          <TableHead className="text-right w-16">Hrs</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-center w-28">Homebase</TableHead>
          <TableHead className="text-center w-28">EHR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(s => {
          const hbDone = isHomebaseDone(s);
          const ehrDone = isEhrDone(s);
          const audit = auditByShift?.get(s.id);
          return (
            <TableRow key={s.id}>
              <TableCell className="text-xs">{formatDateLabel(s.shift_date)}</TableCell>
              <TableCell className="text-xs tabular-nums">
                {formatShiftTime(s.start_min)}–{formatShiftTime(s.end_min)}
              </TableCell>
              <TableCell className="text-xs text-right tabular-nums">
                {formatHours(s.hours)}
              </TableCell>
              <TableCell className="text-xs">{labelShiftType(s.shift_type)}</TableCell>
              <TableCell className="text-center">
                <PublishCheckbox
                  shift={s}
                  step="homebase"
                  checked={hbDone}
                  audit={audit?.homebase}
                  onToggle={onToggle}
                />
              </TableCell>
              <TableCell className="text-center">
                <PublishCheckbox
                  shift={s}
                  step="ehr"
                  checked={ehrDone}
                  disabled={!hbDone}
                  audit={audit?.ehr}
                  onToggle={onToggle}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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

function PublishingQueue({
  month,
  shifts,
  isLoading,
  onToggleShift,
  onBulkShifts,
  auditByShift,
}: {
  month: string;
  shifts: ShiftRow[];
  isLoading: boolean;
  onToggleShift: (s: ShiftRow, step: ShiftPublishStep, done: boolean) => void;
  onBulkShifts: (shifts: ShiftRow[], step: ShiftPublishStep, done: boolean) => void;
  auditByShift?: ShiftAuditMap;
}) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_hb' | 'pending_ehr' | 'done'>(
    'pending_hb',
  );
  const [providerFilter, setProviderFilter] = useState('');

  const filtered = useMemo(() => {
    const q = providerFilter.trim().toLowerCase();
    return shifts.filter(s => {
      const hbDone = isHomebaseDone(s);
      const ehrDone = isEhrDone(s);
      if (statusFilter === 'pending_hb' && hbDone) return false;
      if (statusFilter === 'pending_ehr' && (!hbDone || ehrDone)) return false;
      if (statusFilter === 'done' && !ehrDone) return false;
      if (q && !s.provider_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [shifts, statusFilter, providerFilter]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          a.shift_date.localeCompare(b.shift_date) ||
          a.provider_name.localeCompare(b.provider_name) ||
          a.start_min - b.start_min,
      ),
    [filtered],
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading shifts" />
        </CardContent>
      </Card>
    );
  }

  if (shifts.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No shift recommendations for {formatMonthLabel(month)}. Run the evaluator first.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">Publishing queue</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Every shift you need to publish. Filter by status to find your resumption point.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_hb">Not posted to Homebase</SelectItem>
                <SelectItem value="pending_ehr">Awaiting EHR transfer</SelectItem>
                <SelectItem value="done">Fully published</SelectItem>
                <SelectItem value="all">All shifts</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Filter provider"
              value={providerFilter}
              onChange={e => setProviderFilter(e.target.value)}
              className="w-48"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={sorted.length === 0}
              onClick={() => onBulkShifts(sorted, 'homebase', true)}
            >
              Mark filtered HB
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sorted.length === 0}
              onClick={() => onBulkShifts(sorted.filter(isHomebaseDone), 'ehr', true)}
            >
              Mark filtered EHR
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Hrs</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-center w-24">HB</TableHead>
              <TableHead className="text-center w-24">EHR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(s => {
              const hbDone = isHomebaseDone(s);
              const ehrDone = isEhrDone(s);
              const audit = auditByShift?.get(s.id);
              return (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{formatDateLabel(s.shift_date)}</TableCell>
                  <TableCell className="font-medium">{s.provider_name}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {formatShiftTime(s.start_min)}–{formatShiftTime(s.end_min)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatHours(s.hours)}
                  </TableCell>
                  <TableCell className="text-xs">{labelShiftType(s.shift_type)}</TableCell>
                  <TableCell className="text-center">
                    <PublishCheckbox
                      shift={s}
                      step="homebase"
                      checked={hbDone}
                      audit={audit?.homebase}
                      onToggle={onToggleShift}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <PublishCheckbox
                      shift={s}
                      step="ehr"
                      checked={ehrDone}
                      disabled={!hbDone}
                      audit={audit?.ehr}
                      onToggle={onToggleShift}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No shifts match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ByDayPanel({
  month,
  shifts,
  isLoading,
  onToggleShift,
  auditByShift,
}: {
  month: string;
  shifts: ShiftRow[];
  isLoading: boolean;
  onToggleShift: (s: ShiftRow, step: ShiftPublishStep, done: boolean) => void;
  auditByShift?: ShiftAuditMap;
}) {
  const days = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of shifts) {
      if (!map.has(s.shift_date)) map.set(s.shift_date, []);
      map.get(s.shift_date)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, entries]) => ({
        date,
        entries: entries.sort((a, b) => a.start_min - b.start_min),
      }));
  }, [shifts]);

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
          No accepted shifts for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {days.map(day => {
        const hbLeft = day.entries.filter(s => !isHomebaseDone(s)).length;
        const ehrLeft = day.entries.filter(s => isHomebaseDone(s) && !isEhrDone(s)).length;
        return (
          <Card key={day.date}>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{formatDateLabel(day.date)}</CardTitle>
                  <div className="text-xs text-muted-foreground mt-1">
                    {day.entries.length} shift{day.entries.length === 1 ? '' : 's'} ·{' '}
                    {hbLeft} not yet on Homebase · {ehrLeft} awaiting EHR
                  </div>
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
                    <TableHead className="text-right">Hrs</TableHead>
                    <TableHead className="text-center">Homebase</TableHead>
                    <TableHead className="text-center">EHR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {day.entries.map(s => {
                    const hbDone = isHomebaseDone(s);
                    const ehrDone = isEhrDone(s);
                    const audit = auditByShift?.get(s.id);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.provider_name}</TableCell>
                        <TableCell className="text-xs">
                          {formatShiftTime(s.start_min)}–{formatShiftTime(s.end_min)}
                        </TableCell>
                        <TableCell className="text-xs">{labelShiftType(s.shift_type)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatHours(s.hours)}
                        </TableCell>
                        <TableCell className="text-center">
                          <PublishCheckbox
                            shift={s}
                            step="homebase"
                            checked={hbDone}
                            audit={audit?.homebase}
                            onToggle={onToggleShift}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <PublishCheckbox
                            shift={s}
                            step="ehr"
                            checked={ehrDone}
                            disabled={!hbDone}
                            audit={audit?.ehr}
                            onToggle={onToggleShift}
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

type ResolveArgs = {
  submission_id: string;
  prior_status: string | null;
  decision: 'accepted' | 'declined';
  hours_basis: number | null;
  reason: string;
  existing_notes: string | null;
  provider_name: string;
};

function NeedsReviewPanel({
  month,
  rows,
  isLoading,
  onResolve,
  isPending,
}: {
  month: string;
  rows: ProviderPublishView[];
  isLoading: boolean;
  onResolve: (args: ResolveArgs) => void;
  isPending: boolean;
}) {
  const [target, setTarget] = useState<{
    row: ProviderPublishView;
    decision: 'accepted' | 'declined';
  } | null>(null);
  const [reason, setReason] = useState('');

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading needs-review" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Nothing needs manual review for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  const open = (row: ProviderPublishView, decision: 'accepted' | 'declined') => {
    setTarget({ row, decision });
    setReason('');
  };

  const submit = () => {
    if (!target) return;
    const sub = target.row.submission!;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error('Please add a reason — every override is logged.');
      return;
    }
    onResolve({
      submission_id: sub.id,
      prior_status: sub.decision_status,
      decision: target.decision,
      hours_basis: sub.normalized_requested_hours ?? sub.raw_requested_hours ?? null,
      reason: trimmed,
      existing_notes: sub.decision_notes ?? null,
      provider_name: target.row.provider_name,
    });
    setTarget(null);
    setReason('');
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Needs review · {formatMonthLabel(month)}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            The evaluator flagged these submissions because the parsed hours look ambiguous (e.g.
            9 PM to 9 PM, 8 PM to 12 PM). Confirm with the provider, then accept or decline.
            Anyone with scheduling access can resolve — every override records who and why.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Raw hrs</TableHead>
                <TableHead>Reasons</TableHead>
                <TableHead className="text-right">Resolve</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const sub = r.submission!;
                const warnings = Array.isArray(sub.validation_warnings)
                  ? (sub.validation_warnings as string[])
                  : [];
                return (
                  <TableRow key={r.provider_id}>
                    <TableCell>
                      <div className="font-medium">{r.provider_name}</div>
                      <div className="text-xs text-muted-foreground">{r.profession ?? '—'}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatHours(sub.raw_requested_hours)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md">
                      {warnings.length > 0
                        ? warnings.slice(0, 3).join(' · ')
                        : sub.decision_notes ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => open(r, 'accepted')}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => open(r, 'declined')}
                        >
                          Decline
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.decision === 'accepted' ? 'Accept' : 'Decline'} {target?.row.provider_name}
            </DialogTitle>
            <DialogDescription>
              Note what you confirmed with the provider — this gets logged with your name and
              attached to the submission notes.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="e.g. Confirmed via Slack — meant 9 AM to 9 PM, treating as standard 12-hour shift"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending || reason.trim().length === 0}>
              {isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Confirm {target?.decision === 'accepted' ? 'accept' : 'decline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MentalHealthPanel({
  month,
  rows,
  shiftsByProvider,
  isLoading,
  onToggleShift,
  onToggleProvider,
  auditByShift,
}: {
  month: string;
  rows: ProviderPublishView[];
  shiftsByProvider: Map<string, ShiftRow[]>;
  isLoading: boolean;
  onToggleShift: (s: ShiftRow, step: ShiftPublishStep, done: boolean) => void;
  onToggleProvider: (row: ProviderPublishView, step: ShiftPublishStep, done: boolean) => void;
  auditByShift?: ShiftAuditMap;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading mental health" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No mental health providers found for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-600" />
          Mental Health · {formatMonthLabel(month)}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          MH coaches and LPCs use a weekly SLA across all 50 states, so they bypass the
          state-by-state demand allocator. All submitted hours are accepted unless flagged for
          review.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead>Homebase</TableHead>
              <TableHead>EHR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => {
              const sub = r.submission;
              const flats = shiftsByProvider.get(r.provider_id) ?? [];
              const hbShiftDone = flats.filter(isHomebaseDone).length;
              const ehrShiftDone = flats.filter(isEhrDone).length;
              const hbAggregate = !!r.publish?.homebase_posted_at;
              const ehrAggregate = !!r.publish?.ehr_posted_at;
              return (
                <Fragment key={r.provider_id}>
                  <TableRow>
                    <TableCell>
                      <div className="font-medium">{r.provider_name}</div>
                      <div className="text-xs text-muted-foreground">{r.profession ?? '—'}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={sub?.decision_status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatHours(sub?.accepted_hours)}
                    </TableCell>
                    <TableCell>
                      {flats.length > 0 ? (
                        <ShiftProgress done={hbShiftDone} total={flats.length} />
                      ) : (
                        <Checkbox
                          checked={hbAggregate}
                          onCheckedChange={c => onToggleProvider(r, 'homebase', !!c)}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {flats.length > 0 ? (
                        <ShiftProgress done={ehrShiftDone} total={flats.length} />
                      ) : (
                        <Checkbox
                          checked={ehrAggregate}
                          disabled={!hbAggregate}
                          onCheckedChange={c => onToggleProvider(r, 'ehr', !!c)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                  {flats.length > 0 && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={5} className="py-2">
                        <ShiftListInline
                          shifts={flats}
                          onToggle={onToggleShift}
                          auditByShift={auditByShift}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MissingSubmissionsPanel({
  month,
  rows,
  isLoading,
}: {
  month: string;
  rows: ProviderPublishView[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading missing submissions" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Every active provider has submitted for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  const monthLabel = formatMonthLabel(month);
  const reminderTemplate = (name: string) =>
    `Hi ${name.split(' ')[0]}, gentle reminder to submit your ${monthLabel} availability when you have a moment. Thanks!`;

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) =>
        a.provider_name.localeCompare(b.provider_name, undefined, { sensitivity: 'base' }),
      ),
    [rows],
  );

  const emailsWithAddress = useMemo(
    () => sortedRows.filter(r => r.provider_email && r.provider_email.includes('@')),
    [sortedRows],
  );

  const copyAll = async () => {
    const text = sortedRows
      .map(r => `${r.provider_name}: ${reminderTemplate(r.provider_name)}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied reminder for ${sortedRows.length} provider${sortedRows.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const copyAllEmails = async () => {
    if (emailsWithAddress.length === 0) {
      toast.error('No email addresses on file for these providers.');
      return;
    }
    const text = emailsWithAddress.map(r => r.provider_email!).join(', ');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        `Copied ${emailsWithAddress.length} email${emailsWithAddress.length === 1 ? '' : 's'} — paste into BCC`,
      );
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const missingEmailCount = sortedRows.length - emailsWithAddress.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">
              Missing submissions · {formatMonthLabel(month)}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Active providers with no Jotform submission for this month. Copy all
              emails at once to BCC a reminder, or grab the reminder text per provider.
              {missingEmailCount > 0 && (
                <span className="text-amber-700">
                  {' '}
                  ({missingEmailCount} provider{missingEmailCount === 1 ? '' : 's'} without
                  an email on file.)
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={copyAllEmails}
              disabled={emailsWithAddress.length === 0}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy all emails ({emailsWithAddress.length})
            </Button>
            <Button size="sm" variant="outline" onClick={copyAll}>
              <Copy className="h-4 w-4 mr-1" />
              Copy all reminders
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Profession</TableHead>
              <TableHead>Employment</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map(r => (
              <TableRow key={r.provider_id}>
                <TableCell className="font-medium">{r.provider_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.provider_email ?? <span className="italic">no email on file</span>}
                </TableCell>
                <TableCell className="text-xs">{r.profession ?? '—'}</TableCell>
                <TableCell className="text-xs">{r.employment_type ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          reminderTemplate(r.provider_name),
                        );
                        toast.success('Reminder copied');
                      } catch {
                        toast.error('Clipboard unavailable');
                      }
                    }}
                  >
                    <Copy className="h-3 w-3 mr-1" /> Copy reminder
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
          No declined hours for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarX className="h-4 w-4 text-red-600" />
          Declined hours · {formatMonthLabel(month)}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Every submission with declined hours — fully declined, oversupply
          trimmed, or hours dropped for being outside operating hours
          (9a–9p ET weekdays / 9a–12p ET weekends). The decision_notes
          column spells out the reason.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Accepted hrs</TableHead>
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
                  <TableCell>
                    <StatusBadge status={sub.decision_status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(sub.accepted_hours)}
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

type TimeOffPanelEntry = {
  row: ProviderPublishView;
  ranges: ReturnType<typeof extractUnavailableRanges>;
  totalDays: number;
};

function TimeOffPanel({
  month,
  entries,
  isLoading,
}: {
  month: string;
  entries: TimeOffPanelEntry[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading time off" />
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No providers listed any time off for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  const formatRange = (startIso: string, endIso: string) => {
    const start = formatDateLabel(startIso);
    if (startIso === endIso) return start;
    return `${start} – ${formatDateLabel(endIso)}`;
  };

  const totalDays = entries.reduce((acc, e) => acc + e.totalDays, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-amber-600" />
          Time off · {formatMonthLabel(month)}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Days providers listed as unavailable on their Jotform submission.
          {' '}
          {entries.length} provider{entries.length === 1 ? '' : 's'} · {totalDays} day
          {totalDays === 1 ? '' : 's'} off this month. Use this when MSS asks who's
          licensed in a state — check here first to see if the provider is on leave.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Profession</TableHead>
              <TableHead className="text-right w-24">Days off</TableHead>
              <TableHead>Dates</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(({ row, ranges, totalDays }) => (
              <TableRow key={row.provider_id}>
                <TableCell>
                  <div className="font-medium">{row.provider_name}</div>
                  {row.provider_email && (
                    <div className="text-xs text-muted-foreground">
                      {row.provider_email}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs">{row.profession ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-sm font-medium">
                  {totalDays}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex flex-wrap gap-1">
                    {ranges.map((range, i) => (
                      <Badge
                        key={`${range.startIso}-${range.endIso}-${i}`}
                        variant="outline"
                        className="bg-amber-50 border-amber-200 text-amber-900 font-normal"
                      >
                        {formatRange(range.startIso, range.endIso)}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const ACTION_STYLE: Record<PublishAuditEntry['action'], string> = {
  marked: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  reverted: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  preserved: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
};

function PublishHistoryPanel({
  month,
  entries,
}: {
  month: string;
  entries: PublishAuditEntry[];
}) {
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | PublishAuditEntry['action']>('all');

  const filtered = useMemo(() => {
    const q = actorFilter.trim().toLowerCase();
    return entries.filter(e => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (q) {
        const hay = `${e.actor_label ?? ''} ${e.provider_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, actorFilter, actionFilter]);

  if (entries.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No publish history yet for {formatMonthLabel(month)}. As people mark
          shifts posted to Homebase or the EHR, every action will appear here
          with who, when, and what changed.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-blue-600" />
              Publish history · {formatMonthLabel(month)}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Append-only log of every Homebase / EHR mark, revert, and
              evaluator-driven preservation. {entries.length} event
              {entries.length === 1 ? '' : 's'} this month.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={actionFilter}
              onValueChange={v => setActionFilter(v as typeof actionFilter)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="marked">Marked</SelectItem>
                <SelectItem value="reverted">Reverted</SelectItem>
                <SelectItem value="preserved">Preserved (re-run)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Filter by actor or provider"
              value={actorFilter}
              onChange={e => setActorFilter(e.target.value)}
              className="md:w-64"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Shift</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(e => (
              <TableRow key={e.id}>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  <div>{formatRelativeTime(e.created_at)}</div>
                  <div className="text-[10px] opacity-70">
                    {new Date(e.created_at).toLocaleString()}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {e.actor_label ?? <span className="italic text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <Badge className={ACTION_STYLE[e.action]}>
                    {e.action} · {e.step === 'homebase' ? 'HB' : 'EHR'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{e.provider_name ?? '—'}</TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {e.shift_date && e.start_min !== null && e.end_min !== null
                    ? `${formatDateLabel(e.shift_date)} · ${formatShiftTime(e.start_min)}–${formatShiftTime(e.end_min)}`
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No events match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
