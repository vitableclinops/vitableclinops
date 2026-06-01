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
  ShieldCheck,
  Users,
  HelpCircle,
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
  useMonthlyAvailabilitySubmissions,
  useProviderStateEligibility,
  formatShiftTime,
  isHomebaseDone,
  isEhrDone,
  type AvailabilitySubmissionRow,
  type ProviderPublishView,
  type ProviderStateEligibilityRow,
  type SubmissionRow,
  type SubmissionForInbox,
  type UnmatchedSubmission,
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
import {
  useMonthlyDemand,
  useMonthlyServiceLineDemand,
  useMonthlySlaRisk,
} from '@/hooks/useMonthlySchedulingForecast';
import { useStateCoverage } from '@/hooks/useStateCoverage';
import {
  useSchedulingSourceAudit,
  type SourceAuditSection,
} from '@/hooks/useSchedulingSourceAudit';
import { coverageStatusFor, type CoverageStatus } from '@/lib/scheduling/coverage';

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

const weeksInMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() / 7;
};

const formatHours = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toFixed(1);

const expandedSubmittedHours = (
  row:
    | Pick<SubmissionRow, 'effective_hours_used_for_forecast' | 'normalized_requested_hours' | 'raw_requested_hours'>
    | Pick<AvailabilitySubmissionRow, 'effective_hours_used_for_forecast' | 'normalized_requested_hours' | 'raw_requested_hours'>
    | Pick<SubmissionForInbox, 'effective_hours_used_for_forecast' | 'normalized_requested_hours' | 'raw_requested_hours'>
    | null
    | undefined,
) =>
  row?.effective_hours_used_for_forecast ??
  row?.normalized_requested_hours ??
  row?.raw_requested_hours ??
  null;

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

const safeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value : []);

export default function SchedulingWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState('2026-07-01');
  const initialTab = (() => {
    const t = searchParams.get('tab');
    return [
      'readiness',
      'forecast',
      'availability',
      'matching',
      'coverage',
      'publish',
      'audit',
    ].includes(t ?? '')
      ? (t as string)
      : 'readiness';
  })();
  const [topTab, setTopTab] = useState(initialTab);
  const onTopTabChange = (v: string) => {
    setTopTab(v);
    const next = new URLSearchParams(searchParams);
    if (v === 'readiness') next.delete('tab');
    else next.set('tab', v);
    setSearchParams(next, { replace: true });
  };
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded(p => ({ ...p, [id]: !p[id] }));

  const { data: dbRowsData = [], isLoading, refetch } = useMonthlyPublishView(month);
  const { data: shiftRowsData = [], isLoading: shiftsLoading, refetch: refetchShifts } =
    useShiftRecommendationsForMonth(month);
  const { data: auditEntriesData = [] } = usePublishAuditLog(month);
  const { data: inboxSubmissionsData = [], isLoading: inboxLoading } =
    useResubmissionInbox(month);
  const { data: unmatchedSubsData = [] } = useUnmatchedSubmissions();
  const { data: availabilitySubmissionsData = [], isLoading: availabilityLoading } =
    useMonthlyAvailabilitySubmissions(month);
  const { data: providerEligibilityData = [] } = useProviderStateEligibility();
  const { data: readinessRowsData = [] } = useOnboardingReadiness(30);

  const dbRows = safeArray<ProviderPublishView>(dbRowsData);
  const shiftRows = safeArray<ShiftRow>(shiftRowsData);
  const auditEntries = safeArray<PublishAuditEntry>(auditEntriesData);
  const inboxSubmissions = safeArray<SubmissionForInbox>(inboxSubmissionsData);
  const unmatchedSubs = safeArray<UnmatchedSubmission>(unmatchedSubsData);
  const availabilitySubmissions = safeArray<AvailabilitySubmissionRow>(availabilitySubmissionsData);
  const providerEligibility = safeArray<ProviderStateEligibilityRow>(providerEligibilityData);
  const readinessRows = safeArray<{ readyForSubmissions: boolean }>(readinessRowsData);
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
              effective_hours_used_for_forecast: accepted_hours,
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

  const eligibilityByProvider = useMemo(() => {
    const map = new Map<string, ProviderEligibilitySummary>();
    for (const row of providerEligibility) {
      if (!row.provider_id || !row.state || row.allocation_eligible !== true) continue;
      const state = String(row.state).trim().toUpperCase();
      if (!state) continue;
      const current = map.get(row.provider_id) ?? {
        states: new Set<string>(),
        sources: new Set<string>(),
      };
      current.states.add(state);
      for (const source of row.license_sources ?? []) current.sources.add(source);
      if (row.metabase_active === true) current.sources.add('metabase_active');
      map.set(row.provider_id, current);
    }
    return map;
  }, [providerEligibility]);

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

  const submittedAvailabilityHours = useMemo(() => {
    const latestByProvider = new Map<string, AvailabilitySubmissionRow>();
    for (const row of availabilitySubmissions) {
      if (row.decision_status === 'superseded') continue;
      const key = row.provider_id ?? row.provider_name;
      const current = latestByProvider.get(key);
      if (!current || row.submitted_at > current.submitted_at) latestByProvider.set(key, row);
    }
    let total = 0;
    for (const row of latestByProvider.values()) {
      total += Number(expandedSubmittedHours(row) ?? 0);
    }
    return total;
  }, [availabilitySubmissions]);

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
            {formatMonthLabel(month)} Scheduling Workbench
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            One place to move {formatMonthLabel(month)} from forecast → availability → coverage → publish.
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

      <Tabs value={topTab} onValueChange={onTopTabChange}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="readiness"><ShieldCheck className="h-3.5 w-3.5 mr-1" />Readiness</TabsTrigger>
          <TabsTrigger value="forecast"><TrendingUp className="h-3.5 w-3.5 mr-1" />Forecast</TabsTrigger>
          <TabsTrigger value="availability"><Inbox className="h-3.5 w-3.5 mr-1" />Availability</TabsTrigger>
          <TabsTrigger value="matching"><Users className="h-3.5 w-3.5 mr-1" />Matching</TabsTrigger>
          <TabsTrigger value="coverage"><MapIcon className="h-3.5 w-3.5 mr-1" />Coverage Gaps</TabsTrigger>
          <TabsTrigger value="publish"><Send className="h-3.5 w-3.5 mr-1" />Publish</TabsTrigger>
          <TabsTrigger value="audit"><HelpCircle className="h-3.5 w-3.5 mr-1" />Audit</TabsTrigger>
        </TabsList>

        {/* ============ READINESS ============ */}
        <TabsContent value="readiness" className="mt-4 space-y-4">
          <ReadinessPanel
            month={month}
            summary={summary}
            missingCount={summary.missingCount}
            submittedHours={submittedAvailabilityHours}
            mentalHealthCount={mentalHealthRows.length}
            mentalHealthAcceptedCount={mentalHealthRows.filter(r => r.submission?.decision_status === 'accepted' || r.submission?.decision_status === 'partial').length}
            inboxNeedsReviewCount={inboxActionableCount}
            onJumpToCoverage={() => onTopTabChange('coverage')}
            onJumpToAvailability={() => onTopTabChange('availability')}
            onJumpToMatching={() => onTopTabChange('matching')}
            onJumpToPublish={() => onTopTabChange('publish')}
          />
          <SopCard />
          {!shiftsLoading && shiftRows.length === 0 && acceptedRows.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No per-shift recommendations have been generated for{' '}
                {formatMonthLabel(month)}. Click "Re-run evaluator" above to expand the Jotform
                submissions into individual shifts.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* ============ FORECAST ============ */}
        <TabsContent value="forecast" className="mt-4 space-y-4">
          <ForecastPanel month={month} />
        </TabsContent>

        {/* ============ MATCHING ============ */}
        <TabsContent value="matching" className="mt-4 space-y-4">
          <MatchingPanel
            month={month}
            acceptedRows={acceptedRows}
            declinedRows={declinedRows}
            needsReviewRows={needsReviewRows}
            shiftsByProvider={shiftsByProvider}
            eligibilityByProvider={eligibilityByProvider}
          />
        </TabsContent>

        {/* ============ COVERAGE ============ */}
        <TabsContent value="coverage" className="mt-4 space-y-4">
          <CoverageGapsPanel month={month} acceptedRows={acceptedRows} missingRows={missingRows} />
        </TabsContent>

        {/* ============ AVAILABILITY ============ */}
        <TabsContent value="availability" className="mt-4 space-y-4">
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

      <Tabs defaultValue="submissions">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="submissions">
            <Inbox className="h-3.5 w-3.5 mr-1" /> Submissions
            {availabilitySubmissions.length > 0 && (
              <Badge className="ml-1 bg-emerald-100 text-emerald-800">
                {availabilitySubmissions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="inbox">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Resubmits
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
        </TabsList>

        <TabsContent value="submissions" className="mt-4 space-y-4">
          <AvailabilitySubmissionsPanel
            month={month}
            rows={availabilitySubmissions}
            isLoading={availabilityLoading}
          />
        </TabsContent>

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
      </Tabs>
        </TabsContent>

        {/* ============ PUBLISH ============ */}
        <TabsContent value="publish" className="mt-4 space-y-4">
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
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Final step — only publish after Coverage Matching shows no critical gaps.
              Hover any checked box to see who marked it and when.
            </AlertDescription>
          </Alert>

          <Tabs defaultValue="provider">
            <TabsList className="flex-wrap h-auto">
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
              <TabsTrigger value="history">
                <History className="h-3.5 w-3.5 mr-1" /> History
                {auditEntries.length > 0 && (
                  <span className="ml-1 text-xs">({auditEntries.length})</span>
                )}
              </TabsTrigger>
            </TabsList>

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
        </TabsContent>

        {/* ============ AUDIT / WHY ============ */}
        <TabsContent value="audit" className="mt-4 space-y-4">
          <AuditPanel
            month={month}
            acceptedRows={acceptedRows}
            declinedRows={declinedRows}
            needsReviewRows={needsReviewRows}
            availabilityRows={availabilitySubmissions}
            unmatchedRows={unmatchedSubs}
            missingRows={missingRows}
            shifts={shiftRows}
          />
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

const parseWidgetRows = (raw: unknown): Record<string, unknown>[] => {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is Record<string, unknown> =>
      entry != null && typeof entry === 'object' && !Array.isArray(entry),
  );
};

const asParsedBlob = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

const compactJson = (raw: unknown) => {
  try {
    return JSON.stringify(raw ?? null, null, 2);
  } catch {
    return String(raw);
  }
};

const formatAvailabilityRows = (
  raw: unknown,
  mode: 'recurring' | 'dated' | 'unavailable',
) => {
  const rows = parseWidgetRows(raw);
  if (rows.length === 0) return '—';
  return rows
    .slice(0, 4)
    .map(row => {
      if (mode === 'recurring') {
        const day = row['Day of Week'] ?? 'Day';
        return `${day}: ${row['Start Time (ET)'] ?? '?'}-${row['End Time (ET)'] ?? '?'}`;
      }
      if (mode === 'unavailable') {
        const start = row['Start Date'] ?? row.Date ?? '?';
        const end = row['End Date'] ?? start;
        return start === end ? String(start) : `${start}-${end}`;
      }
      return `${row.Date ?? '?'}: ${row['Start Time (ET)'] ?? '?'}-${row['End Time (ET)'] ?? '?'}`;
    })
    .join('; ') + (rows.length > 4 ? `; +${rows.length - 4} more` : '');
};

function AvailabilitySubmissionsPanel({
  month,
  rows,
  isLoading,
}: {
  month: string;
  rows: AvailabilitySubmissionRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading availability submissions" />
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No Jotform availability submissions are stored for {formatMonthLabel(month)}.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Availability submissions · {formatMonthLabel(month)}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Source: Jotform form 252224341308043 → sync-jotform-submissions →
          schedule_submissions.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Shift type</TableHead>
              <TableHead>Recurring virtual</TableHead>
              <TableHead>One-off virtual</TableHead>
              <TableHead>In-home / clinic</TableHead>
              <TableHead>Unavailable / exceptions</TableHead>
              <TableHead className="text-right">Expanded hrs</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => {
              const parsed = asParsedBlob(row.parsed_shifts);
              const shiftTypes = Array.isArray(parsed.shift_types)
                ? (parsed.shift_types as unknown[]).map(String).join(', ')
                : String(parsed.shift_types ?? '—');
              const warnings = Array.isArray(row.validation_warnings)
                ? row.validation_warnings
                : [];
              return (
                <TableRow key={row.id}>
                  <TableCell className="align-top">
                    <div className="font-medium">{row.provider_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.provider_email ?? 'No email'} · {formatMonthLabel(row.target_month)}
                    </div>
                    {!row.provider_id && (
                      <Badge className="mt-1 bg-amber-100 text-amber-800 hover:bg-amber-100">
                        Unmatched
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-xs">{shiftTypes || '—'}</TableCell>
                  <TableCell className="align-top text-xs max-w-[220px]">
                    {formatAvailabilityRows(parsed.recurring_virtual, 'recurring')}
                  </TableCell>
                  <TableCell className="align-top text-xs max-w-[220px]">
                    {formatAvailabilityRows(parsed.one_off_virtual, 'dated')}
                  </TableCell>
                  <TableCell className="align-top text-xs max-w-[220px]">
                    {formatAvailabilityRows(parsed.in_home_clinic, 'dated')}
                  </TableCell>
                  <TableCell className="align-top text-xs max-w-[220px]">
                    {formatAvailabilityRows(parsed.unavailable_dates, 'unavailable')}
                    <div className="mt-1 text-muted-foreground">
                      Last-minute: {parsed.last_minute_ok == null ? '—' : parsed.last_minute_ok ? 'yes' : 'no'}
                      {parsed.travel_miles != null ? ` · ${parsed.travel_miles} mi` : ''}
                    </div>
                    {parsed.comments ? (
                      <div className="mt-1 text-muted-foreground">Comments: {String(parsed.comments)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top text-right tabular-nums">
                    <div>{formatHours(expandedSubmittedHours(row))}</div>
                    <div className="text-xs text-muted-foreground">
                      accepted {formatHours(row.accepted_hours)}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-xs text-muted-foreground">
                    <div>{formatRelativeTime(row.submitted_at)}</div>
                    <StatusBadge status={row.decision_status as DecisionStatus} />
                    {warnings.length > 0 && (
                      <div className="mt-1 text-amber-700">
                        {warnings.slice(0, 2).map(String).join(' · ')}
                      </div>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        Raw / parsed
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px] leading-snug">
                        {compactJson({
                          parsed_shifts: row.parsed_shifts,
                          raw_answers: row.raw_answers,
                        })}
                      </pre>
                    </details>
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
      hours_basis: expandedSubmittedHours(sub),
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
                <TableHead className="text-right">Expanded hrs</TableHead>
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
                      {formatHours(expandedSubmittedHours(sub))}
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
          state-by-state demand allocator. Expanded submitted hours are accepted unless flagged for
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

// ============================================================================
// July 2026 Workbench — new top-level tab panels
// ============================================================================

function ReadinessPanel({
  month,
  summary,
  missingCount,
  submittedHours,
  mentalHealthCount,
  mentalHealthAcceptedCount,
  inboxNeedsReviewCount,
  onJumpToCoverage,
  onJumpToAvailability,
  onJumpToMatching,
  onJumpToPublish,
}: {
  month: string;
  summary: {
    totalShifts: number;
    totalProviders: number;
    homebaseShifts: number;
    ehrShifts: number;
    declinedCount: number;
    needsReviewCount: number;
    missingCount: number;
  };
  missingCount: number;
  submittedHours: number;
  mentalHealthCount: number;
  mentalHealthAcceptedCount: number;
  inboxNeedsReviewCount: number;
  onJumpToCoverage: () => void;
  onJumpToAvailability: () => void;
  onJumpToMatching: () => void;
  onJumpToPublish: () => void;
}) {
  const demandQ = useMonthlyDemand(month);
  const coverageQ = useStateCoverage(month);

  const demandHours = useMemo(
    () => (demandQ.data ?? []).reduce((s, r) => s + Number(r.monthly_hours_target ?? 0), 0),
    [demandQ.data],
  );

  const acceptedHours = useMemo(
    () => (coverageQ.data?.rows ?? []).reduce((s, r) => s + r.filled, 0),
    [coverageQ.data],
  );

  const gapHours = demandHours - acceptedHours;
  const criticalGapStates = useMemo(
    () =>
      (coverageQ.data?.rows ?? []).filter(
        r => r.needed > 0 && r.pct_filled < 60,
      ),
    [coverageQ.data],
  );

  const homebasePct =
    summary.totalShifts > 0 ? Math.round((summary.homebaseShifts / summary.totalShifts) * 100) : 0;
  const ehrPct =
    summary.totalShifts > 0 ? Math.round((summary.ehrShifts / summary.totalShifts) * 100) : 0;

  // Readiness verdict — three buckets
  type Readiness = { label: 'Ready' | 'At Risk' | 'Not Ready'; tone: string };
  const readiness: Readiness = (() => {
    if (
      criticalGapStates.length === 0 &&
      missingCount === 0 &&
      summary.needsReviewCount === 0 &&
      ehrPct === 100
    ) {
      return { label: 'Ready', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    }
    if (criticalGapStates.length > 0 || missingCount > 5 || ehrPct < 50) {
      return { label: 'Not Ready', tone: 'bg-red-100 text-red-800 border-red-200' };
    }
    return { label: 'At Risk', tone: 'bg-amber-100 text-amber-800 border-amber-200' };
  })();

  // Biggest blocker + suggested next action
  const { blocker, nextAction, nextActionJump } = useMemo<{
    blocker: string;
    nextAction: string;
    nextActionJump: () => void;
  }>(() => {
    if (criticalGapStates.length > 0) {
      return {
        blocker: `${criticalGapStates.length} state${criticalGapStates.length === 1 ? '' : 's'} below 60% coverage (${criticalGapStates.slice(0, 3).map(s => s.state).join(', ')}${criticalGapStates.length > 3 ? '…' : ''})`,
        nextAction: 'Open Coverage Gaps and source licensed providers',
        nextActionJump: onJumpToCoverage,
      };
    }
    if (missingCount > 0) {
      return {
        blocker: `${missingCount} provider${missingCount === 1 ? '' : 's'} have not submitted ${formatMonthLabel(month)} availability`,
        nextAction: 'Open Availability → Missing and copy BCC list',
        nextActionJump: onJumpToAvailability,
      };
    }
    if (inboxNeedsReviewCount > 0) {
      return {
        blocker: `${inboxNeedsReviewCount} resubmission${inboxNeedsReviewCount === 1 ? '' : 's'} pending review`,
        nextAction: 'Resolve resubmissions in Availability → Resubmits',
        nextActionJump: onJumpToAvailability,
      };
    }
    if (summary.needsReviewCount > 0) {
      return {
        blocker: `${summary.needsReviewCount} submission${summary.needsReviewCount === 1 ? '' : 's'} flagged needs-review`,
        nextAction: 'Triage needs-review in Matching',
        nextActionJump: onJumpToMatching,
      };
    }
    if (homebasePct < 100) {
      return {
        blocker: `${summary.totalShifts - summary.homebaseShifts} shift${summary.totalShifts - summary.homebaseShifts === 1 ? '' : 's'} not yet posted to Homebase`,
        nextAction: 'Post remaining shifts in Publish Tracker',
        nextActionJump: onJumpToPublish,
      };
    }
    if (ehrPct < 100) {
      return {
        blocker: `${summary.totalShifts - summary.ehrShifts} shift${summary.totalShifts - summary.ehrShifts === 1 ? '' : 's'} not yet posted to EHR`,
        nextAction: 'Finish EHR posts in Publish Tracker',
        nextActionJump: onJumpToPublish,
      };
    }
    return {
      blocker: `None — ${formatMonthLabel(month)} is publish-ready`,
      nextAction: 'Confirm with ClinOps lead and announce',
      nextActionJump: onJumpToPublish,
    };
  }, [
    month,
    criticalGapStates,
    missingCount,
    inboxNeedsReviewCount,
    summary,
    homebasePct,
    ehrPct,
    onJumpToAvailability,
    onJumpToCoverage,
    onJumpToMatching,
    onJumpToPublish,
  ]);

  const lastUpdated = useMemo(() => {
    const ts = (demandQ.dataUpdatedAt || coverageQ.dataUpdatedAt) ?? Date.now();
    return new Date(ts).toLocaleString();
  }, [demandQ.dataUpdatedAt, coverageQ.dataUpdatedAt]);

  return (
    <div className="space-y-4">
      {/* HEADLINE: readiness verdict + blocker + next action */}
      <Card className={`border-2 ${readiness.tone}`}>
        <CardContent className="py-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Badge className={`text-sm px-3 py-1 ${readiness.tone}`}>
              {formatMonthLabel(month)} status: {readiness.label}
            </Badge>
            <div className="text-sm">
              <div className="font-medium">Biggest blocker</div>
              <div className="text-xs opacity-90">{blocker}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-right max-w-[260px]">
              <div className="font-medium">Next action</div>
              <div className="opacity-90">{nextAction}</div>
            </div>
            <Button size="sm" variant="outline" onClick={nextActionJump}>
              Go
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Forecast demand"
          value={demandHours ? `${demandHours.toFixed(0)} hrs` : '—'}
          sub={formatMonthLabel(month)}
        />
        <SummaryCard
          label="Expanded submitted"
          value={submittedHours ? `${submittedHours.toFixed(0)} hrs` : '—'}
          sub="Recurring expanded minus off dates"
        />
        <SummaryCard
          label="Accepted usable"
          value={acceptedHours ? `${acceptedHours.toFixed(0)} hrs` : '—'}
          sub={
            demandHours > 0
              ? `${Math.min(999, Math.round((acceptedHours / demandHours) * 100))}% of demand`
              : undefined
          }
        />
        <SummaryCard
          label={gapHours > 0 ? 'Remaining gap' : 'Surplus'}
          value={`${Math.abs(gapHours).toFixed(0)} hrs`}
          sub={gapHours > 0 ? 'Below demand' : 'Above demand'}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Missing submissions"
          value={String(missingCount)}
          sub={`Providers without ${formatMonthLabel(month)} hours`}
        />
        <SummaryCard
          label="Needs review"
          value={String(summary.needsReviewCount + inboxNeedsReviewCount)}
          sub={`${summary.needsReviewCount} flagged · ${inboxNeedsReviewCount} resubmissions`}
        />
        <SummaryCard
          label="Homebase posted"
          value={summary.totalShifts ? `${homebasePct}%` : '—'}
          sub={`${summary.homebaseShifts}/${summary.totalShifts} shifts`}
        />
        <SummaryCard
          label="EHR posted"
          value={summary.totalShifts ? `${ehrPct}%` : '—'}
          sub={`${summary.ehrShifts}/${summary.totalShifts} shifts`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              States with critical gaps
            </CardTitle>
          </CardHeader>
          <CardContent>
            {coverageQ.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : criticalGapStates.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No state below 60% coverage. Nice.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {criticalGapStates.map(r => (
                  <Badge
                    key={r.state}
                    className="bg-red-100 text-red-800 hover:bg-red-100"
                  >
                    {r.state} · {Math.round(r.pct_filled)}%
                  </Badge>
                ))}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={onJumpToCoverage}
            >
              Review coverage gaps
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-violet-500" />
              Mental health schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {mentalHealthAcceptedCount}/{mentalHealthCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              MH coaches / LPCs with an accepted submission this month. Staffed separately
              from telehealth.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={onJumpToAvailability}
            >
              Open Availability
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground">
        Last updated {lastUpdated}.
      </div>
    </div>
  );
}

function ForecastPanel({ month }: { month: string }) {
  const demandQ = useMonthlyDemand(month);
  const serviceLineQ = useMonthlyServiceLineDemand(month);
  const slaQ = useMonthlySlaRisk(month);
  const demandRows = demandQ.data;
  const serviceLineRows = serviceLineQ.data ?? [];
  const slaRows = slaQ.data;
  const rows = useMemo(() => demandRows ?? [], [demandRows]);
  const monthWeeks = weeksInMonth(month);
  const slaByState = useMemo(() => {
    const map = new Map<string, NonNullable<typeof slaRows>[number]>();
    for (const row of slaRows ?? []) map.set(row.state, row);
    return map;
  }, [slaRows]);

  const enriched = useMemo(() => {
    return rows
      .map(r => {
        const monthly = Number(r.monthly_hours_target ?? 0);
        const weekly = Number(r.adjusted_weekly_hours ?? monthly / monthWeeks);
        const rawWeekly = Number(r.raw_weekly_hours ?? weekly / 0.95);
        return {
          state: r.state,
          activeMembers: r.active_members,
          rawWeekly,
          weekly,
          monthly,
          dailyTarget: Number(r.daily_target_hours ?? weekly / 6),
          methodology: r.methodology_version ?? 'legacy',
        };
      })
      .sort((a, b) => b.monthly - a.monthly);
  }, [monthWeeks, rows]);

  if (demandQ.isLoading) {
    return <LoadingRow label="Loading forecast" />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No forecast loaded for ${formatMonthLabel(month)} yet`}
        body="The demand forecast comes from Metabase card 2974. Run the ClinOps Demand forecast workflow or invoke compute-demand-forecast for this month, then refresh."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Demand by state · {formatMonthLabel(month)}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Source: Metabase card 2974 via state_demand_targets. Demand is reported per state:
            raw weekly demand × 0.95, then exact days in month / 7 for monthly hours.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Active members</TableHead>
                <TableHead className="text-right">Raw/wk</TableHead>
                <TableHead className="text-right">Adjusted/wk</TableHead>
                <TableHead className="text-right">Monthly hrs</TableHead>
                <TableHead className="text-right">Daily target</TableHead>
                <TableHead>SLA / access risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enriched.map(r => {
                const risk = slaByState.get(r.state);
                return (
                  <TableRow key={r.state}>
                    <TableCell className="font-medium">{r.state}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.activeMembers ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.rawWeekly.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.weekly.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.monthly.toFixed(0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.dailyTarget.toFixed(1)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {risk
                        ? `${risk.status} · ${risk.flaggedDays}/${risk.totalDays} flagged`
                        : slaQ.isLoading
                          ? 'Loading'
                          : 'Unavailable'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Specialty lines</CardTitle>
          <p className="text-xs text-muted-foreground">
            Source: Metabase cards 2973 and 2971 via service_line_demand_targets.
            These are aggregate service-line needs; Jotform remains the source of truth
            for provider-requested hours.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service line</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Raw/wk</TableHead>
                <TableHead className="text-right">Adjusted/wk</TableHead>
                <TableHead className="text-right">Monthly hrs</TableHead>
                <TableHead className="text-right">Daily target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceLineRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-xs text-muted-foreground py-6 text-center">
                    No specialty service-line forecast rows loaded yet.
                  </TableCell>
                </TableRow>
              )}
              {serviceLineRows.map(row => (
                <TableRow key={row.service_line}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.scope}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(row.raw_weekly_hours).toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(row.adjusted_weekly_hours).toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(row.monthly_hours_target).toFixed(0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(row.daily_target_hours).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

const COVERAGE_STATUS_STYLE: Record<CoverageStatus, string> = {
  Covered: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  Watch: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  Gap: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  Critical: 'bg-red-100 text-red-800 hover:bg-red-100',
};

function CoverageGapsPanel({
  month,
  acceptedRows,
  missingRows,
}: {
  month: string;
  acceptedRows: ProviderPublishView[];
  missingRows: ProviderPublishView[];
}) {
  const coverageQ = useStateCoverage(month);
  const rows = coverageQ.data?.rows ?? [];

  if (coverageQ.isLoading) {
    return <LoadingRow label="Loading coverage" />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No coverage data for ${formatMonthLabel(month)} yet`}
        body="Coverage comes from shift_recommendations + state_demand_targets. What's missing: an evaluator run after Jotform submissions land. Next: click 'Re-run evaluator' in the header, then come back."
      />
    );
  }

  const sorted = [...rows].sort((a, b) => a.pct_filled - b.pct_filled);

  const recommendedFor = (pct: number, gap: number): string => {
    if (pct >= 95) return 'Hold — keep monitoring';
    if (pct >= 80) return 'Watch for cancellations';
    if (pct >= 60) return `Source ${Math.ceil(Math.abs(gap))} more hrs from licensed providers`;
    return `Critical — open Matching to reassign or hire`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Coverage gaps · {formatMonthLabel(month)}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Which states are short or oversupplied, and what to do next.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Demand hrs</TableHead>
              <TableHead className="text-right">Accepted hrs</TableHead>
              <TableHead className="text-right">Gap / surplus</TableHead>
              <TableHead className="text-right">Coverage</TableHead>
              <TableHead className="text-right">Eligible</TableHead>
              <TableHead className="text-right">Missing</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Recommended action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(r => {
              const status = r.status ?? coverageStatusFor(r.pct_filled);
              const diff = r.filled - r.needed;
              return (
                <TableRow key={r.state}>
                  <TableCell className="font-medium">{r.state}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.needed.toFixed(0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.filled.toFixed(0)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${diff < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.needed > 0 ? `${Math.round(r.pct_filled)}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {r.eligible_providers || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {r.missing_providers || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge className={COVERAGE_STATUS_STYLE[status]}>{status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px]">
                    {recommendedFor(r.pct_filled, diff)}
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-2">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-muted-foreground max-w-md mx-auto">{body}</div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Matching — provider-level recommendations with priority + decline reasons
// ============================================================================

type ProviderEligibilitySummary = {
  states: Set<string>;
  sources: Set<string>;
};

type ProviderPriorityKey = 'clinical_supervisor' | 'vitable_internal' | 'access_provider';

type ProviderPriority = {
  key: ProviderPriorityKey;
  rank: 0 | 1 | 2;
  label: string;
};

const PROVIDER_PRIORITY_BY_KEY: Record<ProviderPriorityKey, ProviderPriority> = {
  clinical_supervisor: { key: 'clinical_supervisor', rank: 0, label: 'Clinical supervisor' },
  vitable_internal: { key: 'vitable_internal', rank: 1, label: 'Vitable internal' },
  access_provider: { key: 'access_provider', rank: 2, label: 'Access provider' },
};

const LICENSE_SOURCE_LABELS: Record<string, string> = {
  provider_licenses: 'ClinOps',
  medallion_api: 'Medallion',
  directshifts_static: 'DirectShifts',
  metabase_active: 'Metabase active',
};

function parsePriorityFromNotes(notes: string | null | undefined): ProviderPriority | null {
  const match = (notes ?? '').match(/provider_priority=([^;]+)/);
  const key = match?.[1]?.trim() as ProviderPriorityKey | undefined;
  return key && key in PROVIDER_PRIORITY_BY_KEY ? PROVIDER_PRIORITY_BY_KEY[key] : null;
}

function providerPriorityForRow(row: ProviderPublishView): ProviderPriority {
  const fromNotes = parsePriorityFromNotes(row.submission?.decision_notes);
  if (fromNotes) return fromNotes;

  const employmentType = (row.employment_type ?? '').trim().toLowerCase();
  const source = (row.provider_source ?? '').trim().toLowerCase();
  const shiftTypes = Array.isArray(row.shift_types) ? row.shift_types : [];
  const haystack = [
    row.provider_name,
    row.profession,
    employmentType,
    source,
    ...shiftTypes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');

  if (
    haystack.includes('clinical supervisor') ||
    haystack.includes('clinical lead') ||
    haystack.includes('supervisor')
  ) {
    return PROVIDER_PRIORITY_BY_KEY.clinical_supervisor;
  }
  if (
    employmentType === 'agency' ||
    source.includes('directshifts') ||
    source.includes('direct shifts') ||
    source.includes('access') ||
    haystack.includes('directshifts') ||
    haystack.includes('direct shifts') ||
    haystack.includes('access provider') ||
    haystack.includes('agency supplied')
  ) {
    return PROVIDER_PRIORITY_BY_KEY.access_provider;
  }
  return PROVIDER_PRIORITY_BY_KEY.vitable_internal;
}

function statusSort(row: ProviderPublishView): number {
  const status = row.submission?.decision_status;
  if (status === 'accepted') return 0;
  if (status === 'partial') return 1;
  if (status === 'needs_review') return 2;
  if (status === 'declined') return 3;
  return 4;
}

function formatLicenseSources(sources: Set<string> | undefined): string {
  if (!sources || sources.size === 0) return '';
  return Array.from(sources)
    .map(s => LICENSE_SOURCE_LABELS[s] ?? s)
    .sort()
    .join(', ');
}

function inferPriorityReason(row: ProviderPublishView): string {
  const priority = providerPriorityForRow(row);
  const reasons: string[] = [];
  reasons.push(`P${priority.rank + 1} ${priority.label}`);
  const emp = (row.employment_type ?? '').trim();
  if (emp) reasons.push(emp.toUpperCase());
  const accepted = Number(row.submission?.accepted_hours ?? 0);
  const declined = Number(row.submission?.declined_hours ?? 0);
  if (accepted > 0 && declined === 0) reasons.push('Full accept');
  if (declined > 0 && accepted > 0) reasons.push('Partial accept');
  return reasons.join(' · ') || '—';
}

function inferDeclineReason(row: ProviderPublishView): string {
  const notes = (row.submission?.decision_notes ?? '').trim();
  if (notes) return notes;
  const status = row.submission?.decision_status;
  if (status === 'declined') return 'Declined (no reason recorded — see Audit tab)';
  const declined = Number(row.submission?.declined_hours ?? 0);
  if (declined > 0) return `${declined.toFixed(1)} hrs cut`;
  return '';
}

function MatchingPanel({
  month,
  acceptedRows,
  declinedRows,
  needsReviewRows,
  shiftsByProvider,
  eligibilityByProvider,
}: {
  month: string;
  acceptedRows: ProviderPublishView[];
  declinedRows: ProviderPublishView[];
  needsReviewRows: ProviderPublishView[];
  shiftsByProvider: Map<string, ShiftRow[]>;
  eligibilityByProvider: Map<string, ProviderEligibilitySummary>;
}) {
  const all = useMemo(() => {
    const seen = new Set<string>();
    const merged: ProviderPublishView[] = [];
    for (const r of [...acceptedRows, ...declinedRows, ...needsReviewRows]) {
      if (seen.has(r.provider_id)) continue;
      seen.add(r.provider_id);
      merged.push(r);
    }
    return merged.sort((a, b) => {
      const pa = providerPriorityForRow(a);
      const pb = providerPriorityForRow(b);
      if (pa.rank !== pb.rank) return pa.rank - pb.rank;
      const sa = statusSort(a);
      const sb = statusSort(b);
      if (sa !== sb) return sa - sb;
      const ha = Number(a.submission?.accepted_hours ?? 0);
      const hb = Number(b.submission?.accepted_hours ?? 0);
      if (ha !== hb) return hb - ha;
      return a.provider_name.localeCompare(b.provider_name, undefined, { sensitivity: 'base' });
    });
  }, [acceptedRows, declinedRows, needsReviewRows]);

  if (all.length === 0) {
    return (
      <EmptyState
        title={`No matching decisions yet for ${formatMonthLabel(month)}`}
        body="The matching view summarizes which providers were accepted, cut, or flagged. What's missing: at least one evaluator run after Jotform submissions. Next: open the Availability tab to confirm submissions are in, then click 'Re-run evaluator' in the page header."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider recommendations · {formatMonthLabel(month)}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Who is getting hours, why, and what was cut. Allocation uses Supabase provider-state
          eligibility, then prioritizes clinical supervisors, Vitable internal providers, and
          access providers.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>State basis</TableHead>
              <TableHead className="text-right">Shifts</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="text-right">Declined</TableHead>
              <TableHead>Priority reason</TableHead>
              <TableHead>Cut / decline reason</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {all.map(r => {
              const shifts = shiftsByProvider.get(r.provider_id) ?? [];
              const assignedStates = new Set<string>();
              for (const s of Array.isArray(shifts) ? shifts : []) {
                if (s.assigned_state) assignedStates.add(s.assigned_state);
              }
              const parsedShifts = r.submission?.parsed_shifts;
              for (const s of Array.isArray(parsedShifts) ? parsedShifts : []) {
                if (s && typeof s === 'object' && 'state' in s) {
                  const state = (s as { state?: unknown }).state;
                  if (state) assignedStates.add(String(state).toUpperCase());
                }
              }
              const eligibility = eligibilityByProvider.get(r.provider_id);
              const eligibleStates = eligibility ? Array.from(eligibility.states).sort() : [];
              const assignedStateList = Array.from(assignedStates).sort();
              const sourceLabels = formatLicenseSources(eligibility?.sources);
              const accepted = Number(r.submission?.accepted_hours ?? 0);
              const declined = Number(r.submission?.declined_hours ?? 0);
              const status = r.submission?.decision_status ?? null;
              return (
                <TableRow key={r.provider_id}>
                  <TableCell className="font-medium">{r.provider_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.profession ?? '—'}
                    {r.employment_type ? ` · ${r.employment_type}` : ''}
                  </TableCell>
                  <TableCell className="text-xs">
                    {assignedStateList.length > 0 ? (
                      <div>Assigned: {assignedStateList.join(', ')}</div>
                    ) : eligibleStates.length > 0 ? (
                      <div>Eligible: {eligibleStates.join(', ')}</div>
                    ) : (
                      <div>—</div>
                    )}
                    {assignedStateList.length > 0 && eligibleStates.length > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        Eligible: {eligibleStates.join(', ')}
                      </div>
                    )}
                    {sourceLabels && (
                      <div className="text-[11px] text-muted-foreground">
                        Sources: {sourceLabels}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{shifts.length || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{accepted.toFixed(1)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${declined > 0 ? 'text-red-700' : ''}`}>
                    {declined.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                    {inferPriorityReason(r)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                    {inferDeclineReason(r) || '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={status} />
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

// ============================================================================
// Audit / Why — explains every accept / decline / cut / needs-review
// ============================================================================

function classifyReason(text: string): string {
  const t = text.toLowerCase();
  if (!t) return 'No reason recorded';
  if (t.includes('outside') && t.includes('business')) return 'Outside business hours';
  if (t.includes('capacity') || t.includes('oversupply') || t.includes('surplus'))
    return 'State capacity full';
  if (t.includes('unavailable') || t.includes('off-day') || t.includes('off day'))
    return 'Provider unavailable';
  if (t.includes('license') || t.includes('licensure')) return 'Missing license';
  if (t.includes('np') && (t.includes('restrict') || t.includes('prohibit')))
    return 'NP practice restriction';
  if (t.includes('malformed') || t.includes('parse') || t.includes('invalid')) return 'Malformed time';
  if (t.includes('unrealistic') || t.includes('too many')) return 'Unrealistic hours';
  if (t.includes('cost') || t.includes('rate') || t.includes('expensive'))
    return 'High-cost provider deprioritized';
  if (t.includes('clinical lead') || t.includes('md')) return 'Clinical lead prioritized';
  if (t.includes('lower') && t.includes('rate')) return 'Lower-rate provider prioritized';
  return 'Other';
}

const SOURCE_STATUS_STYLE: Record<SourceAuditSection['status'], string> = {
  healthy: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  watch: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  missing: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  error: 'bg-red-100 text-red-800 hover:bg-red-100',
};

const METRIC_TONE_STYLE: Record<NonNullable<SourceAuditSection['metrics'][number]['tone']>, string> = {
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
  neutral: 'text-foreground',
};

function formatAuditTimestamp(iso: string | null) {
  if (!iso) return 'No timestamp';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SourceAuditPanel({ month }: { month: string }) {
  const auditQ = useSchedulingSourceAudit(month);

  if (auditQ.isLoading) {
    return <LoadingRow label="Loading source audit" />;
  }

  if (auditQ.isError || !auditQ.data) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Source audit could not load. {auditQ.error instanceof Error ? auditQ.error.message : ''}
        </AlertDescription>
      </Alert>
    );
  }

  const sections = [
    auditQ.data.homebase,
    auditQ.data.metabase,
    auditQ.data.jotform,
    auditQ.data.medallion,
    auditQ.data.directshifts,
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-5">
      {sections.map(section => (
        <Card key={section.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm">{section.title}</CardTitle>
                <div className="text-xs text-muted-foreground mt-1">
                  Updated {formatAuditTimestamp(section.updatedAt)}
                </div>
              </div>
              <Badge className={SOURCE_STATUS_STYLE[section.status]}>
                {section.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {section.error && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">{section.error}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              {section.metrics.map(metric => (
                <div key={metric.label} className="flex items-start justify-between gap-3 border-b pb-1.5 last:border-0 last:pb-0">
                  <div className="text-xs text-muted-foreground">{metric.label}</div>
                  <div className={`text-xs font-medium text-right ${METRIC_TONE_STYLE[metric.tone ?? 'neutral']}`}>
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs font-medium mb-1">Fields flowing</div>
              <div className="space-y-1">
                {section.fieldCoverage.map(item => (
                  <div key={item} className="text-xs text-muted-foreground">{item}</div>
                ))}
              </div>
            </div>
            {section.gaps.length > 0 && (
              <div>
                <div className="text-xs font-medium mb-1">Gaps to watch</div>
                <div className="space-y-1">
                  {section.gaps.map(item => (
                    <div key={item} className="text-xs text-amber-700">{item}</div>
                  ))}
                </div>
              </div>
            )}
            {section.details.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {section.details.map(detail => (
                  <Badge key={`${detail.label}-${detail.count}`} variant="outline" className="text-[11px]">
                    {detail.label} · {detail.count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DataSourceMapPanel() {
  const rows = [
    ['Homebase source', 'sync-homebase → near-term homebase_locations / homebase_employees / homebase_shifts; sync-homebase-rates → provider_pay_rates', 'Same-day / next-day calendar visibility, scheduled hours, rates, match quality'],
    ['Metabase source', 'cards 2974 / 2973 / 2971 / 2940 → compute-demand-forecast → demand_forecast / state_demand_targets / service_line_demand_targets / provider_state_active', 'Forecast, Readiness, Coverage, Source audit, Allocation eligibility'],
    ['Jotform availability', 'sync-jotform-submissions → schedule_submissions.raw_answers / parsed_shifts', 'Source of truth for requested monthly provider hours, Matching, Audit'],
    ['Demand forecast', 'compute-demand-forecast → demand_forecast → state_demand_targets', 'Forecast, Readiness, Coverage'],
    ['Provider directory', 'providers', 'Missing submissions, Setup, Matching'],
    ['Medallion licensure', 'sync-medallion-licenses → medallion_provider_licenses → v_provider_state_eligibility', 'Evaluator eligibility, Coverage eligible/missing counts, Source audit'],
    ['DirectShifts licensure', 'directshifts_provider_licenses → v_provider_state_eligibility', 'Evaluator eligibility, Coverage eligible/missing counts, Source audit'],
    ['ClinOps licensure', 'provider_licenses → v_provider_state_eligibility', 'Evaluator eligibility, Coverage eligible/missing counts'],
    ['EHR readiness', 'providers.ehr_activation_status plus shift_recommendations.ehr_posted_at', 'Publish Tracker'],
    ['Homebase publishing', 'shift_recommendations.publish_status / publish_audit_log', 'Publish Tracker, History'],
    ['Recommendations', 'evaluate-schedule-submissions → shift_recommendations', 'Matching, Coverage, Publish, Audit'],
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Data source map</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Source path</TableHead>
              <TableHead>Used in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([label, source, used]) => (
              <TableRow key={label}>
                <TableCell className="font-medium">{label}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{source}</TableCell>
                <TableCell className="text-xs">{used}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DataQualityPanel({
  month,
  availabilityRows,
  unmatchedRows,
  missingRows,
  acceptedRows,
  shifts,
  coverageRows,
}: {
  month: string;
  availabilityRows: AvailabilitySubmissionRow[];
  unmatchedRows: Array<{ id: string; provider_name: string; target_month: string }>;
  missingRows: ProviderPublishView[];
  acceptedRows: ProviderPublishView[];
  shifts: ShiftRow[];
  coverageRows: Array<{
    state: string;
    needed: number;
    eligible_providers: number;
  }>;
}) {
  const emptyParsed = availabilityRows.filter(row => {
    const parsed = asParsedBlob(row.parsed_shifts);
    return (
      parseWidgetRows(parsed.recurring_virtual).length +
        parseWidgetRows(parsed.one_off_virtual).length +
        parseWidgetRows(parsed.in_home_clinic).length
    ) === 0;
  });

  const missingEmail = availabilityRows.filter(row => !row.provider_email);
  const invalidTime = availabilityRows.filter(row => {
    const warnings = Array.isArray(row.validation_warnings)
      ? row.validation_warnings.map(String).join(' ')
      : '';
    return (
      row.validation_status === 'needs_review' ||
      /invalid|malformed|unrealistic|rejected|manual review/i.test(warnings)
    );
  });

  const byProviderMonth = new Map<string, number>();
  for (const row of availabilityRows) {
    const key = `${row.provider_id ?? row.provider_name}|${row.target_month}`;
    byProviderMonth.set(key, (byProviderMonth.get(key) ?? 0) + 1);
  }
  const duplicateGroups = Array.from(byProviderMonth.values()).filter(n => n > 1).length;

  const acceptedExceedsSubmitted = acceptedRows.filter(row => {
    const sub = row.submission;
    if (!sub) return false;
    const submitted = Number(expandedSubmittedHours(sub) ?? 0);
    const accepted = Number(sub.accepted_hours ?? 0);
    return submitted > 0 && accepted - submitted > 0.01;
  });

  const acceptedProviderIds = new Set(acceptedRows.map(r => r.provider_id));
  const providersWithShiftRows = new Set(shifts.map(s => s.provider_id).filter(Boolean) as string[]);
  const missingPublishRows = Array.from(acceptedProviderIds).filter(
    providerId => !providersWithShiftRows.has(providerId),
  ).length;

  const demandWithoutEligibleProviders = coverageRows.filter(
    row => row.needed > 0 && row.eligible_providers === 0,
  );

  const unmatchedThisMonth = unmatchedRows.filter(row => row.target_month === month);
  const unmatchedOtherMonths = unmatchedRows.filter(row => row.target_month !== month);

  const checks = [
    {
      label: 'Submissions with no matched provider',
      count: unmatchedThisMonth.length,
      detail: unmatchedThisMonth.slice(0, 3).map(r => r.provider_name).join(', '),
    },
    {
      label: 'Unmatched submissions for another month',
      count: unmatchedOtherMonths.length,
      detail: unmatchedOtherMonths.slice(0, 3).map(r => `${r.provider_name} (${formatMonthLabel(r.target_month)})`).join(', '),
    },
    {
      label: 'Missing provider email',
      count: missingEmail.length,
      detail: missingEmail.slice(0, 3).map(r => r.provider_name).join(', '),
    },
    {
      label: 'Invalid / needs-review time ranges',
      count: invalidTime.length,
      detail: invalidTime.slice(0, 3).map(r => r.provider_name).join(', '),
    },
    {
      label: 'Duplicate submissions / resubmission groups',
      count: duplicateGroups,
      detail: duplicateGroups ? 'Review Availability → Resubmits' : '',
    },
    {
      label: 'Parsed shifts empty',
      count: emptyParsed.length,
      detail: emptyParsed.slice(0, 3).map(r => r.provider_name).join(', '),
    },
    {
      label: 'Active providers missing availability',
      count: missingRows.length,
      detail: missingRows.slice(0, 3).map(r => r.provider_name).join(', '),
    },
    {
      label: 'Accepted hours exceed expanded submitted hours',
      count: acceptedExceedsSubmitted.length,
      detail: acceptedExceedsSubmitted.slice(0, 3).map(r => r.provider_name).join(', '),
    },
    {
      label: 'State demand but no eligible providers',
      count: demandWithoutEligibleProviders.length,
      detail: demandWithoutEligibleProviders.slice(0, 5).map(r => r.state).join(', '),
    },
    {
      label: 'Accepted providers missing publish rows',
      count: missingPublishRows,
      detail: missingPublishRows ? 'Run evaluator to emit shift_recommendations' : '',
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Data quality checks · {formatMonthLabel(month)}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {checks.map(check => (
            <div
              key={check.label}
              className="flex items-start justify-between gap-3 rounded-md border p-2"
            >
              <div>
                <div className="text-sm font-medium">{check.label}</div>
                {check.detail && (
                  <div className="text-xs text-muted-foreground mt-0.5">{check.detail}</div>
                )}
              </div>
              <Badge
                className={
                  check.count > 0
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                }
              >
                {check.count}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AuditPanel({
  month,
  acceptedRows,
  declinedRows,
  needsReviewRows,
  availabilityRows,
  unmatchedRows,
  missingRows,
  shifts,
}: {
  month: string;
  acceptedRows: ProviderPublishView[];
  declinedRows: ProviderPublishView[];
  needsReviewRows: ProviderPublishView[];
  availabilityRows: AvailabilitySubmissionRow[];
  unmatchedRows: Array<{ id: string; provider_name: string; target_month: string }>;
  missingRows: ProviderPublishView[];
  shifts: ShiftRow[];
}) {
  const coverageQ = useStateCoverage(month);
  type Entry = {
    provider: string;
    profession: string | null;
    bucket: 'Accepted' | 'Declined / cut' | 'Needs review';
    reasonClass: string;
    reasonText: string;
    hours: number;
  };

  const entries: Entry[] = [];
  for (const r of acceptedRows) {
    const declined = Number(r.submission?.declined_hours ?? 0);
    const note = (r.submission?.decision_notes ?? '').trim();
    if (declined > 0 || note) {
      entries.push({
        provider: r.provider_name,
        profession: r.profession,
        bucket: declined > 0 ? 'Declined / cut' : 'Accepted',
        reasonClass: classifyReason(note),
        reasonText: note || 'Accepted in full',
        hours: declined || Number(r.submission?.accepted_hours ?? 0),
      });
    } else {
      entries.push({
        provider: r.provider_name,
        profession: r.profession,
        bucket: 'Accepted',
        reasonClass: 'Clean accept',
        reasonText: 'Accepted in full — no cuts',
        hours: Number(r.submission?.accepted_hours ?? 0),
      });
    }
  }
  for (const r of declinedRows) {
    if (acceptedRows.find(a => a.provider_id === r.provider_id)) continue;
    const note = (r.submission?.decision_notes ?? '').trim();
    entries.push({
      provider: r.provider_name,
      profession: r.profession,
      bucket: 'Declined / cut',
      reasonClass: classifyReason(note),
      reasonText: note || 'Declined (no reason recorded)',
      hours: Number(r.submission?.declined_hours ?? 0),
    });
  }
  for (const r of needsReviewRows) {
    const note = (r.submission?.decision_notes ?? '').trim();
    entries.push({
      provider: r.provider_name,
      profession: r.profession,
      bucket: 'Needs review',
      reasonClass: classifyReason(note),
      reasonText: note || 'Flagged for manual review',
      hours: Number(r.submission?.accepted_hours ?? 0),
    });
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <SourceAuditPanel month={month} />
        <DataSourceMapPanel />
        <DataQualityPanel
          month={month}
          availabilityRows={availabilityRows}
          unmatchedRows={unmatchedRows}
          missingRows={missingRows}
          acceptedRows={acceptedRows}
          shifts={shifts}
          coverageRows={coverageQ.data?.rows ?? []}
        />
        <EmptyState
          title="No decisions to explain yet"
          body="Once submissions are evaluated, every accept / decline / cut shows up here with a plain-English reason. Next: confirm submissions are in on the Availability tab and re-run the evaluator."
        />
      </div>
    );
  }

  // Reason rollup
  const rollup = new Map<string, number>();
  for (const e of entries) rollup.set(e.reasonClass, (rollup.get(e.reasonClass) ?? 0) + 1);
  const rollupSorted = Array.from(rollup.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <SourceAuditPanel month={month} />
      <DataSourceMapPanel />
      <DataQualityPanel
        month={month}
        availabilityRows={availabilityRows}
        unmatchedRows={unmatchedRows}
        missingRows={missingRows}
        acceptedRows={acceptedRows}
        shifts={shifts}
        coverageRows={coverageQ.data?.rows ?? []}
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Why the schedule looks the way it does</CardTitle>
          <p className="text-xs text-muted-foreground">
            Rollup of every accept / decline / cut / needs-review decision for {formatMonthLabel(month)}.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {rollupSorted.map(([k, n]) => (
              <Badge key={k} variant="outline" className="text-xs">
                {k} · {n}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Decision log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead>Reason class</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="text-right">Hrs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries
                .sort((a, b) => {
                  const order = { 'Needs review': 0, 'Declined / cut': 1, Accepted: 2 } as const;
                  return (order[a.bucket] - order[b.bucket]) || a.provider.localeCompare(b.provider);
                })
                .map((e, i) => (
                  <TableRow key={`${e.provider}-${i}`}>
                    <TableCell className="font-medium">{e.provider}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.profession ?? '—'}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          e.bucket === 'Accepted'
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                            : e.bucket === 'Needs review'
                              ? 'bg-orange-100 text-orange-800 hover:bg-orange-100'
                              : 'bg-red-100 text-red-700 hover:bg-red-100'
                        }
                      >
                        {e.bucket}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{e.reasonClass}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[420px]">
                      {e.reasonText}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.hours.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
