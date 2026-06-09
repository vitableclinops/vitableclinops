import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import SchedulingShell from './SchedulingShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  CheckCircle2,
  ClipboardList,
  CircleDot,
  PlayCircle,
  Plus,
  Search,
  Pencil,
  Trash2,
  Save,
  DollarSign,
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
  useProviderOutreachLog,
  useMarkProviderOutreachSent,
  useProviderSchedulingExceptions,
  useProviderPayRates,
  useUpsertProviderPayRate,
  useProviderSearch,
  useSchedulingExceptions,
  useSchedulingRecalculationHistory,
  useUpdateProviderSchedulingException,
  useUpsertSchedulingException,
  useDeleteSchedulingException,
  formatShiftTime,
  isHomebaseDone,
  isEhrDone,
  type AvailabilitySubmissionRow,
  type ProviderOutreachLog,
  type ProviderPayRateRow,
  type ProviderPublishView,
  type ProviderStateEligibilityRow,
  type SubmissionRow,
  type SubmissionForInbox,
  type UnmatchedSubmission,
  type DecisionStatus,
  type ParsedShift,
  type ShiftRow,
  type ShiftPublishStep,
  type ProviderSearchHit,
  type ProviderSchedulingExceptionRow,
  type SchedulingExceptionRow,
  type ScheduleRecalculationResult,
  type SchedulingRecalculationChange,
  type SchedulingRecalculationRun,
} from '@/hooks/useMonthlyPublish';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { parseJotformCsv, buildShiftCandidates } from '@/lib/juneSchedule/parseJotform';
import { normName, normEmail } from '@/lib/juneSchedule/normalize';
import { ResubmissionInboxPanel } from '@/components/scheduling/ResubmissionInboxPanel';
import { OnboardingReadinessPanel } from '@/components/scheduling/OnboardingReadinessPanel';
import { UnmatchedSubmissionsPanel } from '@/components/scheduling/UnmatchedSubmissionsPanel';
import { ProviderNoteIndicator, ProviderNotesCard } from '@/components/scheduling/ProviderNotesCard';
import { cn } from '@/lib/utils';
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
import { useStateCoverage, type StateCoverageRow } from '@/hooks/useStateCoverage';
import {
  useSchedulingSourceAudit,
  type SourceAuditSection,
} from '@/hooks/useSchedulingSourceAudit';
import {
  isEligibleForState,
} from '@/lib/scheduling/coverage';
import {
  isMentalHealthProvider,
  mentalHealthServiceLineForProvider,
  SERVICE_LINE_LABEL,
  type MentalHealthServiceLine,
} from '@/lib/scheduling/mentalHealth';
import {
  formatShiftDateKeyInProviderTime,
  formatShiftDateLabelInProviderTime,
  formatShiftTimeRangeInProviderTime,
} from '@/lib/scheduling/timeZone';
import {
  buildSchedulingCostModel,
  type SchedulingCostProviderRow,
} from '@/lib/scheduling/costPerVisit';

const MONTH_OPTIONS = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
const monthParamToIso = (value: string | null): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
};
const monthIsoToParam = (value: string): string => value.slice(0, 7);

const requestedHoursFromUnmatchedSubmission = (submission: UnmatchedSubmission) => {
  const parsed = submission.parsed_shifts;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const requested = (parsed as Record<string, unknown>).requested_hours_total;
    if (typeof requested === 'number' && Number.isFinite(requested)) return requested;
    if (typeof requested === 'string') {
      const value = Number(requested);
      if (Number.isFinite(value)) return value;
    }
  }
  return 0;
};

const formatMonthLabel = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const normalizeMonthStart = (iso: string) => (iso.length === 7 ? `${iso}-01` : iso);

const weeksInMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() / 7;
};

const formatHours = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toFixed(1);

const formatWholeNumber = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(n));

const formatCurrency = (n: number | null | undefined, fractionDigits = 0) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(Number(n));

const finiteHoursFromUnknown = (raw: unknown): number | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const requestedHoursFromParsedShifts = (parsedShifts: unknown): number | null => {
  if (!parsedShifts || typeof parsedShifts !== 'object' || Array.isArray(parsedShifts)) return null;
  const requested = (parsedShifts as Record<string, unknown>).requested_hours_total;
  return finiteHoursFromUnknown(requested);
};

const expandedSubmittedHours = (
  row:
    | Pick<SubmissionRow, 'effective_hours_used_for_forecast' | 'normalized_requested_hours' | 'raw_requested_hours' | 'parsed_shifts'>
    | Pick<AvailabilitySubmissionRow, 'effective_hours_used_for_forecast' | 'normalized_requested_hours' | 'raw_requested_hours' | 'parsed_shifts'>
    | Pick<SubmissionForInbox, 'effective_hours_used_for_forecast' | 'normalized_requested_hours' | 'raw_requested_hours' | 'parsed_shifts'>
    | null
    | undefined,
) =>
  row?.effective_hours_used_for_forecast ??
  row?.normalized_requested_hours ??
  row?.raw_requested_hours ??
  requestedHoursFromParsedShifts(row?.parsed_shifts) ??
  null;

type ManualAvailabilityKind = 'recurring_virtual' | 'one_off_virtual' | 'in_home_clinic';

type ManualAvailabilityDraft = {
  id: string;
  kind: ManualAvailabilityKind;
  dayOfWeek: string;
  date: string;
  startTime: string;
  endTime: string;
  sourceIssues?: string[];
};

const WEEKDAY_OPTIONS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WEEKDAY_INDEX = new Map(WEEKDAY_OPTIONS.map((day, index) => [day.toLowerCase(), index]));

const MANUAL_AVAILABILITY_KIND_LABEL: Record<ManualAvailabilityKind, string> = {
  recurring_virtual: 'Recurring virtual',
  one_off_virtual: 'One-off virtual',
  in_home_clinic: 'In-home / clinic',
};

const MAX_SINGLE_SHIFT_HOURS = 12;

const parseWidgetArray = (raw: unknown): Record<string, unknown>[] => {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    : [];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const pad2 = (n: number) => String(n).padStart(2, '0');

const parseTimeToMinutes = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (ampm === 'AM' && hour === 12) hour = 0;
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

const formatTimeInput = (minutes: number | null): string => {
  if (minutes == null) return '';
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
};

const timeInputFromRaw = (raw: unknown): string =>
  formatTimeInput(parseTimeToMinutes(raw));

const parseDateInput = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) return `${match[3]}-${pad2(Number(match[1]))}-${pad2(Number(match[2]))}`;
  return '';
};

const firstDateOfMonth = (month: string) => `${month.slice(0, 7)}-01`;

const manualDraftId = () =>
  `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const defaultManualAvailabilityDraft = (month: string): ManualAvailabilityDraft => ({
  id: manualDraftId(),
  kind: 'one_off_virtual',
  dayOfWeek: 'Monday',
  date: firstDateOfMonth(month),
  startTime: '09:00',
  endTime: '17:00',
});

const weekdayCountInMonth = (weekday: string, month: string): number => {
  const target = WEEKDAY_INDEX.get(weekday.toLowerCase());
  if (target == null) return 0;
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    if (date.getUTCDay() === target) count += 1;
  }
  return count;
};

const draftShiftHours = (draft: ManualAvailabilityDraft, month: string): number => {
  const start = parseTimeToMinutes(draft.startTime);
  const end = parseTimeToMinutes(draft.endTime);
  if (start == null || end == null || end <= start) return 0;
  const single = (end - start) / 60;
  if (draft.kind === 'recurring_virtual') {
    return single * weekdayCountInMonth(draft.dayOfWeek, month);
  }
  return draft.date.startsWith(month.slice(0, 7)) ? single : 0;
};

const totalManualAvailabilityHours = (drafts: ManualAvailabilityDraft[], month: string) =>
  Math.round(drafts.reduce((sum, draft) => sum + draftShiftHours(draft, month), 0) * 100) / 100;

const manualDraftSingleShiftHours = (draft: ManualAvailabilityDraft): number | null => {
  const start = parseTimeToMinutes(draft.startTime);
  const end = parseTimeToMinutes(draft.endTime);
  if (start == null || end == null || end <= start) return null;
  return Math.round(((end - start) / 60) * 100) / 100;
};

const warningStringsFromUnknown = (warnings: unknown): string[] => {
  if (Array.isArray(warnings)) {
    return warnings
      .map(warning => String(warning ?? '').trim())
      .filter(Boolean);
  }
  if (typeof warnings === 'string') {
    try {
      const parsed = JSON.parse(warnings);
      if (Array.isArray(parsed)) return warningStringsFromUnknown(parsed);
    } catch {
      // Plain text warning.
    }
    return warnings.trim() ? [warnings.trim()] : [];
  }
  if (isRecord(warnings)) {
    return Object.values(warnings)
      .flatMap(value => warningStringsFromUnknown(value))
      .filter(Boolean);
  }
  return [];
};

const manualDraftIssues = (draft: ManualAvailabilityDraft, month: string): string[] => {
  const issues: string[] = [...(draft.sourceIssues ?? [])];
  const start = parseTimeToMinutes(draft.startTime);
  const end = parseTimeToMinutes(draft.endTime);
  const singleShiftHours = manualDraftSingleShiftHours(draft);

  if (draft.kind === 'recurring_virtual' && !WEEKDAY_INDEX.has(draft.dayOfWeek.toLowerCase())) {
    issues.push('Weekday is missing');
  }
  if (draft.kind !== 'recurring_virtual') {
    if (!draft.date) issues.push('Date is missing');
    else if (!draft.date.startsWith(month.slice(0, 7))) {
      issues.push('Date is outside this month');
    }
  }
  if (start == null) issues.push('Start time is missing or invalid');
  if (end == null) issues.push('End time is missing or invalid');
  if (start != null && end != null && end <= start) {
    issues.push('End time is not after start time');
  }
  if (singleShiftHours != null && singleShiftHours > MAX_SINGLE_SHIFT_HOURS) {
    issues.push(`Single shift is ${formatHours(singleShiftHours)}h, over ${MAX_SINGLE_SHIFT_HOURS}h`);
  }
  return issues;
};

const validateManualAvailabilityDrafts = (
  drafts: ManualAvailabilityDraft[],
  month: string,
): string[] => {
  const errors: string[] = [];
  if (drafts.length === 0) errors.push('Add at least one corrected availability row.');
  drafts.forEach((draft, index) => {
    const label = `Row ${index + 1}`;
    for (const issue of manualDraftIssues(draft, month)) {
      errors.push(`${label}: ${issue}.`);
    }
  });
  return errors;
};

const kindFromLegacyShiftType = (raw: unknown): ManualAvailabilityKind => {
  const value = String(raw ?? '').toLowerCase();
  if (value.includes('home') || value.includes('clinic')) return 'in_home_clinic';
  if (value.includes('one')) return 'one_off_virtual';
  return 'recurring_virtual';
};

const manualDraftsFromParsedShifts = (
  parsedShifts: unknown,
  month: string,
  sourceWarnings: string[] = [],
  decisionNotes: string | null | undefined = null,
): ManualAvailabilityDraft[] => {
  const drafts: ManualAvailabilityDraft[] = [];
  const reviewSourceIssues = [
    ...sourceWarnings.filter(warning =>
      /invalid|malformed|unparseable|end time|start time|exceeds|max_single_shift|overnight/i.test(warning),
    ),
    ...(decisionNotes && /invalid|malformed|unparseable|end time|start time|exceeds|max_single_shift|overnight/i.test(decisionNotes)
      ? ['System flagged this submission for time review']
      : []),
  ].slice(0, 2);
  if (Array.isArray(parsedShifts)) {
    parsedShifts.forEach(item => {
      if (!isRecord(item)) return;
      const kind = kindFromLegacyShiftType(item.shift_type);
      drafts.push({
        id: manualDraftId(),
        kind,
        dayOfWeek: String(item.day_of_week ?? item.dayOfWeek ?? 'Monday'),
        date: parseDateInput(item.date),
        startTime: timeInputFromRaw(item.start_time),
        endTime: timeInputFromRaw(item.end_time),
      });
    });
  } else if (isRecord(parsedShifts)) {
    for (const row of parseWidgetArray(parsedShifts.recurring_virtual)) {
      drafts.push({
        id: manualDraftId(),
        kind: 'recurring_virtual',
        dayOfWeek: String(row['Day of Week'] ?? 'Monday'),
        date: firstDateOfMonth(month),
        startTime: timeInputFromRaw(row['Start Time (ET)']),
        endTime: timeInputFromRaw(row['End Time (ET)']),
      });
    }
    for (const row of parseWidgetArray(parsedShifts.one_off_virtual)) {
      drafts.push({
        id: manualDraftId(),
        kind: 'one_off_virtual',
        dayOfWeek: 'Monday',
        date: parseDateInput(row.Date),
        startTime: timeInputFromRaw(row['Start Time (ET)']),
        endTime: timeInputFromRaw(row['End Time (ET)']),
      });
    }
    for (const row of parseWidgetArray(parsedShifts.in_home_clinic)) {
      drafts.push({
        id: manualDraftId(),
        kind: 'in_home_clinic',
        dayOfWeek: 'Monday',
        date: parseDateInput(row.Date),
        startTime: timeInputFromRaw(row['Start Time (ET)']),
        endTime: timeInputFromRaw(row['End Time (ET)']),
      });
    }
  }
  if (drafts.length > 0) {
    return reviewSourceIssues.length > 0
      ? drafts.map(draft => ({ ...draft, sourceIssues: reviewSourceIssues }))
      : drafts;
  }
  if (reviewSourceIssues.length > 0) {
    return [{
      ...defaultManualAvailabilityDraft(month),
      startTime: '',
      endTime: '',
      sourceIssues: reviewSourceIssues,
    }];
  }
  return [defaultManualAvailabilityDraft(month)];
};

const formatManualDraftLabel = (draft: ManualAvailabilityDraft): string => {
  const time = `${draft.startTime}-${draft.endTime}`;
  if (draft.kind === 'recurring_virtual') return `${draft.dayOfWeek} ${time}`;
  return `${draft.date} ${time}`;
};

const summarizeManualAvailability = (
  drafts: ManualAvailabilityDraft[],
  month: string,
): string => {
  const labels = drafts.slice(0, 3).map(formatManualDraftLabel);
  const more = drafts.length > labels.length ? `; +${drafts.length - labels.length} more` : '';
  return `${labels.join('; ')}${more}; total=${formatHours(totalManualAvailabilityHours(drafts, month))}h`;
};

const buildCorrectedParsedShifts = (
  original: unknown,
  drafts: ManualAvailabilityDraft[],
  month: string,
) => {
  const base = isRecord(original) ? { ...original } : {};
  const originalSnapshot =
    base.clinops_original_widgets ??
    (isRecord(original)
      ? {
          recurring_virtual: original.recurring_virtual ?? null,
          one_off_virtual: original.one_off_virtual ?? null,
          in_home_clinic: original.in_home_clinic ?? null,
          requested_hours_total: original.requested_hours_total ?? null,
        }
      : { parsed_shifts: original ?? null });
  const recurring = drafts
    .filter(draft => draft.kind === 'recurring_virtual')
    .map(draft => ({
      'Day of Week': draft.dayOfWeek,
      'Start Time (ET)': draft.startTime,
      'End Time (ET)': draft.endTime,
      'ClinOps Correction': 'manual_needs_decision_review',
    }));
  const oneOff = drafts
    .filter(draft => draft.kind === 'one_off_virtual')
    .map(draft => ({
      Date: draft.date,
      'Start Time (ET)': draft.startTime,
      'End Time (ET)': draft.endTime,
      'ClinOps Correction': 'manual_needs_decision_review',
    }));
  const inHome = drafts
    .filter(draft => draft.kind === 'in_home_clinic')
    .map(draft => ({
      Date: draft.date,
      'Start Time (ET)': draft.startTime,
      'End Time (ET)': draft.endTime,
      'ClinOps Correction': 'manual_needs_decision_review',
    }));
  return {
    ...base,
    recurring_virtual: recurring,
    one_off_virtual: oneOff,
    in_home_clinic: inHome,
    requested_hours_total: totalManualAvailabilityHours(drafts, month),
    clinops_original_widgets: originalSnapshot,
    clinops_manual_correction: {
      source: 'needs_decision_review',
      corrected_at: new Date().toISOString(),
      corrected_hours: totalManualAvailabilityHours(drafts, month),
      summary: summarizeManualAvailability(drafts, month),
    },
  };
};

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
      ? 'preserved during schedule recalculation'
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

const formatProviderShiftDate = (shift: ShiftRow) =>
  formatShiftDateLabelInProviderTime(
    shift.shift_date,
    shift.start_min,
    shift.provider_time_zone,
  );

const formatProviderShiftDateKey = (shift: ShiftRow) =>
  formatShiftDateKeyInProviderTime(
    shift.shift_date,
    shift.start_min,
    shift.provider_time_zone,
  );

const formatProviderShiftTime = (shift: ShiftRow) =>
  formatShiftTimeRangeInProviderTime(
    shift.shift_date,
    shift.start_min,
    shift.end_min,
    shift.provider_time_zone,
  );

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

const MH_VISIT_CADENCE_MINUTES = 50;
const MH_MIN_SHIFT_HOURS = 2.5;

const labelShiftType = (t: string | null | undefined) => {
  if (!t) return '—';
  return SHIFT_TYPE_LABEL[t] ?? t;
};

const formatSchedulingShiftNote = (reason: string | null | undefined): string => {
  const text = reason ?? '';
  const notes: string[] = [];
  const breakMatch = text.match(/Mandatory 1-hour break applied \(([^)]+)\)/);
  if (breakMatch) {
    notes.push(`Break added: ${breakMatch[1]}. Do not schedule through the break.`);
  }
  const meetingMatch = text.match(/Provider meeting blackout removed ([^;]+)/);
  if (meetingMatch) {
    notes.push(`Provider meeting blocked: ${meetingMatch[1]}.`);
  }
  return notes.join(' ');
};

const safeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value : []);

export type SchedulingWorkbenchScope = 'medical' | 'mental_health';
type AvailabilityTabKey = 'submissions' | 'inbox' | 'unmatched' | 'setup' | 'missing' | 'timeoff';
type PublishTabKey = 'provider' | 'queue' | 'day' | 'history';
type ReviewTabKey = 'decisions' | 'resubmits' | 'recalculate';
type CoveragePlanTabKey = 'coverage' | 'matching' | 'declined' | 'cost' | 'forecast';
type ProviderTimeOffEntry = {
  row: ProviderPublishView;
  ranges: ReturnType<typeof extractUnavailableRanges>;
  totalDays: number;
};
const TOP_TAB_VALUES = [
  'readiness',
  'intake',
  'review',
  'coverage-plan',
  'publish',
  'exceptions',
  'data-sources',
] as const;
type TopTabKey = (typeof TOP_TAB_VALUES)[number];

const topTabFromParam = (tab: string | null, section?: string | null): TopTabKey => {
  if (TOP_TAB_VALUES.includes(section as TopTabKey)) return section as TopTabKey;
  if (TOP_TAB_VALUES.includes(tab as TopTabKey)) return tab as TopTabKey;
  if (tab === 'availability') return 'intake';
  if (tab === 'forecast' || tab === 'matching' || tab === 'coverage' || tab === 'declined' || tab === 'cost') {
    return 'coverage-plan';
  }
  if (tab === 'audit') return 'data-sources';
  return 'readiness';
};

const availabilityTabFromView = (view: string | null): AvailabilityTabKey => {
  if (view === 'resubmits') return 'inbox';
  if (view === 'pending-recalculation') return 'submissions';
  return ['submissions', 'inbox', 'unmatched', 'setup', 'missing', 'timeoff'].includes(view ?? '')
    ? (view as AvailabilityTabKey)
    : 'submissions';
};

const publishTabFromView = (view: string | null): PublishTabKey =>
  ['provider', 'queue', 'day', 'history'].includes(view ?? '')
    ? (view as PublishTabKey)
    : 'provider';

const reviewTabFromView = (view: string | null): ReviewTabKey => {
  if (view === 'needs-review' || view === 'needs-decision' || view === 'decisions') return 'decisions';
  if (view === 'resubmits' || view === 'inbox') return 'resubmits';
  if (view === 'pending-recalculation' || view === 'recalculate') return 'recalculate';
  return 'decisions';
};

const coveragePlanTabFromView = (view: string | null, tab: string | null): CoveragePlanTabKey => {
  const candidate = view ?? tab;
  if (candidate === 'coverage-plan') return 'coverage';
  if (candidate === 'declined') return 'declined';
  if (candidate === 'forecast' || candidate === 'matching' || candidate === 'coverage' || candidate === 'cost') {
    return candidate;
  }
  return 'coverage';
};

const scopeFromParam = (scope: string | null): SchedulingWorkbenchScope =>
  scope === 'mental_health' || scope === 'mental-health' || scope === 'mh' ? 'mental_health' : 'medical';

const scopeToParam = (scope: SchedulingWorkbenchScope) =>
  scope === 'mental_health' ? 'mental_health' : 'all';

export default function SchedulingWorkbenchPage({
  scope = 'medical',
}: { scope?: SchedulingWorkbenchScope } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const sectionParam = searchParams.get('section');
  const viewParam = searchParams.get('view');
  const scopeParam = searchParams.get('scope');
  const monthParam = searchParams.get('month');
  const [month, setMonth] = useState(() => monthParamToIso(monthParam) ?? '2026-07-01');
  const [activeScope, setActiveScope] = useState<SchedulingWorkbenchScope>(() =>
    scopeParam ? scopeFromParam(scopeParam) : scope,
  );
  const isMh = activeScope === 'mental_health';
  const [mhServiceLine, setMhServiceLine] = useState<'all' | MentalHealthServiceLine>('all');
  const [topTab, setTopTab] = useState<TopTabKey>(() => topTabFromParam(tabParam, sectionParam));
  const [availabilityTab, setAvailabilityTab] = useState<AvailabilityTabKey>(() =>
    availabilityTabFromView(viewParam),
  );
  const [publishTab, setPublishTab] = useState<PublishTabKey>(() => publishTabFromView(viewParam));
  const [reviewTab, setReviewTab] = useState<ReviewTabKey>(() => reviewTabFromView(viewParam));
  const [coveragePlanTab, setCoveragePlanTab] = useState<CoveragePlanTabKey>(() =>
    coveragePlanTabFromView(viewParam, tabParam),
  );

  const updateWorkbenchParams = ({
    nextMonth = month,
    nextScope = activeScope,
    section = topTab,
    view,
    providerId,
    replace = false,
  }: {
    nextMonth?: string;
    nextScope?: SchedulingWorkbenchScope;
    section?: TopTabKey;
    view?: string | null;
    providerId?: string | null;
    replace?: boolean;
  }) => {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.set('month', monthIsoToParam(nextMonth));
    next.set('scope', scopeToParam(nextScope));
    next.set('section', section);
    if (view) next.set('view', view);
    else next.delete('view');
    if (providerId) next.set('providerId', providerId);
    else if (providerId === null) next.delete('providerId');
    setSearchParams(next, { replace });
  };

  useEffect(() => {
    const canonicalMonth = monthParamToIso(monthParam);
    if (canonicalMonth && canonicalMonth !== month) setMonth(canonicalMonth);
  }, [month, monthParam]);

  useEffect(() => {
    const nextScope = scopeParam ? scopeFromParam(scopeParam) : scope;
    setActiveScope(current => (current === nextScope ? current : nextScope));
  }, [scope, scopeParam]);

  useEffect(() => {
    const nextTab = topTabFromParam(tabParam, sectionParam);
    setTopTab(current => (current === nextTab ? current : nextTab));
  }, [sectionParam, tabParam]);

  useEffect(() => {
    setAvailabilityTab(current => {
      const next = availabilityTabFromView(viewParam);
      return current === next ? current : next;
    });
    setPublishTab(current => {
      const next = publishTabFromView(viewParam);
      return current === next ? current : next;
    });
    setReviewTab(current => {
      const next = reviewTabFromView(viewParam);
      return current === next ? current : next;
    });
    setCoveragePlanTab(current => {
      const next = coveragePlanTabFromView(viewParam, tabParam);
      return current === next ? current : next;
    });
  }, [tabParam, viewParam]);

  useEffect(() => {
    if (!tabParam) return;
    const nextSection =
      tabParam === 'publish' && (viewParam === 'review' || viewParam === 'needs-review')
        ? 'review'
        : topTabFromParam(tabParam, sectionParam);
    const legacyView =
      tabParam === 'availability'
        ? viewParam || 'submissions'
        : tabParam === 'forecast' || tabParam === 'matching' || tabParam === 'coverage' || tabParam === 'declined' || tabParam === 'cost'
          ? tabParam
        : tabParam === 'publish'
            ? viewParam === 'review' || viewParam === 'needs-review'
              ? 'decisions'
              : viewParam || 'provider'
            : tabParam === 'audit'
              ? null
              : viewParam;
    updateWorkbenchParams({
      section: nextSection,
      view: legacyView,
      nextMonth: monthParamToIso(monthParam) ?? month,
      nextScope: scopeParam ? scopeFromParam(scopeParam) : scope,
      replace: true,
    });
  // Run only when legacy tab URLs are present; updateWorkbenchParams closes over current searchParams.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  const onTopTabChange = (v: string) => {
    const nextTab = topTabFromParam(v, v);
    setTopTab(nextTab);
    const defaultView =
      nextTab === 'intake'
        ? availabilityTab
        : nextTab === 'review'
          ? reviewTab
          : nextTab === 'coverage-plan'
            ? coveragePlanTab
            : nextTab === 'publish'
              ? publishTab
              : null;
    updateWorkbenchParams({ section: nextTab, view: defaultView, replace: true });
  };
  const onMonthChange = (nextMonth: string) => {
    setMonth(nextMonth);
    updateWorkbenchParams({ nextMonth, replace: true });
  };
  const onScopeChange = (nextScope: SchedulingWorkbenchScope) => {
    setActiveScope(nextScope);
    updateWorkbenchParams({ nextScope, replace: true });
  };
  const jumpToAvailability = (tab: AvailabilityTabKey = 'submissions') => {
    setAvailabilityTab(tab);
    setTopTab('intake');
    updateWorkbenchParams({ section: 'intake', view: tab, replace: true });
  };
  const jumpToReview = (tab: ReviewTabKey = 'decisions') => {
    setReviewTab(tab);
    setTopTab('review');
    updateWorkbenchParams({ section: 'review', view: tab, replace: true });
  };
  const jumpToCoveragePlan = (tab: CoveragePlanTabKey = 'coverage') => {
    setCoveragePlanTab(tab);
    setTopTab('coverage-plan');
    updateWorkbenchParams({ section: 'coverage-plan', view: tab, replace: true });
  };
  const jumpToPublish = (tab: PublishTabKey = 'provider') => {
    setPublishTab(tab);
    setTopTab('publish');
    updateWorkbenchParams({ section: 'publish', view: tab, replace: true });
  };
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded(p => ({ ...p, [id]: !p[id] }));

  const { data: dbRowsData = [], isLoading, refetch } = useMonthlyPublishView(month);
  const { data: shiftRowsData = [], isLoading: shiftsLoading, refetch: refetchShifts } =
    useShiftRecommendationsForMonth(month);
  const { data: cutRowsData = [], isLoading: cutsLoading, refetch: refetchCuts } =
    useShiftRecommendationsForMonth(month, 'cut');
  const { data: auditEntriesData = [] } = usePublishAuditLog(month);
  const { data: inboxSubmissionsData = [], isLoading: inboxLoading } =
    useResubmissionInbox(month);
  const { data: unmatchedSubsData = [] } = useUnmatchedSubmissions();
  const { data: availabilitySubmissionsData = [], isLoading: availabilityLoading } =
    useMonthlyAvailabilitySubmissions(month);
  const { data: providerEligibilityData = [] } = useProviderStateEligibility();
  const { data: providerPayRatesData = [], isLoading: providerPayRatesLoading } =
    useProviderPayRates(month);
  const { data: outreachLogsData = [] } = useProviderOutreachLog(month);
  const { data: readinessRowsData = [] } = useOnboardingReadiness(30);

  const dbRows = safeArray<ProviderPublishView>(dbRowsData);
  const shiftRows = safeArray<ShiftRow>(shiftRowsData);
  const cutRows = safeArray<ShiftRow>(cutRowsData);
  const auditEntries = safeArray<PublishAuditEntry>(auditEntriesData);
  const inboxSubmissions = safeArray<SubmissionForInbox>(inboxSubmissionsData);
  const unmatchedSubs = safeArray<UnmatchedSubmission>(unmatchedSubsData);
  const availabilitySubmissions = safeArray<AvailabilitySubmissionRow>(availabilitySubmissionsData);
  const providerEligibility = safeArray<ProviderStateEligibilityRow>(providerEligibilityData);
  const providerPayRates = safeArray<ProviderPayRateRow>(providerPayRatesData);
  const outreachLogs = safeArray<ProviderOutreachLog>(outreachLogsData);
  const readinessRows = safeArray<{ readyForSubmissions: boolean }>(readinessRowsData);
  const selectedMonthStart = normalizeMonthStart(month);
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
  const markOutreachSent = useMarkProviderOutreachSent();
  const reevaluate = useReevaluateMonth();
  const [lastRecalculation, setLastRecalculation] = useState<{
    result: ScheduleRecalculationResult;
    before: RecalculationSnapshotRow[];
    ranAt: string;
  } | null>(null);

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
              decision_run_id: null,
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

  const cutRowsByProvider = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of cutRows) {
      if (!s.provider_id) continue;
      if (!map.has(s.provider_id)) map.set(s.provider_id, []);
      map.get(s.provider_id)!.push(s);
    }
    return map;
  }, [cutRows]);

  const eligibilityByProvider = useMemo(() => {
    const map = new Map<string, ProviderEligibilitySummary>();
    const professionByProvider = new Map(rows.map(row => [row.provider_id, row.profession]));
    for (const row of providerEligibility) {
      if (!row.provider_id || !row.state || row.allocation_eligible !== true) continue;
      const state = String(row.state).trim().toUpperCase();
      if (!state) continue;
      const profession = professionByProvider.get(row.provider_id) ?? null;
      if (!isEligibleForState({ profession }, state)) continue;
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
  }, [providerEligibility, rows]);

  // Telehealth-only set drives the main publishing flow. MH gets its own tab.
  const telehealthRows = useMemo(
    () => rows.filter(r => !isMentalHealthProvider(r.profession, r.provider_name)),
    [rows],
  );
  const mentalHealthRows = useMemo(
    () => rows.filter(r => isMentalHealthProvider(r.profession, r.provider_name)),
    [rows],
  );
  const mentalHealthUnmatchedSubs = useMemo(
    () =>
      unmatchedSubs.filter(
        s =>
          s.target_month === month &&
          isMentalHealthProvider(null, s.provider_name),
      ),
    [month, unmatchedSubs],
  );

  const isAcceptedSubmission = (r: ProviderPublishView) =>
    r.submission?.decision_status === 'accepted' ||
    r.submission?.decision_status === 'partial';

  const hasDeclinedHours = (r: ProviderPublishView) =>
    r.submission?.decision_status === 'declined' ||
    Number(r.submission?.declined_hours ?? 0) > 0;

  const sortDeclinedRows = (items: ProviderPublishView[]) =>
    [...items].sort(
      (a, b) =>
        Number(b.submission?.declined_hours ?? 0) -
        Number(a.submission?.declined_hours ?? 0),
    );

  const acceptedRows = useMemo(
    () => telehealthRows.filter(isAcceptedSubmission),
    [telehealthRows],
  );
  const mentalHealthAcceptedRows = useMemo(
    () => mentalHealthRows.filter(isAcceptedSubmission),
    [mentalHealthRows],
  );

  // Include any provider with declined hours, not just status='declined'.
  // Partial accepts (oversupply trims, out-of-business-hours cuts) leave a
  // submission as 'accepted' or 'partial' but still have declined_hours > 0,
  // and ClinOps wants to see those alongside fully-declined submissions.
  const declinedRows = useMemo(
    () => sortDeclinedRows(telehealthRows.filter(hasDeclinedHours)),
    [telehealthRows],
  );
  const mentalHealthDeclinedRows = useMemo(
    () => sortDeclinedRows(mentalHealthRows.filter(hasDeclinedHours)),
    [mentalHealthRows],
  );
  const allDeclinedRows = useMemo(
    () => sortDeclinedRows(rows.filter(hasDeclinedHours)),
    [rows],
  );

  const needsReviewRows = useMemo(
    () => rows.filter(r => r.submission?.decision_status === 'needs_review'),
    [rows],
  );
  const telehealthNeedsReviewRows = useMemo(
    () => telehealthRows.filter(r => r.submission?.decision_status === 'needs_review'),
    [telehealthRows],
  );
  const mentalHealthNeedsReviewRows = useMemo(
    () => mentalHealthRows.filter(r => r.submission?.decision_status === 'needs_review'),
    [mentalHealthRows],
  );

  const missingRows = useMemo(
    () => rows.filter(r => !r.submission && !r.scheduling_outreach_exempt),
    [rows],
  );
  const telehealthMissingRows = useMemo(
    () => telehealthRows.filter(r => !r.submission && !r.scheduling_outreach_exempt),
    [telehealthRows],
  );
  const mentalHealthMissingRows = useMemo(
    () => mentalHealthRows.filter(r => !r.submission && !r.scheduling_outreach_exempt),
    [mentalHealthRows],
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
    const groups = groupSubmissionsForInbox(
      inboxSubmissions.filter(s => normalizeMonthStart(s.target_month) === selectedMonthStart),
    );
    return groups.filter(g => {
      if (g.latest.human_review_state === 'approved') return false;
      const d = diffParsedShifts(g.prior.parsed_shifts, g.latest.parsed_shifts, {
        targetMonth: selectedMonthStart,
      });
      return d.hasChanges;
    }).length;
  }, [inboxSubmissions, selectedMonthStart]);

  // Providers who listed off-days for this month — Lindsay's request so MSS can
  // see at-a-glance who's unavailable when sourcing a licensed provider.
  const timeOffRows: ProviderTimeOffEntry[] = useMemo(() => {
    const out: ProviderTimeOffEntry[] = [];
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

  // Aggregate progress: count individual shifts so the headline reflects
  // Sarabjeet's actual workload, not just per-provider check-marks.
  const allFlatAccepted = useMemo(() => {
    const acceptedProviderIds = new Set(acceptedRows.map(r => r.provider_id));
    return shiftRows.filter(s => s.provider_id && acceptedProviderIds.has(s.provider_id));
  }, [acceptedRows, shiftRows]);

  const mentalHealthFlatAccepted = useMemo(() => {
    const acceptedProviderIds = new Set(mentalHealthAcceptedRows.map(r => r.provider_id));
    return shiftRows.filter(s => s.provider_id && acceptedProviderIds.has(s.provider_id));
  }, [mentalHealthAcceptedRows, shiftRows]);

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
      needsReviewCount: telehealthNeedsReviewRows.length,
      missingCount: telehealthMissingRows.length,
    };
  }, [acceptedRows, allFlatAccepted, declinedRows, telehealthNeedsReviewRows, telehealthMissingRows]);

  const mentalHealthSummary = useMemo(() => {
    const totalShifts = mentalHealthFlatAccepted.length;
    const homebaseShifts = mentalHealthFlatAccepted.filter(isHomebaseDone).length;
    const ehrShifts = mentalHealthFlatAccepted.filter(isEhrDone).length;
    return {
      totalProviders: mentalHealthAcceptedRows.length,
      totalShifts,
      homebaseShifts,
      ehrShifts,
      declinedCount: mentalHealthDeclinedRows.length,
      needsReviewCount: mentalHealthNeedsReviewRows.length,
      missingCount: mentalHealthMissingRows.length,
    };
  }, [
    mentalHealthAcceptedRows,
    mentalHealthFlatAccepted,
    mentalHealthDeclinedRows,
    mentalHealthNeedsReviewRows,
    mentalHealthMissingRows,
  ]);

  // ─────────── Scope-aware (medical vs mental health) view models ───────────
  // Filters each row collection to the active scope so the same tab
  // components can power /scheduling/workbench and /scheduling/mental-health.
  const mhProviderName = (name?: string | null) =>
    isMentalHealthProvider(null, name ?? null);

  const mhSlMatches = useCallback((profession?: string | null, name?: string | null) => {
    if (!isMh || mhServiceLine === 'all') return true;
    return (
      mentalHealthServiceLineForProvider(profession ?? null, name ?? null) ===
      mhServiceLine
    );
  }, [isMh, mhServiceLine]);

  const scopedRows = useMemo(
    () =>
      (isMh ? mentalHealthRows : rows).filter(r =>
        mhSlMatches(r.profession, r.provider_name),
      ),
    [isMh, mhSlMatches, mentalHealthRows, rows],
  );
  const scopedAccepted = useMemo(
    () => scopedRows.filter(isAcceptedSubmission),
    [scopedRows],
  );
  const scopedDeclined = useMemo(
    () => sortDeclinedRows(scopedRows.filter(hasDeclinedHours)),
    [scopedRows],
  );
  const scopedNeedsReview = useMemo(
    () => scopedRows.filter(r => r.submission?.decision_status === 'needs_review'),
    [scopedRows],
  );
  const scopedMissing = useMemo(
    () => scopedRows.filter(r => !r.submission && !r.scheduling_outreach_exempt),
    [scopedRows],
  );
  const scopedFlatAccepted = useMemo(() => {
    const ids = new Set(scopedAccepted.map(r => r.provider_id));
    return shiftRows.filter(s => s.provider_id && ids.has(s.provider_id));
  }, [scopedAccepted, shiftRows]);
  const scopedCutRows = useMemo(() => {
    const ids = new Set(scopedRows.map(r => r.provider_id));
    return cutRows.filter(s => s.provider_id && ids.has(s.provider_id));
  }, [cutRows, scopedRows]);
  const scopedSummary = useMemo(() => {
    const totalShifts = scopedFlatAccepted.length;
    return {
      totalProviders: scopedAccepted.length,
      totalShifts,
      homebaseShifts: scopedFlatAccepted.filter(isHomebaseDone).length,
      ehrShifts: scopedFlatAccepted.filter(isEhrDone).length,
      declinedCount: scopedDeclined.length,
      needsReviewCount: scopedNeedsReview.length,
      missingCount: scopedMissing.length,
    };
  }, [scopedAccepted, scopedFlatAccepted, scopedDeclined, scopedNeedsReview, scopedMissing]);

  const scopedAvailabilitySubs = useMemo(
    () =>
      availabilitySubmissions.filter(s =>
        (isMh ? mhProviderName(s.provider_name) : !mhProviderName(s.provider_name)) &&
        mhSlMatches(null, s.provider_name),
      ),
    [availabilitySubmissions, isMh, mhSlMatches],
  );
  const scopedInboxSubs = useMemo(
    () =>
      inboxSubmissions.filter(s =>
        normalizeMonthStart(s.target_month) === selectedMonthStart &&
        (isMh ? mhProviderName(s.provider_name) : !mhProviderName(s.provider_name)) &&
        mhSlMatches(null, s.provider_name),
      ),
    [inboxSubmissions, selectedMonthStart, isMh, mhSlMatches],
  );
  const scopedUnmatched = useMemo(
    () =>
      unmatchedSubs.filter(s =>
        (isMh ? mhProviderName(s.provider_name) : !mhProviderName(s.provider_name)) &&
        mhSlMatches(null, s.provider_name),
      ),
    [unmatchedSubs, isMh, mhSlMatches],
  );
  const scopedTimeOff = useMemo(
    () =>
      timeOffRows.filter(t => {
        const mh = isMentalHealthProvider(t.row.profession, t.row.provider_name);
        return (isMh ? mh : !mh) && mhSlMatches(t.row.profession, t.row.provider_name);
      }),
    [timeOffRows, isMh, mhSlMatches],
  );
  const scopedInboxActionable = useMemo(() => {
    const groups = groupSubmissionsForInbox(scopedInboxSubs);
    return groups.filter(g => {
      if (g.latest.human_review_state === 'approved') return false;
      const d = diffParsedShifts(g.prior.parsed_shifts, g.latest.parsed_shifts, {
        targetMonth: selectedMonthStart,
      });
      return d.hasChanges;
    }).length;
  }, [scopedInboxSubs, selectedMonthStart]);
  const scopedSubmittedAvailabilityHours = useMemo(() => {
    const latest = new Map<string, AvailabilitySubmissionRow>();
    for (const row of scopedAvailabilitySubs) {
      if (row.decision_status === 'superseded') continue;
      const key = row.provider_id ?? row.provider_name;
      const c = latest.get(key);
      if (!c || row.submitted_at > c.submitted_at) latest.set(key, row);
    }
    let t = 0;
    for (const row of latest.values()) t += Number(expandedSubmittedHours(row) ?? 0);
    return t;
  }, [scopedAvailabilitySubs]);
  const scopedPendingAvailability = useMemo(
    () =>
      scopedAvailabilitySubs.filter(
        row => !row.decision_status || row.decision_status === 'pending',
      ),
    [scopedAvailabilitySubs],
  );
  const scopedPendingAvailabilityHours = useMemo(
    () =>
      scopedPendingAvailability.reduce(
        (sum, row) => sum + Number(expandedSubmittedHours(row) ?? 0),
        0,
      ),
    [scopedPendingAvailability],
  );
  const scopedNeedsReviewHours = useMemo(
    () =>
      scopedNeedsReview.reduce(
        (sum, row) => sum + Number(expandedSubmittedHours(row.submission) ?? 0),
        0,
      ),
    [scopedNeedsReview],
  );
  const readinessDeclinedRows = isMh ? scopedDeclined : allDeclinedRows;
  const readinessDeclinedHours = useMemo(
    () =>
      readinessDeclinedRows.reduce(
        (sum, row) => sum + Number(row.submission?.declined_hours ?? 0),
        0,
      ),
    [readinessDeclinedRows],
  );
  const scopedAuditEntries = useMemo(() => {
    if (!isMh) return auditEntries;
    const ids = new Set(mentalHealthRows.map(r => r.provider_id));
    return auditEntries.filter(e => e.provider_id && ids.has(e.provider_id));
  }, [auditEntries, isMh, mentalHealthRows]);

  const filteredScopedAccepted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = q
      ? scopedAccepted.filter(
          r =>
            r.provider_name.toLowerCase().includes(q) ||
            (r.profession ?? '').toLowerCase().includes(q),
        )
      : scopedAccepted;
    return [...base].sort((a, b) =>
      a.provider_name.localeCompare(b.provider_name, undefined, { sensitivity: 'base' }),
    );
  }, [scopedAccepted, filter]);

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

  const runScheduleRecalculation = (
    before = buildRecalculationSnapshot(scopedRows, scopedFlatAccepted, scopedCutRows),
    toastPrefix = `Recalculated ${formatMonthLabel(month)} schedule`,
  ) => {
    reevaluate.mutate(month, {
      onSuccess: result => {
        setLastRecalculation({
          result,
          before,
          ranAt: new Date().toISOString(),
        });
        const changed =
          Number(result.accepted ?? 0) +
          Number(result.partial ?? 0) +
            Number(result.declined ?? 0) +
          Number(result.needs_review ?? 0);
        toast.success(
          `${toastPrefix}${
            changed > 0 ? ` · ${changed} provider decision${changed === 1 ? '' : 's'}` : ''
          }`,
        );
        refetch();
        refetchShifts();
        refetchCuts();
      },
      onError: e => toast.error(`Schedule recalculation failed: ${(e as Error).message}`),
    });
  };

  const reevaluateNow = () => {
    runScheduleRecalculation();
  };

  const handleResolveNeedsReview = (args: ResolveArgs) => {
    const shouldRecalculateAfterApproval =
      Boolean(args.correction_summary) && args.decision === 'accepted';
    const beforeRecalculation = buildRecalculationSnapshot(
      scopedRows,
      scopedFlatAccepted,
      scopedCutRows,
    );
    resolveReview.mutate(args, {
      onSuccess: () => {
        if (shouldRecalculateAfterApproval) {
          toast.success(
            `Approved corrected hours for ${args.provider_name}. Recalculating ${formatMonthLabel(month)} now.`,
          );
          setReviewTab('recalculate');
          updateWorkbenchParams({ section: 'review', view: 'recalculate', replace: true });
          runScheduleRecalculation(
            beforeRecalculation,
            `Approved corrected hours and recalculated ${formatMonthLabel(month)}`,
          );
        } else {
          toast.success(
            args.decision === 'accepted'
              ? `Approved hours for ${args.provider_name}`
              : `Declined hours for ${args.provider_name}`,
          );
        }
        refetch();
        refetchShifts();
        refetchCuts();
      },
      onError: e => {
        toast.error(`Could not resolve: ${(e as Error).message}`);
        refetch();
        refetchShifts();
        refetchCuts();
      },
    });
  };

  return (
    <SchedulingShell>
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {isMh ? (
              <Brain className="h-6 w-6 text-emerald-600" />
            ) : (
              <Calendar className="h-6 w-6 text-emerald-600" />
            )}
            {formatMonthLabel(month)} Scheduling Workbench
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isMh
              ? `Mental health scope — coaches and therapists. Same intake → review → coverage plan → publish flow, filtered to MH providers.`
              : `One place to move ${formatMonthLabel(month)} from intake → review → coverage plan → publish. Every Homebase/EHR click is recorded with who and when.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={activeScope} onValueChange={(v) => onScopeChange(v as SchedulingWorkbenchScope)}>
            <SelectTrigger className="w-[168px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="medical">All scheduling</SelectItem>
              <SelectItem value="mental_health">Mental health</SelectItem>
            </SelectContent>
          </Select>
          {isMh && (
            <Select value={mhServiceLine} onValueChange={(v) => setMhServiceLine(v as 'all' | MentalHealthServiceLine)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All MH service lines</SelectItem>
                <SelectItem value="mh_coaching">{SERVICE_LINE_LABEL.mh_coaching}</SelectItem>
                <SelectItem value="therapy">{SERVICE_LINE_LABEL.therapy}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={month} onValueChange={onMonthChange}>
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
                Recalculate schedule
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Rebuilds the recommended {formatMonthLabel(month)} schedule from the latest Jotform submissions.
              Already-published shifts keep their Homebase / EHR state — only
              shifts that change or disappear lose their progress.
            </TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTopTab('exceptions');
              updateWorkbenchParams({ section: 'exceptions', replace: true });
            }}
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            Exceptions
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTopTab('data-sources');
              updateWorkbenchParams({ section: 'data-sources', replace: true });
            }}
          >
            <HelpCircle className="h-4 w-4 mr-1" />
            Data Sources
          </Button>
        </div>
      </div>

      <ProviderStatusSearchPanel
        month={month}
        rows={scopedRows}
        availabilityRows={scopedAvailabilitySubs}
        inboxSubmissions={scopedInboxSubs}
        timeOffRows={scopedTimeOff}
        shiftsByProvider={shiftsByProvider}
        cutRowsByProvider={cutRowsByProvider}
        initialProviderId={searchParams.get('providerId')}
        onProviderSelected={providerId =>
          updateWorkbenchParams({ providerId, replace: true })
        }
      />

      <Tabs value={topTab} onValueChange={onTopTabChange}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="readiness"><ShieldCheck className="h-3.5 w-3.5 mr-1" />Readiness</TabsTrigger>
          <TabsTrigger value="intake"><Inbox className="h-3.5 w-3.5 mr-1" />Intake</TabsTrigger>
          <TabsTrigger value="review">
            <AlertCircle className="h-3.5 w-3.5 mr-1" />Review
            {(scopedSummary.needsReviewCount + scopedInboxActionable + scopedPendingAvailability.length) > 0 && (
              <Badge className="ml-1 bg-orange-100 text-orange-800">
                {scopedSummary.needsReviewCount + scopedInboxActionable + scopedPendingAvailability.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="coverage-plan">
            <MapIcon className="h-3.5 w-3.5 mr-1" />Coverage Plan
            {(isMh ? scopedDeclined.length : allDeclinedRows.length) > 0 && (
              <Badge className="ml-1 bg-red-100 text-red-700">
                {isMh ? scopedDeclined.length : allDeclinedRows.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="publish"><Send className="h-3.5 w-3.5 mr-1" />Publish</TabsTrigger>
        </TabsList>

        {/* ============ READINESS ============ */}
        <TabsContent value="readiness" className="mt-4 space-y-4">
          <ReadinessPanel
            month={month}
            isLoading={isLoading || shiftsLoading}
            summary={scopedSummary}
            missingCount={scopedSummary.missingCount}
            submittedHours={scopedSubmittedAvailabilityHours}
            pendingSubmissionCount={scopedPendingAvailability.length}
            pendingSubmissionHours={scopedPendingAvailabilityHours}
            needsReviewHours={scopedNeedsReviewHours}
            declinedCount={readinessDeclinedRows.length}
            declinedHours={readinessDeclinedHours}
            inboxNeedsReviewCount={scopedInboxActionable}
            unmatchedCount={scopedUnmatched.length}
            onReevaluate={reevaluateNow}
            isReevaluating={reevaluate.isPending}
            onJumpToCoverage={() => jumpToCoveragePlan('coverage')}
            onJumpToAvailability={jumpToAvailability}
            onJumpToReview={jumpToReview}
            onJumpToPublish={jumpToPublish}
            onJumpToDeclined={() => jumpToCoveragePlan('declined')}
            onJumpToExceptions={() => {
              setTopTab('exceptions');
              updateWorkbenchParams({ section: 'exceptions', replace: true });
            }}
          />
          <SopCard />
          {!shiftsLoading && shiftRows.length === 0 && acceptedRows.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No per-shift recommendations have been generated for{' '}
                {formatMonthLabel(month)}. Click "Recalculate schedule" above to turn the latest
                Jotform submissions into individual shifts.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* ============ INTAKE ============ */}
        <TabsContent value="intake" className="mt-4 space-y-4">
          <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm">Intake source</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {override
                  ? `Using uploaded file: ${override.fileName} · ${override.totalShifts} shift${override.totalShifts === 1 ? '' : 's'} matched to ${override.matchedProviders} provider${override.matchedProviders === 1 ? '' : 's'}`
                  : `Showing ${shiftRows.length} system-built shift${shiftRows.length === 1 ? '' : 's'}. Upload a Jotform export only if you need to preview a not-yet-imported file.`}
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
            direct Jotform sync, then click "Recalculate schedule".
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={availabilityTab} onValueChange={(v) => {
        const next = v as AvailabilityTabKey;
        setAvailabilityTab(next);
        updateWorkbenchParams({ section: 'intake', view: next, replace: true });
      }}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="submissions">
            <Inbox className="h-3.5 w-3.5 mr-1" /> Submissions
            {scopedAvailabilitySubs.length > 0 && (
              <Badge className="ml-1 bg-emerald-100 text-emerald-800">
                {scopedAvailabilitySubs.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="inbox">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Resubmits
            {scopedInboxActionable > 0 && (
              <Badge className="ml-1 bg-blue-100 text-blue-800">
                {scopedInboxActionable}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="unmatched">
            <AlertCircle className="h-3.5 w-3.5 mr-1" /> Unmatched
            {scopedUnmatched.length > 0 && (
              <Badge className="ml-1 bg-amber-100 text-amber-800">
                {scopedUnmatched.length}
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
            {scopedSummary.missingCount > 0 && (
              <Badge className="ml-1 bg-slate-200 text-slate-700">
                {scopedSummary.missingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="timeoff">
            <CalendarOff className="h-3.5 w-3.5 mr-1" /> Time Off
            {scopedTimeOff.length > 0 && (
              <span className="ml-1 text-xs">({scopedTimeOff.length})</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="submissions" className="mt-4 space-y-4">
          <AvailabilitySubmissionsPanel
            month={month}
            rows={scopedAvailabilitySubs}
            isLoading={availabilityLoading}
            onResolve={handleResolveNeedsReview}
            isResolvePending={resolveReview.isPending}
          />
        </TabsContent>

        <TabsContent value="inbox" className="mt-4 space-y-4">
          <ResubmissionInboxPanel
            anchorMonth={month}
            submissions={scopedInboxSubs}
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
            rows={scopedMissing}
            outreachLogs={outreachLogs}
            isLoading={isLoading}
            isMarkingSent={markOutreachSent.isPending}
            onMarkSent={(providers, subject, body) =>
              markOutreachSent.mutate(
                { month, providers, subject, body },
                {
                  onSuccess: () => {
                    toast.success(
                      `Marked ${providers.length} provider${providers.length === 1 ? '' : 's'} contacted`,
                    );
                  },
                  onError: e => toast.error(`Could not mark sent: ${(e as Error).message}`),
                },
              )
            }
          />
        </TabsContent>

        <TabsContent value="timeoff" className="mt-4 space-y-4">
          <TimeOffPanel
            month={month}
            entries={scopedTimeOff}
            isLoading={isLoading}
          />
        </TabsContent>
      </Tabs>
        </TabsContent>

        {/* ============ REVIEW ============ */}
        <TabsContent value="review" className="mt-4 space-y-4">
          <Tabs value={reviewTab} onValueChange={(v) => {
            const next = v as ReviewTabKey;
            setReviewTab(next);
            updateWorkbenchParams({ section: 'review', view: next, replace: true });
          }}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="decisions">
                Needs decision
                {scopedSummary.needsReviewCount > 0 && (
                  <Badge className="ml-1 bg-orange-100 text-orange-800">
                    {scopedSummary.needsReviewCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="resubmits">
                Resubmits
                {scopedInboxActionable > 0 && (
                  <Badge className="ml-1 bg-blue-100 text-blue-800">
                    {scopedInboxActionable}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="recalculate">
                Pending recalculation
                {scopedPendingAvailability.length > 0 && (
                  <Badge className="ml-1 bg-slate-200 text-slate-700">
                    {scopedPendingAvailability.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="decisions" className="mt-4 space-y-4">
              <NeedsReviewPanel
                month={month}
                rows={scopedNeedsReview}
                isLoading={isLoading}
                onResolve={handleResolveNeedsReview}
                isPending={resolveReview.isPending}
              />
            </TabsContent>

            <TabsContent value="resubmits" className="mt-4 space-y-4">
              <ResubmissionInboxPanel
                anchorMonth={month}
                submissions={scopedInboxSubs}
                isLoading={inboxLoading}
              />
            </TabsContent>

            <TabsContent value="recalculate" className="mt-4 space-y-4">
              <PendingRecalculationPanel
                month={month}
                rows={scopedPendingAvailability}
                decisionRows={scopedRows}
                publishRows={scopedFlatAccepted}
                cutRows={scopedCutRows}
                readinessDeclinedHours={readinessDeclinedHours}
                lastRun={lastRecalculation}
                isLoading={availabilityLoading}
                isReevaluating={reevaluate.isPending}
                onReevaluate={reevaluateNow}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ============ COVERAGE PLAN ============ */}
        <TabsContent value="coverage-plan" className="mt-4 space-y-4">
          <Tabs value={coveragePlanTab} onValueChange={(v) => {
            const next = v as CoveragePlanTabKey;
            setCoveragePlanTab(next);
            updateWorkbenchParams({ section: 'coverage-plan', view: next, replace: true });
          }}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="coverage"><MapIcon className="h-3.5 w-3.5 mr-1" />Coverage Gaps</TabsTrigger>
              <TabsTrigger value="matching"><Users className="h-3.5 w-3.5 mr-1" />Matching</TabsTrigger>
              <TabsTrigger value="declined">
                <CalendarX className="h-3.5 w-3.5 mr-1" />Cut / declined hours
                {(isMh ? scopedDeclined.length : allDeclinedRows.length) > 0 && (
                  <Badge className="ml-1 bg-red-100 text-red-700">
                    {isMh ? scopedDeclined.length : allDeclinedRows.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="cost"><DollarSign className="h-3.5 w-3.5 mr-1" />Cost / Visit</TabsTrigger>
              <TabsTrigger value="forecast"><TrendingUp className="h-3.5 w-3.5 mr-1" />Forecast</TabsTrigger>
            </TabsList>

            <TabsContent value="coverage" className="mt-4 space-y-4">
              <CoverageGapsPanel month={month} acceptedRows={scopedAccepted} missingRows={scopedMissing} />
            </TabsContent>

            <TabsContent value="matching" className="mt-4 space-y-4">
              <MatchingPanel
                month={month}
                acceptedRows={scopedAccepted}
                declinedRows={scopedDeclined}
                needsReviewRows={scopedNeedsReview}
                shiftsByProvider={shiftsByProvider}
                eligibilityByProvider={eligibilityByProvider}
              />
            </TabsContent>

            <TabsContent value="declined" className="mt-4 space-y-4">
              <DeclinedHoursPanel
                month={month}
                declinedRows={isMh ? scopedDeclined : allDeclinedRows}
                cutRowsByProvider={cutRowsByProvider}
                eligibilityByProvider={eligibilityByProvider}
                isLoading={isLoading || cutsLoading}
              />
            </TabsContent>

            <TabsContent value="cost" className="mt-4 space-y-4">
              <CostPerVisitPanel
                month={month}
                rows={scopedRows}
                payRates={providerPayRates}
                isLoading={isLoading || providerPayRatesLoading}
              />
            </TabsContent>

            <TabsContent value="forecast" className="mt-4 space-y-4">
              <ForecastPanel month={month} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ============ PUBLISH ============ */}
        <TabsContent value="publish" className="mt-4 space-y-4">
          <PublishGateBanner
            month={month}
            summary={scopedSummary}
            submittedHours={scopedSubmittedAvailabilityHours}
            inboxNeedsReviewCount={scopedInboxActionable}
            unmatchedCount={scopedUnmatched.length}
            missingCount={scopedSummary.missingCount}
            onJumpToAvailability={jumpToAvailability}
            onJumpToReview={jumpToReview}
            onJumpToCoverage={() => jumpToCoveragePlan('coverage')}
          />
          <PublishInstructionsCard />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Shifts to publish"
              value={scopedSummary.totalShifts.toString()}
              sub={`${scopedSummary.totalProviders} provider${scopedSummary.totalProviders === 1 ? '' : 's'}`}
            />
            <SummaryCard
              label="Posted to Homebase"
              value={`${scopedSummary.totalShifts ? Math.round((scopedSummary.homebaseShifts / scopedSummary.totalShifts) * 100) : 0}%`}
              sub={`${scopedSummary.homebaseShifts} of ${scopedSummary.totalShifts} shifts`}
            />
            <SummaryCard
              label="Posted to EHR"
              value={`${scopedSummary.totalShifts ? Math.round((scopedSummary.ehrShifts / scopedSummary.totalShifts) * 100) : 0}%`}
              sub={`${scopedSummary.ehrShifts} of ${scopedSummary.totalShifts} shifts`}
            />
            <SummaryCard label="Declined" value={scopedSummary.declinedCount.toString()} />
          </div>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Do not publish unless Readiness says it is OK to publish, or a ClinOps lead explicitly tells you to continue.
              Hover any checked box to see who marked it and when.
            </AlertDescription>
          </Alert>

          <Tabs value={publishTab} onValueChange={(v) => setPublishTab(v as PublishTabKey)}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="provider">By Provider</TabsTrigger>
              <TabsTrigger value="queue">
                Publishing Queue
                {scopedSummary.totalShifts > 0 && (
                  <span className="ml-1 text-xs">
                    ({scopedSummary.homebaseShifts}/{scopedSummary.totalShifts})
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="day">By Day</TabsTrigger>
              <TabsTrigger value="history">
                <History className="h-3.5 w-3.5 mr-1" /> History
                {scopedAuditEntries.length > 0 && (
                  <span className="ml-1 text-xs">({scopedAuditEntries.length})</span>
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
                    {filteredScopedAccepted.map(row => {
                      const sub = row.submission!;
                      const flats = shiftsByProvider.get(row.provider_id) ?? [];
                      const hbDone = flats.filter(isHomebaseDone).length;
                      const ehrDone = flats.filter(isEhrDone).length;
                      const isOpen = !!expanded[row.provider_id];
                      const totalShifts = flats.length;
                      const ehrBulkBlocked = totalShifts > 0 && ehrDone === 0 && hbDone < totalShifts;
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
                              <ShiftProgress done={hbDone} total={totalShifts} tone="homebase" />
                            </TableCell>
                            <TableCell onClick={e => e.stopPropagation()}>
                              <ShiftProgress done={ehrDone} total={totalShifts} tone="ehr" />
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
                                    disabled={ehrBulkBlocked}
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
                              {ehrBulkBlocked && (
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                  Finish Homebase first. EHR can only be marked after Homebase is complete.
                                </div>
                              )}
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
                                    Click "Recalculate schedule" above to generate the shift list.
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
                    {filteredScopedAccepted.length === 0 && (
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
            shifts={scopedFlatAccepted}
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
            shifts={scopedFlatAccepted}
            isLoading={shiftsLoading}
            onToggleShift={handleToggleShift}
            auditByShift={auditByShift}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          <PublishHistoryPanel month={month} entries={scopedAuditEntries} />
        </TabsContent>
          </Tabs>
        </TabsContent>

        {/* ============ EXCEPTIONS ============ */}
        <TabsContent value="exceptions" className="mt-4 space-y-4">
          <SchedulingExceptionsPanel month={month} />
        </TabsContent>

        {/* ============ AUDIT / WHY ============ */}
        <TabsContent value="data-sources" className="mt-4 space-y-4">
          <AuditPanel
            month={month}
            acceptedRows={scopedAccepted}
            declinedRows={scopedDeclined}
            needsReviewRows={scopedNeedsReview}
            availabilityRows={scopedAvailabilitySubs}
            unmatchedRows={scopedUnmatched}
            missingRows={scopedMissing}
            shifts={isMh ? scopedFlatAccepted : shiftRows}
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
          <SopStep day="Tue" label="Chase missing + clear Needs Decision" />
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

function ShiftProgress({
  done,
  total,
  tone = 'homebase',
}: {
  done: number;
  total: number;
  tone?: 'homebase' | 'ehr';
}) {
  if (total === 0) {
    return <div className="text-xs text-muted-foreground">—</div>;
  }
  const pct = Math.round((done / total) * 100);
  const complete = done === total;
  const started = done > 0;
  const progressClass =
    tone === 'homebase'
      ? complete
        ? 'bg-emerald-100 [&>div]:bg-emerald-600'
        : started
          ? 'bg-amber-100 [&>div]:bg-amber-500'
          : 'bg-emerald-50 [&>div]:bg-emerald-300'
      : complete
        ? 'bg-blue-100 [&>div]:bg-blue-600'
        : started
          ? 'bg-sky-100 [&>div]:bg-sky-500'
          : 'bg-slate-100 [&>div]:bg-slate-300';
  return (
    <div className="flex items-center gap-2">
      <Progress value={pct} className={cn('h-2 flex-1', progressClass)} />
      <span
        className={cn(
          'text-xs tabular-nums w-12 text-right',
          complete
            ? tone === 'homebase' ? 'text-emerald-700' : 'text-blue-700'
            : started
              ? 'text-amber-700'
              : 'text-muted-foreground',
        )}
      >
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
  const colorClass = checked
    ? step === 'homebase'
      ? 'border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white'
      : 'border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white'
    : disabled
      ? 'border-slate-300 bg-slate-50'
      : step === 'homebase'
        ? 'border-emerald-500 bg-emerald-50'
        : 'border-blue-300 bg-blue-50';
  const box = (
    <Checkbox
      checked={checked}
      disabled={disabled}
      className={cn('h-5 w-5 rounded-md', colorClass)}
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
          const schedulingNote = formatSchedulingShiftNote(s.recommendation_reason);
          return (
            <TableRow key={s.id}>
              <TableCell className="text-xs">{formatProviderShiftDate(s)}</TableCell>
              <TableCell className="text-xs tabular-nums">
                {formatProviderShiftTime(s)}
              </TableCell>
              <TableCell className="text-xs text-right tabular-nums">
                {formatHours(s.hours)}
              </TableCell>
              <TableCell className="text-xs">
                <div>{labelShiftType(s.shift_type)}</div>
                {schedulingNote && (
                  <div className="mt-1 max-w-[260px] text-[11px] leading-snug text-muted-foreground">
                    {schedulingNote}
                  </div>
                )}
              </TableCell>
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
                {!hbDone && (
                  <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                    Finish Homebase first
                  </div>
                )}
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

function ProviderStatusSearchPanel({
  month,
  rows,
  availabilityRows,
  inboxSubmissions,
  timeOffRows,
  shiftsByProvider,
  cutRowsByProvider,
  initialProviderId,
  onProviderSelected,
}: {
  month: string;
  rows: ProviderPublishView[];
  availabilityRows: AvailabilitySubmissionRow[];
  inboxSubmissions: SubmissionForInbox[];
  timeOffRows: ProviderTimeOffEntry[];
  shiftsByProvider: Map<string, ShiftRow[]>;
  cutRowsByProvider: Map<string, ShiftRow[]>;
  initialProviderId: string | null;
  onProviderSelected: (providerId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(initialProviderId);

  useEffect(() => {
    setSelectedProviderId(initialProviderId);
  }, [initialProviderId]);

  const normalizedQuery = query.trim().toLowerCase();
  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) =>
        a.provider_name.localeCompare(b.provider_name, undefined, { sensitivity: 'base' }),
      ),
    [rows],
  );
  const matches = useMemo(() => {
    if (normalizedQuery.length < 2) return [];
    return sortedRows
      .filter(row => {
        const haystack = [
          row.provider_name,
          row.provider_email,
          row.profession,
          row.employment_type,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 6);
  }, [normalizedQuery, sortedRows]);

  const selectedRow =
    (selectedProviderId
      ? sortedRows.find(row => row.provider_id === selectedProviderId)
      : null) ??
    (matches.length === 1 ? matches[0] : null);

  const latestAvailability = useMemo(() => {
    if (!selectedRow) return null;
    return availabilityRows
      .filter(row =>
        (row.provider_id && row.provider_id === selectedRow.provider_id) ||
        row.provider_name.toLowerCase() === selectedRow.provider_name.toLowerCase(),
      )
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0] ?? null;
  }, [availabilityRows, selectedRow]);

  const resubmitStatus = useMemo(() => {
    if (!selectedRow) return 'No resubmit pending';
    const targetMonth = normalizeMonthStart(month);
    const groups = groupSubmissionsForInbox(
      inboxSubmissions.filter(s => normalizeMonthStart(s.target_month) === targetMonth),
    );
    const group = groups.find(g =>
      (g.provider_id && g.provider_id === selectedRow.provider_id) ||
      g.provider_name.toLowerCase() === selectedRow.provider_name.toLowerCase(),
    );
    if (!group) return 'No resubmit pending';
    const diff = diffParsedShifts(group.prior.parsed_shifts, group.latest.parsed_shifts, {
      targetMonth,
    });
    if (group.latest.human_review_state === 'approved') return 'Approved resubmit';
    if (group.latest.human_review_state === 'parked') return 'Parked resubmit';
    return diff.hasChanges ? 'Needs resubmit review' : 'Resubmit has no schedule change';
  }, [inboxSubmissions, month, selectedRow]);

  const timeOff = selectedRow
    ? timeOffRows.find(entry => entry.row.provider_id === selectedRow.provider_id)
    : null;
  const shifts = selectedRow ? shiftsByProvider.get(selectedRow.provider_id) ?? [] : [];
  const cutShifts = selectedRow ? cutRowsByProvider.get(selectedRow.provider_id) ?? [] : [];
  const submittedHours =
    expandedSubmittedHours(latestAvailability) ??
    expandedSubmittedHours(selectedRow?.submission) ??
    null;
  const acceptedHours = selectedRow?.submission?.accepted_hours ?? null;
  const declinedHours = Number(selectedRow?.submission?.declined_hours ?? 0);
  const cutShiftHours = cutShifts.reduce((sum, shift) => sum + Number(shift.hours ?? 0), 0);
  const homebaseDone = shifts.length
    ? shifts.filter(isHomebaseDone).length
    : selectedRow?.publish?.homebase_posted_at
      ? 1
      : 0;
  const ehrDone = shifts.length
    ? shifts.filter(isEhrDone).length
    : selectedRow?.publish?.ehr_posted_at
      ? 1
      : 0;
  const homebaseTotal = shifts.length || (selectedRow?.publish ? 1 : 0);
  const ehrTotal = shifts.length || (selectedRow?.publish ? 1 : 0);
  const reviewLabel =
    selectedRow?.submission?.decision_status === 'needs_review'
      ? 'Needs decision'
      : selectedRow?.submission?.decision_status
        ? STATUS_STYLE[selectedRow.submission.decision_status as DecisionStatus]?.label ?? selectedRow.submission.decision_status
        : 'No submission';
  const selectedCorrectionSummary =
    manualTimeCorrectionSummary(selectedRow?.submission?.parsed_shifts) ??
    manualTimeCorrectionSummary(latestAvailability?.parsed_shifts);
  const selectedHasTimeCorrection = Boolean(selectedCorrectionSummary) ||
    hasManualTimeCorrection(selectedRow?.submission?.parsed_shifts) ||
    hasManualTimeCorrection(latestAvailability?.parsed_shifts);

  const handleSelect = (providerId: string) => {
    setSelectedProviderId(providerId);
    onProviderSelected(providerId);
  };

  return (
    <Card>
      <CardContent className="py-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.45fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label htmlFor="scheduling-provider-search">Check a provider</Label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="scheduling-provider-search"
                placeholder="Search provider"
                value={query}
                onChange={event => {
                  setQuery(event.target.value);
                  setSelectedProviderId(null);
                }}
                className="pl-9"
              />
            </div>
            {normalizedQuery.length >= 2 && matches.length > 1 && (
              <div className="max-h-40 overflow-y-auto rounded-md border bg-background">
                {matches.map(row => (
                  <button
                    key={row.provider_id}
                    type="button"
                    className="flex w-full items-start justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                    onClick={() => handleSelect(row.provider_id)}
                  >
                    <span>
                      <span className="block font-medium">{row.provider_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.provider_email ?? 'No email'} · {row.profession ?? '—'}
                      </span>
                    </span>
                    <StatusBadge status={row.submission?.decision_status as DecisionStatus | null | undefined} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedRow ? (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-sm font-semibold">{selectedRow.provider_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedRow.provider_email ?? 'No email'} · {selectedRow.profession ?? '—'} · {formatMonthLabel(month)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 md:justify-end">
                  {selectedHasTimeCorrection && (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Times updated
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-white">
                    {reviewLabel}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                <ProviderStatusMetric label="Submitted" value={formatHours(submittedHours)} />
                <ProviderStatusMetric label="Accepted" value={formatHours(acceptedHours)} />
                <ProviderStatusMetric
                  label="Review"
                  value={selectedHasTimeCorrection ? 'Updated times' : reviewLabel}
                />
                <ProviderStatusMetric label="Resubmit" value={resubmitStatus} />
                <ProviderStatusMetric
                  label="Time off"
                  value={timeOff ? `${timeOff.totalDays} day${timeOff.totalDays === 1 ? '' : 's'}` : 'None listed'}
                />
                <ProviderStatusMetric
                  label="Cut hours"
                  value={`${Math.max(declinedHours, cutShiftHours).toFixed(1)}`}
                />
                <ProviderStatusMetric
                  label="Homebase"
                  value={homebaseTotal ? `${homebaseDone}/${homebaseTotal}` : 'No shifts'}
                />
                <ProviderStatusMetric
                  label="EHR"
                  value={ehrTotal ? `${ehrDone}/${ehrTotal}` : 'No shifts'}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-24 items-center rounded-md border border-dashed px-4 text-sm text-muted-foreground">
              Search by provider name, email, or profession to see scheduling status.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderStatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-white px-2 py-2">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 min-h-8 text-sm font-semibold leading-tight">{value}</div>
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

const manualCorrectionFromParsedShifts = (raw: unknown): Record<string, unknown> | null => {
  const correction = asParsedBlob(raw).clinops_manual_correction;
  return correction && typeof correction === 'object' && !Array.isArray(correction)
    ? (correction as Record<string, unknown>)
    : null;
};

const hasManualTimeCorrection = (raw: unknown): boolean =>
  Boolean(manualCorrectionFromParsedShifts(raw));

const manualTimeCorrectionSummary = (raw: unknown): string | null => {
  const summary = manualCorrectionFromParsedShifts(raw)?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
};

const compactJson = (raw: unknown) => {
  try {
    return JSON.stringify(raw ?? null, null, 2);
  } catch {
    return String(raw);
  }
};

const valueFromDecisionNote = (notes: string | null | undefined, key: string): string | null => {
  const match = (notes ?? '').match(new RegExp(`${key}=([^;\\n]+)`));
  return match?.[1]?.trim() || null;
};

function formatDecisionNoteForStaff(notes: string | null | undefined): string {
  const raw = (notes ?? '').trim();
  if (!raw) return '';

  const lines: string[] = [];
  const add = (line: string) => {
    if (!lines.includes(line)) lines.push(line);
  };

  const priority = valueFromDecisionNote(raw, 'provider_priority');
  const providerRatePolicy = valueFromDecisionNote(raw, 'provider_rate_policy');
  const providerHourlyRate = valueFromDecisionNote(raw, 'provider_hourly_rate');
  const providerUtilizationPolicy = valueFromDecisionNote(raw, 'provider_utilization_policy');
  const providerUtilizationPct = valueFromDecisionNote(raw, 'provider_utilization_pct');
  const cohort = valueFromDecisionNote(raw, 'cohort');
  const directshiftsTargetShare = valueFromDecisionNote(raw, 'directshifts_target_share');
  const directshiftsActualShare = valueFromDecisionNote(raw, 'directshifts_actual_share');
  const providerAcceptancePct = valueFromDecisionNote(raw, 'provider_acceptance_pct');
  const equityFloor = valueFromDecisionNote(raw, 'equity_floor');
  const softCapPolicy = valueFromDecisionNote(raw, 'soft_cap_policy');
  const softCapExceeded = valueFromDecisionNote(raw, 'soft_cap_exceeded');
  if (priority === 'clinical_supervisor' || priority === 'clinical_lead') {
    add('Accepted in full because this provider is a clinical lead.');
  } else if (priority === 'vitable_internal') {
    add('This provider is in the rate-ranked scheduling pool.');
  } else if (priority === 'directshifts_brittany_priority') {
    add('Brittney Afram keeps the DirectShifts compatibility key; hourly rate still decides before that tie-break.');
  } else if (priority === 'access_provider') {
    add('This access provider is in the same rate-ranked pool as internal providers.');
  }
  if (providerRatePolicy === 'clinical_leads_then_hourly_rate_then_directshifts_share') {
    add('Order of operations: accept validated clinical lead hours in full first, then current hourly rate, then the DirectShifts/access share target.');
  } else if (providerRatePolicy === 'clinical_leads_then_lowest_hourly_rate') {
    add('After clinical leads, providers are ranked by lowest current hourly rate regardless of internal or DirectShifts source.');
  }
  if (providerHourlyRate && providerHourlyRate !== 'missing') {
    const rate = Number(providerHourlyRate);
    if (Number.isFinite(rate)) add(`Current scheduling rate used: $${rate.toFixed(2)}/hr.`);
  } else if (providerHourlyRate === 'missing') {
    add('No current hourly rate was found, so this provider sorts after providers with known rates in the same tier.');
  }
  if (providerUtilizationPolicy === 'lower_utilization_secondary_after_rate') {
    add('For providers with the same rate tier, lower recent utilization is used as the fairness tie-break.');
  } else if (providerUtilizationPolicy === 'not_used_for_scheduling') {
    add('Recent utilization was measured for visibility only and was not used to rank this schedule.');
  }
  if (providerUtilizationPct && providerUtilizationPct !== 'missing') {
    const utilization = Number(providerUtilizationPct);
    if (Number.isFinite(utilization)) add(`Recent utilization measured: ${utilization.toFixed(1)}%.`);
  } else if (providerUtilizationPct === 'missing') {
    add('No recent utilization was found.');
  }
  if (cohort === 'directshifts_access') {
    add('This provider counts toward the DirectShifts/access scheduling share.');
  }
  if (directshiftsTargetShare) {
    add(`DirectShifts/access target: ${directshiftsTargetShare}% of accepted telehealth hours.`);
  }
  if (directshiftsActualShare) {
    add(`DirectShifts/access result after allocation: ${directshiftsActualShare}%.`);
  }
  if (providerAcceptancePct) {
    add(`This provider received ${providerAcceptancePct}% of forecastable submitted hours.`);
  }
  if (equityFloor === 'met') {
    add('Equity floor met: this eligible submitter received publishable time before additional low-rate optimization.');
  } else if (equityFloor === 'unmet_no_gap') {
    add('Equity floor unmet because no compatible state demand remained.');
  } else if (equityFloor === 'unmet_no_valid_shift') {
    add('Equity floor unmet because no valid publishable shift block remained after policy checks.');
  }
  if (softCapPolicy) {
    const readableSoftCap = softCapPolicy.replace('pct', '%').replace(/_/g, ' ');
    add(`Soft cap policy applied: ${readableSoftCap} before additional hours.`);
  }
  if (softCapExceeded === '1') {
    add('Soft cap was relaxed because demand would otherwise remain uncovered.');
  }
  if (valueFromDecisionNote(raw, 'clinical_lead_full_accept') === '1') {
    add('Validated clinical lead hours were accepted in full and were not trimmed by demand, rate, DirectShifts share, or soft-cap policy.');
  }

  if (valueFromDecisionNote(raw, 'state_policy') === 'physician_reserved_for_md_only') {
    add('Physician capacity is reserved for states where only MD/DO providers can cover visits.');
  }
  if (valueFromDecisionNote(raw, 'scarce_window_policy') === 'protected_before_monthly_trim') {
    add('This shift was protected because it helps Friday afternoon or weekend access.');
  }
  const scarceHours = valueFromDecisionNote(raw, 'scarce_window_hours');
  if (scarceHours) {
    add(`${scarceHours.replace(/h$/, '')} hours were protected for Friday afternoon or weekend access.`);
  }
  if (valueFromDecisionNote(raw, 'access_growth_buffer_policy')) {
    add('Monthly targets include an access buffer; non-protected surplus blocks are split or cut before publish.');
  }
  if (valueFromDecisionNote(raw, 'long_shift_break_policy')) {
    const breakStart = valueFromDecisionNote(raw, 'break_start');
    const breakEnd = valueFromDecisionNote(raw, 'break_end');
    const originalHours = valueFromDecisionNote(raw, 'original_shift_hours');
    const scheduledHours = valueFromDecisionNote(raw, 'scheduled_hours_after_break');
    if (breakStart && breakEnd) {
      add(`A required 1-hour break was added from ${breakStart}-${breakEnd} ET. Publish only the split work blocks.`);
    } else {
      add('A required 1-hour break was added to prevent a continuous 12-hour shift.');
    }
    if (originalHours && scheduledHours) {
      add(`The provider submitted ${originalHours} hours; ${scheduledHours} hours are schedulable after the break.`);
    }
  }
  if (valueFromDecisionNote(raw, 'provider_meeting_blackout')) {
    const blackoutHours = valueFromDecisionNote(raw, 'provider_meeting_blackout_hours');
    add(`The June 24 provider meeting from 12:00-1:00 PM ET was blocked from scheduling${blackoutHours ? ` (${blackoutHours} hour removed)` : ''}.`);
  }
  if (valueFromDecisionNote(raw, 'mh_ehr_slot_gap_minutes') === '0') {
    add('Mental health EHR slots should stay back-to-back; the 10-minute buffer is for capacity/charting, not a patient-facing gap.');
  }
  const accessBufferHours = valueFromDecisionNote(raw, 'access_buffer_hours');
  if (accessBufferHours) {
    add(`${accessBufferHours.replace(/h$/, '')} buffer hours were added to protect monthly access.`);
  }
  const baseStateDemand = valueFromDecisionNote(raw, 'base_state_demand');
  if (baseStateDemand) {
    add(`Historical state need before extra monthly access protection: ${baseStateDemand}.`);
  }
  const unavailableHours = valueFromDecisionNote(raw, 'hours_removed_unavailable');
  if (unavailableHours) {
    add(`${unavailableHours.replace(/h$/, '')} hours were intentionally removed because the provider listed those dates as unavailable.`);
  }
  const unavailableOverrideRanges = valueFromDecisionNote(raw, 'unavailable_override_ranges');
  if (unavailableOverrideRanges) {
    const unavailableOverrideReason = valueFromDecisionNote(raw, 'unavailable_override_reason');
    add(`Confirmed availability override: ignored unavailable range ${unavailableOverrideRanges} so the provider's stated availability could be considered${unavailableOverrideReason ? ` (${unavailableOverrideReason})` : ''}.`);
  }
  const allocations = valueFromDecisionNote(raw, 'alloc');
  if (allocations) {
    add(`Accepted hours were assigned by state: ${allocations}.`);
  }
  const stateGaps = valueFromDecisionNote(raw, 'state_gaps');
  if (stateGaps) {
    add(`States still under-covered during scheduling: ${stateGaps}.`);
  }

  const lower = raw.toLowerCase();
  if (lower.includes('outside') && lower.includes('business')) {
    add('Some hours were cut because they were outside approved scheduling hours.');
  }
  if (lower.includes('trimmed') || lower.includes('oversupply') || lower.includes('surplus')) {
    add('Some hours were cut because the assigned state already had enough accepted hours.');
  }
  if (lower.includes('unavailable')) {
    add('Unavailable dates listed in Jotform are intentionally excluded from generated shifts.');
  }
  if (lower.includes('no state allocation')) {
    add('The system could not safely assign this shift to a state; escalate if this affects publishing.');
  }
  if (lower.includes('license') || lower.includes('licensure')) {
    add('A license or state-coverage issue affected this decision.');
  }
  if (lower.includes('malformed') || lower.includes('invalid') || lower.includes('parse')) {
    add('Provider time looks invalid or could not be read safely.');
  }
  if (lower.includes('unrealistic') || lower.includes('too many')) {
    add('Provider submitted unusually high hours.');
  }

  return lines.length > 0 ? lines.join('\n') : raw;
}

type ReasonTag = {
  label: string;
  tone?: 'amber' | 'blue' | 'red' | 'slate' | 'emerald';
};

const REASON_TAG_STYLES: Record<NonNullable<ReasonTag['tone']>, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  red: 'border-red-200 bg-red-50 text-red-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

const reasonTagsForText = (raw: string | null | undefined): ReasonTag[] => {
  const text = (raw ?? '').toLowerCase();
  const tags: ReasonTag[] = [];
  const add = (label: string, tone: ReasonTag['tone'] = 'slate') => {
    if (!tags.some(tag => tag.label === label)) tags.push({ label, tone });
  };

  if (!text.trim()) return [];
  if (/end time.*before start|end time is at or before start|overnight/.test(text)) {
    add('End before start', 'red');
  }
  if (/single shift duration|exceeds max_single_shift|over 12h|over 12/.test(text)) {
    add('Shift too long', 'red');
  }
  if (/malformed|unparseable|parse|invalid time|could not be read/.test(text)) {
    add('Malformed time', 'red');
  }
  if (/unrealistic|too many|high hours/.test(text)) {
    add('High hours', 'amber');
  }
  if (/trimmed|oversupply|surplus|accepted hours capped|network demand|state already had enough/.test(text)) {
    add('Oversupply cut', 'amber');
  }
  if (/outside.*business|outside approved scheduling|operating hours|out-of-hours/.test(text)) {
    add('Outside hours', 'amber');
  }
  if (/unavailable|off-day|off day/.test(text)) {
    add('Unavailable date', 'amber');
  }
  if (/unavailable_override|confirmed availability override|clinops_manual_correction|clinops corrected|correction=|availability corrected|corrected availability/.test(text)) {
    add('Availability correction', 'emerald');
  }
  if (/license|licensure|state-coverage|eligib|no state allocation/.test(text)) {
    add('License/state issue', 'red');
  }
  if (/physician_reserved|md\/do|md-only|physician capacity/.test(text)) {
    add('MD-only reserve', 'blue');
  }
  if (/clinical lead|clinical supervisor/.test(text)) {
    add('Clinical lead priority', 'emerald');
  }
  if (/rate-ranked|lowest current hourly rate|provider_rate_policy|current scheduling rate|same rate tier|rate tier|directshifts/.test(text)) {
    add('Rate ranking', 'blue');
  }
  if (/cohort=directshifts_access|directshifts_target_share|provider_acceptance_pct|equity_floor|soft_cap_policy/.test(text)) {
    add('Equity policy', 'blue');
  }
  if (/lower_utilization_secondary_after_rate|fairness tie-break/.test(text)) {
    add('Utilization tiebreak', 'blue');
  }
  if (/scarce_window|friday afternoon|weekend access|protected/.test(text)) {
    add('Protected access', 'emerald');
  }
  if (/access_growth_buffer|access buffer|buffer hours|monthly targets/.test(text)) {
    add('Access buffer', 'emerald');
  }
  if (/alloc=|assigned by state|state allocation/.test(text)) {
    add('State allocation', 'blue');
  }
  if (/state_gaps|still under-covered|under-covered/.test(text)) {
    add('Remaining gaps', 'amber');
  }
  if (/base_state_demand|historical state need/.test(text)) {
    add('Historical demand', 'slate');
  }
  if (/provider_meeting_blackout|provider meeting/.test(text)) {
    add('Meeting blackout', 'slate');
  }
  if (/long_shift_break|required 1-hour break|mandatory 1-hour break/.test(text)) {
    add('Required break', 'slate');
  }

  return tags.length > 0 ? tags : [{ label: 'Needs review', tone: 'slate' }];
};

function ReasonSummary({
  text,
  detailsText,
  maxTags = 4,
}: {
  text: string | null | undefined;
  detailsText?: string | null;
  maxTags?: number;
}) {
  const raw = (text ?? '').trim();
  const details = (detailsText ?? raw).trim();
  const tags = reasonTagsForText(raw);
  const visibleTags = tags.slice(0, maxTags);
  if (!raw && !details) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {visibleTags.map(tag => (
          <Badge
            key={tag.label}
            variant="outline"
            className={cn('text-[11px] font-medium', REASON_TAG_STYLES[tag.tone ?? 'slate'])}
          >
            {tag.label}
          </Badge>
        ))}
        {tags.length > visibleTags.length && (
          <Badge variant="outline" className="text-[11px] font-medium">
            +{tags.length - visibleTags.length}
          </Badge>
        )}
      </div>
      {details && (
        <details>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Details
          </summary>
          <div className="mt-1 whitespace-pre-wrap rounded bg-muted/60 p-2 text-[11px] leading-snug text-muted-foreground">
            {details}
          </div>
        </details>
      )}
    </div>
  );
}

function needsReviewReasonLabel(warnings: string[], notes: string | null | undefined): string {
  const text = [...warnings, notes ?? ''].join(' ').toLowerCase();
  if (text.includes('state') || text.includes('license') || text.includes('eligib')) {
    return 'Provider may not be eligible for assigned state';
  }
  if (text.includes('unrealistic') || text.includes('too many') || text.includes('high hours')) {
    return 'Provider submitted unusually high hours';
  }
  if (text.includes('invalid') || text.includes('malformed') || text.includes('parse') || text.includes('pm') || text.includes('am')) {
    return 'Provider time looks invalid';
  }
  return 'System could not safely decide';
}

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
  onResolve,
  isResolvePending,
}: {
  month: string;
  rows: AvailabilitySubmissionRow[];
  isLoading: boolean;
  onResolve: (args: ResolveArgs) => void;
  isResolvePending: boolean;
}) {
  const [resolutionTarget, setResolutionTarget] = useState<SubmissionResolutionTarget | null>(null);

  const openResolutionDialog = (
    row: AvailabilitySubmissionRow,
    decision: 'accepted' | 'declined',
    reasonLabel: string,
    startWithCorrection = false,
  ) => {
    setResolutionTarget({
      submission: row,
      providerName: row.provider_name,
      decision,
      reasonLabel,
      startWithCorrection,
    });
  };

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
          No Jotform/drop-form availability submissions are stored for {formatMonthLabel(month)}.
          If submissions were expected, check Data Sources, then Data quality, and confirm the direct Jotform sync.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
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
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const parsed = asParsedBlob(row.parsed_shifts);
                const shiftTypes = Array.isArray(parsed.shift_types)
                  ? (parsed.shift_types as unknown[]).map(String).join(', ')
                  : String(parsed.shift_types ?? '—');
                const warnings = warningStringsFromUnknown(row.validation_warnings);
                const needsReview = row.decision_status === 'needs_review';
                const isPending = row.decision_status === 'pending';
                const isHumanReviewPending = row.human_review_state === 'pending';
                const isSuperseded = row.decision_status === 'superseded';
                const isActionable = needsReview || isPending || isHumanReviewPending;
                const canSetTimes = needsReview || isPending || isHumanReviewPending;
                const reasonLabel =
                  needsReview || warnings.length > 0 || row.decision_notes
                    ? needsReviewReasonLabel(warnings, row.decision_notes)
                    : 'Review submitted times';
                const canResolve = Boolean(row.provider_id);
                const reviewReasonText = [...warnings, row.decision_notes ?? ''].filter(Boolean).join('\n');
                const correctionSummary = manualTimeCorrectionSummary(row.parsed_shifts);
                const hasTimeCorrection = Boolean(correctionSummary) ||
                  hasManualTimeCorrection(row.parsed_shifts);
                return (
                  <TableRow
                    key={row.id}
                    className={isSuperseded ? 'bg-slate-100/80 text-muted-foreground opacity-70' : undefined}
                  >
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
                      {hasTimeCorrection && (
                        <div className="mt-1">
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Times updated
                          </Badge>
                          {correctionSummary && (
                            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                              {correctionSummary}
                            </div>
                          )}
                        </div>
                      )}
                      {warnings.length > 0 && (
                        <div className="mt-1">
                          <ReasonSummary text={reviewReasonText} detailsText={warnings.join('\n')} />
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
                    <TableCell className="align-top text-right">
                      {isActionable ? (
                        canResolve ? (
                          <div className="flex flex-col items-end gap-1">
                            {canSetTimes && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                disabled={isResolvePending}
                                onClick={() => openResolutionDialog(row, 'accepted', reasonLabel, true)}
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Set times
                              </Button>
                            )}
                            <Button
                              size="sm"
                              className="h-7"
                              disabled={isResolvePending}
                              onClick={() =>
                                openResolutionDialog(
                                  row,
                                  'accepted',
                                  needsReview ? reasonLabel : 'pending submission',
                                )
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                              disabled={isResolvePending}
                              onClick={() =>
                                openResolutionDialog(
                                  row,
                                  'declined',
                                  needsReview ? reasonLabel : 'pending submission',
                                )
                              }
                            >
                              Decline
                            </Button>
                          </div>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-800">
                            Link provider first
                          </Badge>
                        )
                      ) : (
                        hasTimeCorrection ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                            Updated
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <SubmissionResolutionDialog
        month={month}
        target={resolutionTarget}
        onClose={() => setResolutionTarget(null)}
        onResolve={onResolve}
        isPending={isResolvePending}
      />
    </>
  );
}

type RecalculationSnapshotRow = {
  key: string;
  providerName: string;
  status: string;
  acceptedHours: number;
  declinedHours: number;
  publishHours: number;
  cutHours: number;
  publishShifts: number;
  cutShifts: number;
  allocations: string[];
  reason: string;
};

type RecalculationSnapshotMutable = RecalculationSnapshotRow & {
  stateHours: Map<string, number>;
};

type RecalculationComparisonRow = {
  before: RecalculationSnapshotRow | null;
  after: RecalculationSnapshotRow | null;
};

const parseAllocationsFromDecisionNotes = (notes: string | null | undefined): Array<{ state: string; hours: number }> => {
  const alloc = notes?.match(/alloc=([^;\n]+)/);
  if (!alloc) return [];
  const out: Array<{ state: string; hours: number }> = [];
  const matcher = /([A-Z]{2}):([0-9.]+)h/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(alloc[1])) !== null) {
    const hours = Number(match[2]);
    if (Number.isFinite(hours) && hours > 0) {
      out.push({ state: match[1], hours });
    }
  }
  return out;
};

const snapshotKey = (providerId: string | null | undefined, providerName: string) =>
  providerId || providerName.toLowerCase();

const ensureSnapshotRow = (
  map: Map<string, RecalculationSnapshotMutable>,
  key: string,
  providerName: string,
): RecalculationSnapshotMutable => {
  const existing = map.get(key);
  if (existing) return existing;
  const row: RecalculationSnapshotMutable = {
    key,
    providerName,
    status: 'no decision',
    acceptedHours: 0,
    declinedHours: 0,
    publishHours: 0,
    cutHours: 0,
    publishShifts: 0,
    cutShifts: 0,
    allocations: [],
    reason: '',
    stateHours: new Map(),
  };
  map.set(key, row);
  return row;
};

const buildRecalculationSnapshot = (
  decisionRows: ProviderPublishView[],
  publishRows: ShiftRow[],
  cutRows: ShiftRow[],
): RecalculationSnapshotRow[] => {
  const map = new Map<string, RecalculationSnapshotMutable>();
  for (const row of decisionRows) {
    const key = snapshotKey(row.provider_id, row.provider_name);
    const item = ensureSnapshotRow(map, key, row.provider_name);
    const sub = row.submission;
    item.status = sub?.decision_status ?? (sub ? 'pending' : 'missing');
    item.acceptedHours = Number(sub?.accepted_hours ?? 0);
    item.declinedHours = Number(sub?.declined_hours ?? 0);
    item.reason = formatDecisionNoteForStaff(sub?.decision_notes) || '';
    for (const allocation of parseAllocationsFromDecisionNotes(sub?.decision_notes)) {
      item.stateHours.set(
        allocation.state,
        (item.stateHours.get(allocation.state) ?? 0) + allocation.hours,
      );
    }
  }
  for (const shift of publishRows) {
    const key = snapshotKey(shift.provider_id, shift.provider_name);
    const item = ensureSnapshotRow(map, key, shift.provider_name);
    item.publishHours += Number(shift.hours ?? 0);
    item.publishShifts += 1;
    if (shift.assigned_state) {
      item.stateHours.set(
        shift.assigned_state,
        (item.stateHours.get(shift.assigned_state) ?? 0) + Number(shift.hours ?? 0),
      );
    }
  }
  for (const shift of cutRows) {
    const key = snapshotKey(shift.provider_id, shift.provider_name);
    const item = ensureSnapshotRow(map, key, shift.provider_name);
    item.cutHours += Number(shift.hours ?? 0);
    item.cutShifts += 1;
  }
  return Array.from(map.values())
    .map(({ stateHours, ...row }) => ({
      ...row,
      acceptedHours: Math.round(row.acceptedHours * 100) / 100,
      declinedHours: Math.round(row.declinedHours * 100) / 100,
      publishHours: Math.round(row.publishHours * 100) / 100,
      cutHours: Math.round(row.cutHours * 100) / 100,
      allocations: Array.from(stateHours.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([state, hours]) => `${state} ${formatHours(hours)}h`),
    }))
    .sort((a, b) => {
      const deltaA = a.publishHours + a.cutHours + a.acceptedHours + a.declinedHours;
      const deltaB = b.publishHours + b.cutHours + b.acceptedHours + b.declinedHours;
      return deltaB - deltaA || a.providerName.localeCompare(b.providerName);
    });
};

const recalculationRowsChanged = (
  before: RecalculationSnapshotRow | null,
  after: RecalculationSnapshotRow | null,
) => {
  if (!before || !after) return true;
  const allocationBefore = before.allocations.join('|');
  const allocationAfter = after.allocations.join('|');
  return (
    before.status !== after.status ||
    Math.abs(before.acceptedHours - after.acceptedHours) > 0.05 ||
    Math.abs(before.declinedHours - after.declinedHours) > 0.05 ||
    Math.abs(before.publishHours - after.publishHours) > 0.05 ||
    Math.abs(before.cutHours - after.cutHours) > 0.05 ||
    before.publishShifts !== after.publishShifts ||
    before.cutShifts !== after.cutShifts ||
    allocationBefore !== allocationAfter
  );
};

const compareRecalculationSnapshots = (
  beforeRows: RecalculationSnapshotRow[],
  afterRows: RecalculationSnapshotRow[],
): RecalculationComparisonRow[] => {
  const before = new Map(beforeRows.map(row => [row.key, row]));
  const after = new Map(afterRows.map(row => [row.key, row]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  return Array.from(keys)
    .map(key => ({
      before: before.get(key) ?? null,
      after: after.get(key) ?? null,
    }))
    .filter(row => recalculationRowsChanged(row.before, row.after))
    .sort((a, b) => {
      const afterA = a.after ?? a.before;
      const afterB = b.after ?? b.before;
      const hoursA = Number(afterA?.publishHours ?? 0) + Number(afterA?.cutHours ?? 0);
      const hoursB = Number(afterB?.publishHours ?? 0) + Number(afterB?.cutHours ?? 0);
      return hoursB - hoursA || (afterA?.providerName ?? '').localeCompare(afterB?.providerName ?? '');
    });
};

const formatHourChange = (before: number | undefined, after: number | undefined) => {
  const b = Number(before ?? 0);
  const a = Number(after ?? 0);
  const delta = Math.round((a - b) * 100) / 100;
  const sign = delta > 0 ? '+' : '';
  return `${formatHours(b)} -> ${formatHours(a)} (${sign}${formatHours(delta)})`;
};

type RecalculationSnapshotTotals = {
  decisionAcceptedHours: number;
  decisionCutDeclinedHours: number;
  publishableHours: number;
  cutShiftHours: number;
  publishableShifts: number;
  cutShifts: number;
};

type RecalculationDecisionResult = NonNullable<ScheduleRecalculationResult['decisions']>[number];

const roundHours = (value: number) => Math.round(value * 100) / 100;

const acceptedSnapshotStatus = (status: string | null | undefined) =>
  status === 'accepted' || status === 'partial';

const totalsForRecalculationSnapshot = (
  rows: RecalculationSnapshotRow[],
): RecalculationSnapshotTotals => ({
  decisionAcceptedHours: roundHours(
    rows.reduce(
      (sum, row) => sum + (acceptedSnapshotStatus(row.status) ? row.acceptedHours : 0),
      0,
    ),
  ),
  decisionCutDeclinedHours: roundHours(
    rows.reduce((sum, row) => sum + row.declinedHours, 0),
  ),
  publishableHours: roundHours(rows.reduce((sum, row) => sum + row.publishHours, 0)),
  cutShiftHours: roundHours(rows.reduce((sum, row) => sum + row.cutHours, 0)),
  publishableShifts: rows.reduce((sum, row) => sum + row.publishShifts, 0),
  cutShifts: rows.reduce((sum, row) => sum + row.cutShifts, 0),
});

const totalsForCoverageRows = (rows: StateCoverageRow[]) => ({
  acceptedUsableHours: roundHours(rows.reduce((sum, row) => sum + row.filled, 0)),
  demandHours: roundHours(rows.reduce((sum, row) => sum + row.needed, 0)),
  stateGapHours: roundHours(rows.reduce((sum, row) => sum + Math.max(0, row.needed - row.filled), 0)),
});

const compactReasonText = (text: string | null | undefined) => {
  const lines = (text ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  return lines.slice(0, 3).join(' ');
};

const rowAllocationChanged = (
  before: RecalculationSnapshotRow | null,
  after: RecalculationSnapshotRow | null,
) => (before?.allocations.join('|') ?? '') !== (after?.allocations.join('|') ?? '');

const signedHours = (hours: number) =>
  `${hours > 0 ? '+' : ''}${formatHours(roundHours(hours))} hrs`;

const describeRecalculationRowChange = (
  before: RecalculationSnapshotRow | null,
  after: RecalculationSnapshotRow | null,
  hasRun: boolean,
) => {
  if (!hasRun) return 'Current snapshot. Run Recalculate schedule to capture before and after changes.';
  if (!before && after) return 'Added to the current schedule after this recalculation.';
  if (before && !after) return 'Removed from the current schedule after this recalculation.';
  if (!before || !after) return 'Provider changed during this recalculation.';

  const changes: string[] = [];
  if (before.status !== after.status) {
    changes.push(`Decision changed from ${before.status} to ${after.status}.`);
  }
  const acceptedDelta = after.acceptedHours - before.acceptedHours;
  if (Math.abs(acceptedDelta) > 0.05) {
    changes.push(`Decision accepted hours moved ${signedHours(acceptedDelta)}.`);
  }
  const publishDelta = after.publishHours - before.publishHours;
  if (Math.abs(publishDelta) > 0.05) {
    changes.push(`Publishable hours moved ${signedHours(publishDelta)}.`);
  }
  const declinedDelta = after.declinedHours - before.declinedHours;
  if (Math.abs(declinedDelta) > 0.05) {
    changes.push(`Cut / declined decision hours moved ${signedHours(declinedDelta)}.`);
  }
  const cutShiftDelta = after.cutHours - before.cutHours;
  if (Math.abs(cutShiftDelta) > 0.05) {
    changes.push(`Cut shift-row hours moved ${signedHours(cutShiftDelta)}.`);
  }
  if (changes.length === 0 && rowAllocationChanged(before, after)) {
    changes.push('State allocation changed while total hours stayed about the same.');
  }
  return changes.join(' ') || 'No material hour change was returned for this provider.';
};

const explainRecalculationRow = (
  before: RecalculationSnapshotRow | null,
  after: RecalculationSnapshotRow | null,
  decision: RecalculationDecisionResult | undefined,
  hasRun: boolean,
) => {
  if (!hasRun) {
    return 'This is the current allocation snapshot. Use the button above to run a fresh before/after comparison.';
  }
  if (decision?.error) return `Evaluator error: ${decision.error}`;

  const evaluatorReason = decision?.reason
    ? formatDecisionNoteForStaff(decision.reason)
    : after?.reason || before?.reason || '';
  const compactReason = compactReasonText(evaluatorReason);
  if (compactReason) return compactReason;

  const acceptedDelta = (after?.acceptedHours ?? 0) - (before?.acceptedHours ?? 0);
  const publishDelta = (after?.publishHours ?? 0) - (before?.publishHours ?? 0);
  const declinedDelta = (after?.declinedHours ?? 0) - (before?.declinedHours ?? 0);
  const cutShiftDelta = (after?.cutHours ?? 0) - (before?.cutHours ?? 0);

  if (acceptedDelta > 0.05 || publishDelta > 0.05) {
    return 'Approved or corrected availability added schedulable hours. The allocator assigned those hours where this provider is eligible and demand still exists.';
  }
  if (declinedDelta > 0.05 || cutShiftDelta > 0.05) {
    return 'Some submitted hours were trimmed because the assigned state was already covered, the time was outside policy, or higher-priority coverage used the remaining demand first.';
  }
  if (rowAllocationChanged(before, after)) {
    return 'State assignment changed after the allocator rebalanced provider eligibility, state demand, priority, and protected access windows.';
  }
  return 'The evaluator did not return a more specific reason for this provider.';
};

type RecalculationMetricLine = {
  label: string;
  value: string;
  muted?: boolean;
};

const changedMetric = (
  label: string,
  before: number | undefined,
  after: number | undefined,
  muted = false,
): RecalculationMetricLine | null => {
  if (Math.abs(Number(after ?? 0) - Number(before ?? 0)) <= 0.05) return null;
  return { label, value: formatHourChange(before, after), muted };
};

const localChangedMetricLines = (
  before: RecalculationSnapshotRow | null,
  after: RecalculationSnapshotRow | null,
): RecalculationMetricLine[] => {
  const lines = [
    changedMetric('Decision accepted', before?.acceptedHours, after?.acceptedHours),
    changedMetric('Decision cut / declined', before?.declinedHours, after?.declinedHours, true),
    changedMetric('Publishable', before?.publishHours, after?.publishHours),
    changedMetric('Cut rows only', before?.cutHours, after?.cutHours, true),
  ].filter((line): line is RecalculationMetricLine => Boolean(line));
  if (lines.length > 0) return lines;
  if (rowAllocationChanged(before, after)) {
    return [{ label: 'State allocation', value: 'Changed while total hours stayed about the same.' }];
  }
  return [{ label: 'Change', value: 'No hour delta recorded.' }];
};

const historyChangedMetricLines = (
  change: SchedulingRecalculationChange,
): RecalculationMetricLine[] => {
  const lines = [
    changedMetric(
      'Decision accepted',
      change.decision_accepted_before,
      change.decision_accepted_after,
    ),
    changedMetric(
      'Decision cut / declined',
      change.decision_declined_before,
      change.decision_declined_after,
      true,
    ),
    changedMetric(
      'Publishable',
      change.publishable_hours_before,
      change.publishable_hours_after,
    ),
    changedMetric('Cut rows only', change.cut_hours_before, change.cut_hours_after, true),
  ].filter((line): line is RecalculationMetricLine => Boolean(line));
  return lines.length > 0 ? lines : [{ label: 'State allocation', value: 'Changed while total hours stayed about the same.' }];
};

const signedDeltaHours = (hours: number) => {
  const rounded = Math.round(Number(hours ?? 0) * 100) / 100;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${formatHours(rounded)} hrs`;
};

const runDeltaSummary = (run: SchedulingRecalculationRun) => {
  const parts: string[] = [];
  if (Math.abs(Number(run.publishable_delta_hours ?? 0)) > 0.05) {
    parts.push(`${signedDeltaHours(run.publishable_delta_hours)} publishable`);
  }
  if (Math.abs(Number(run.cut_delta_hours ?? 0)) > 0.05) {
    parts.push(`${signedDeltaHours(run.cut_delta_hours)} cut rows`);
  }
  if (Math.abs(Number(run.decision_accepted_delta_hours ?? 0)) > 0.05) {
    parts.push(`${signedDeltaHours(run.decision_accepted_delta_hours)} decision accepted`);
  }
  if (Math.abs(Number(run.decision_declined_delta_hours ?? 0)) > 0.05) {
    parts.push(`${signedDeltaHours(run.decision_declined_delta_hours)} decision cut`);
  }
  return parts.join(' · ') || 'No hour changes';
};

const allocationText = (raw: unknown) => {
  if (!Array.isArray(raw)) return 'No state allocation';
  const parts = raw
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { state?: unknown; hours?: unknown };
      const state = typeof row.state === 'string' ? row.state : '';
      const hours = Number(row.hours ?? 0);
      if (!state || !Number.isFinite(hours) || hours <= 0) return null;
      return `${state} ${formatHours(hours)}h`;
    })
    .filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join(', ') : 'No state allocation';
};

const historyChangeSummary = (change: SchedulingRecalculationChange) => {
  const parts: string[] = [];
  if (change.before_status !== change.after_status) {
    parts.push(`Decision changed from ${change.before_status ?? 'none'} to ${change.after_status ?? 'none'}.`);
  }
  if (Math.abs(Number(change.publishable_hours_delta ?? 0)) > 0.05) {
    parts.push(`Publishable hours moved ${signedDeltaHours(change.publishable_hours_delta)}.`);
  }
  if (Math.abs(Number(change.decision_accepted_delta ?? 0)) > 0.05) {
    parts.push(`Decision accepted hours moved ${signedDeltaHours(change.decision_accepted_delta)}.`);
  }
  if (Math.abs(Number(change.decision_declined_delta ?? 0)) > 0.05) {
    parts.push(`Cut / declined decision hours moved ${signedDeltaHours(change.decision_declined_delta)}.`);
  }
  if (Math.abs(Number(change.cut_hours_delta ?? 0)) > 0.05) {
    parts.push(`Cut shift-row hours moved ${signedDeltaHours(change.cut_hours_delta)}.`);
  }
  return parts.join(' ') || 'State allocation changed while total hours stayed about the same.';
};

const compactHistoryReason = (reason: string | null | undefined) =>
  compactReasonText(formatDecisionNoteForStaff(reason) || reason || '');

const shortRunId = (runId: string | undefined) =>
  runId ? runId.slice(0, 8) : 'current';

function RecalculationChangeReport({
  month,
  lastRun,
  decisionRows,
  publishRows,
  cutRows,
  readinessDeclinedHours,
}: {
  month: string;
  lastRun: {
    result: ScheduleRecalculationResult;
    before: RecalculationSnapshotRow[];
    ranAt: string;
  } | null;
  decisionRows: ProviderPublishView[];
  publishRows: ShiftRow[];
  cutRows: ShiftRow[];
  readinessDeclinedHours: number;
}) {
  const historyQ = useSchedulingRecalculationHistory(month);
  const historyRuns = useMemo(() => historyQ.data ?? [], [historyQ.data]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const coverageQ = useStateCoverage(month);
  const coverageRows = useMemo(() => coverageQ.data?.rows ?? [], [coverageQ.data]);
  const coverageTotals = useMemo(() => totalsForCoverageRows(coverageRows), [coverageRows]);
  const current = useMemo(
    () => buildRecalculationSnapshot(decisionRows, publishRows, cutRows),
    [decisionRows, publishRows, cutRows],
  );
  const changedRows = useMemo(
    () => lastRun ? compareRecalculationSnapshots(lastRun.before, current) : [],
    [current, lastRun],
  );
  const currentTotals = useMemo(() => totalsForRecalculationSnapshot(current), [current]);
  const resultDecisions = lastRun?.result.decisions ?? [];
  const decisionByProvider = new Map(
    resultDecisions
      .filter(decision => decision.provider)
      .map(decision => [decision.provider!.toLowerCase(), decision]),
  );
  useEffect(() => {
    if (historyRuns.length === 0) {
      if (selectedRunId !== null) setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !historyRuns.some(run => run.id === selectedRunId)) {
      setSelectedRunId(historyRuns[0].id);
    }
  }, [historyRuns, selectedRunId]);
  const selectedRun =
    historyRuns.find(run => run.id === selectedRunId) ?? historyRuns[0] ?? null;
  const showLocalFallback = !selectedRun && Boolean(lastRun);
  const localRows = showLocalFallback ? changedRows.slice(0, 20) : [];
  const readinessAcceptedValue = coverageQ.isLoading
    ? 'Checking...'
    : coverageQ.isError
      ? 'Could not load'
      : `${formatHours(coverageTotals.acceptedUsableHours)} hrs`;
  const readinessContext = coverageQ.isLoading
    ? 'Loading the same state-coverage source used by Readiness.'
    : coverageQ.isError
      ? 'Open Coverage Plan if this stays blank after refresh.'
      : `${formatHours(coverageTotals.demandHours)} hrs needed; ${formatHours(coverageTotals.stateGapHours)} hrs still short by state.`;
  const activeRunLabel = selectedRun
    ? `Run ${shortRunId(selectedRun.decision_run_id)} · ${formatRelativeTime(selectedRun.created_at)}`
    : showLocalFallback && lastRun
      ? `Current session run ${shortRunId(lastRun.result.decision_run_id)} · ${formatRelativeTime(lastRun.ranAt)}`
      : 'No recalculation history yet';
  const activeChangeCount = selectedRun
    ? selectedRun.changed_provider_count
    : showLocalFallback
      ? changedRows.length
      : 0;
  const activeDeltaSummary = selectedRun
    ? runDeltaSummary(selectedRun)
    : showLocalFallback
      ? `${changedRows.length} provider${changedRows.length === 1 ? '' : 's'} changed in this browser session`
      : 'Run Recalculate schedule to create the first history entry.';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base">
              Recalculation history · {formatMonthLabel(month)}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Each run stores only provider rows whose decision, publishable hours, cut rows, or state allocation changed.
            </p>
          </div>
          {(selectedRun || showLocalFallback) && (
            <Badge variant="outline" className="w-fit bg-blue-50 text-blue-800">
              {activeChangeCount} provider{activeChangeCount === 1 ? '' : 's'} changed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-blue-200 bg-blue-50/50 px-4 py-3">
          <div className="text-sm font-medium text-blue-950">What this shows</div>
          <p className="mt-1 text-xs text-blue-950/80">
            {activeRunLabel}. {activeDeltaSummary}
          </p>
          <p className="mt-2 text-xs text-blue-950/80">
            Why hours can move: approved/corrected time is accepted first, then the allocator assigns it to eligible states with demand,
            protects scarce Friday/weekend access windows, and trims non-protected surplus. When one provider gains hours, another provider
            can lose publishable hours if that state is already covered or the other provider is lower in the priority order.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Selected run</div>
            <div className="text-lg font-semibold">{activeChangeCount}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Changed provider{activeChangeCount === 1 ? '' : 's'} only.
            </div>
          </div>
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Readiness accepted usable</div>
            <div className="text-lg font-semibold">{readinessAcceptedValue}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Same source as Readiness: publish rows assigned to states.
            </div>
          </div>
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Readiness cut / declined</div>
            <div className="text-lg font-semibold">{formatHours(readinessDeclinedHours)} hrs</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Same source as Readiness: provider decision declined_hours.
            </div>
          </div>
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Current publishable shift rows</div>
            <div className="text-lg font-semibold">
              {currentTotals.publishableShifts}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                ({formatHours(currentTotals.publishableHours)} hrs)
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {readinessContext}
            </div>
          </div>
        </div>

        {historyQ.isLoading && (
          <div className="rounded-md border px-3 py-3">
            <LoadingRow label="Loading recalculation history" />
          </div>
        )}

        {historyQ.isError && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Recalculation history could not load yet. The current-session comparison can still appear after a run.
            </AlertDescription>
          </Alert>
        )}

        {historyRuns.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Past runs</div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {historyRuns.slice(0, 9).map(run => {
                const selected = selectedRun?.id === run.id;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-xs transition-colors',
                      selected
                        ? 'border-blue-300 bg-blue-50 text-blue-950'
                        : 'bg-white hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{formatRelativeTime(run.created_at)}</span>
                      <Badge variant="outline" className="bg-white text-[11px]">
                        {run.changed_provider_count} changed
                      </Badge>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {runDeltaSummary(run)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Run {shortRunId(run.decision_run_id)} · {run.groups_count} evaluated
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {currentTotals.cutShifts > 0 && !selectedRun && (
          <div className="rounded-md border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-900">
            Cut shift-row evidence: {currentTotals.cutShifts} row{currentTotals.cutShifts === 1 ? '' : 's'} totaling{' '}
            {formatHours(currentTotals.cutShiftHours)} hrs. These rows explain what was trimmed, but they are not added again to the
            Readiness cut / declined total.
          </div>
        )}

        {lastRun && resultDecisions.length > 0 && (
          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            Evaluator decisions: {Number(lastRun.result.accepted ?? 0)} accepted,{' '}
            {Number(lastRun.result.partial ?? 0)} partial, {Number(lastRun.result.declined ?? 0)} declined,{' '}
            {Number(lastRun.result.needs_review ?? 0)} needs decision,{' '}
            {Number(lastRun.result.errors ?? 0)} errors.
          </div>
        )}

        {selectedRun && selectedRun.changes.length === 0 ? (
          <div className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
            This run completed with no provider-level changes. Nothing stayed hidden except unchanged rows.
          </div>
        ) : selectedRun ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>What changed</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Why this happened</TableHead>
                <TableHead>Allocation evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedRun.changes.map(change => {
                const allocationAfter = allocationText(change.after_allocations);
                const allocationBefore = allocationText(change.before_allocations);
                return (
                  <TableRow key={change.id}>
                    <TableCell>
                      <div className="font-medium">{change.provider_name}</div>
                      <Badge variant="outline" className="mt-1 text-[11px]">
                        {change.before_status ?? 'none'} -&gt; {change.after_status ?? 'none'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {historyChangeSummary(change)}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {historyChangedMetricLines(change).map(line => (
                        <div key={line.label} className={line.muted ? 'text-muted-foreground' : undefined}>
                          {line.label}: {line.value}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">
                      {compactHistoryReason(change.reason) || 'No evaluator reason recorded for this change.'}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">
                      <div>After: {allocationAfter}</div>
                      {allocationBefore !== allocationAfter && (
                        <div className="mt-1">Before: {allocationBefore}</div>
                      )}
                      <div className="mt-1 tabular-nums">
                        {change.publishable_shifts_before} -&gt; {change.publishable_shifts_after} publish;{' '}
                        {change.cut_shifts_before} -&gt; {change.cut_shifts_after} cut
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : localRows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>What changed</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Why this happened</TableHead>
                <TableHead>Allocation evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {localRows.map(row => {
                const after = row.after;
                const before = row.before;
                const providerName = after?.providerName ?? before?.providerName ?? 'Provider';
                const decision = decisionByProvider.get(providerName.toLowerCase());
                const decisionText = `${before?.status ?? 'new'} -> ${after?.status ?? 'removed'}`;
                const allocation = after?.allocations.length
                  ? after.allocations.join(', ')
                  : 'No state allocation';
                const shiftText = `${before?.publishShifts ?? 0} -> ${after?.publishShifts ?? 0} publish; ${before?.cutShifts ?? 0} -> ${after?.cutShifts ?? 0} cut`;
                return (
                  <TableRow key={`${providerName}-${after?.key ?? before?.key}`}>
                    <TableCell>
                      <div className="font-medium">{providerName}</div>
                      <Badge variant="outline" className="mt-1 text-[11px]">
                        {decisionText}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {describeRecalculationRowChange(before, after, Boolean(lastRun))}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {localChangedMetricLines(before, after).map(line => (
                        <div key={line.label} className={line.muted ? 'text-muted-foreground' : undefined}>
                          {line.label}: {line.value}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs">
                      {explainRecalculationRow(before, after, decision, Boolean(lastRun))}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs">
                      <div>{allocation}</div>
                      <div className="mt-1 tabular-nums">{shiftText}</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
            No recalculation history for {formatMonthLabel(month)} yet. Run Recalculate schedule to create a changes-only log.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingRecalculationPanel({
  month,
  rows,
  decisionRows,
  publishRows,
  cutRows,
  readinessDeclinedHours,
  lastRun,
  isLoading,
  isReevaluating,
  onReevaluate,
}: {
  month: string;
  rows: AvailabilitySubmissionRow[];
  decisionRows: ProviderPublishView[];
  publishRows: ShiftRow[];
  cutRows: ShiftRow[];
  readinessDeclinedHours: number;
  lastRun: {
    result: ScheduleRecalculationResult;
    before: RecalculationSnapshotRow[];
    ranAt: string;
  } | null;
  isLoading: boolean;
  isReevaluating: boolean;
  onReevaluate: () => void;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading pending submissions" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <RecalculationChangeReport
        month={month}
        lastRun={lastRun}
        decisionRows={decisionRows}
        publishRows={publishRows}
        cutRows={cutRows}
        readinessDeclinedHours={readinessDeclinedHours}
      />
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base">
                Pending recalculation · {formatMonthLabel(month)}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                These submissions are still pending a schedule evaluation. Recalculate to move them into accepted, cut / declined, or needs decision.
              </p>
            </div>
            <Button onClick={onReevaluate} disabled={isReevaluating}>
              {isReevaluating ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Recalculate schedule
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No pending submissions need recalculation for {formatMonthLabel(month)}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Expanded hrs</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.provider_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.provider_email ?? 'No email'} · {row.provider_profession ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelativeTime(row.submitted_at)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatHours(expandedSubmittedHours(row))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-blue-50 text-blue-800">
                        Needs recalculation
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
  const pendingHomebase = useMemo(
    () => sorted.filter(s => !isHomebaseDone(s)),
    [sorted],
  );
  const pendingEhr = useMemo(
    () => sorted.filter(s => isHomebaseDone(s) && !isEhrDone(s)),
    [sorted],
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
          No accepted shift list for {formatMonthLabel(month)}. Recalculate the schedule first.
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
              disabled={pendingHomebase.length === 0}
              onClick={() => onBulkShifts(pendingHomebase, 'homebase', true)}
            >
              Mark HB ({pendingHomebase.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pendingEhr.length === 0}
              onClick={() => onBulkShifts(pendingEhr, 'ehr', true)}
            >
              Mark EHR ({pendingEhr.length})
            </Button>
            {pendingEhr.length === 0 && pendingHomebase.length > 0 && (
              <div className="basis-full text-[11px] text-muted-foreground">
                Finish Homebase first. EHR can only be marked after Homebase is complete.
              </div>
            )}
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
              const schedulingNote = formatSchedulingShiftNote(s.recommendation_reason);
              return (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{formatProviderShiftDate(s)}</TableCell>
                  <TableCell className="font-medium">{s.provider_name}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {formatProviderShiftTime(s)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatHours(s.hours)}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{labelShiftType(s.shift_type)}</div>
                    {schedulingNote && (
                      <div className="mt-1 max-w-[280px] text-[11px] leading-snug text-muted-foreground">
                        {schedulingNote}
                      </div>
                    )}
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
                    {!hbDone && (
                      <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                        Finish Homebase first
                      </div>
                    )}
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
      const dateKey = formatProviderShiftDateKey(s);
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(s);
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
                  <CardTitle className="text-base">
                    {formatProviderShiftDate(day.entries[0])}
                  </CardTitle>
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
                          {formatProviderShiftTime(s)}
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
                          {!hbDone && (
                            <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                              Finish Homebase first
                            </div>
                          )}
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
  provider_id: string | null;
  target_month: string;
  prior_status: string | null;
  decision: 'accepted' | 'declined';
  hours_basis: number | null;
  original_hours_basis?: number | null;
  reason: string;
  existing_notes: string | null;
  corrected_parsed_shifts?: unknown;
  correction_summary?: string | null;
  provider_name: string;
};

type ReviewableSubmission = Pick<
  AvailabilitySubmissionRow,
  | 'id'
  | 'provider_id'
  | 'provider_name'
  | 'target_month'
  | 'decision_status'
  | 'decision_notes'
  | 'parsed_shifts'
  | 'validation_warnings'
  | 'raw_requested_hours'
  | 'normalized_requested_hours'
  | 'effective_hours_used_for_forecast'
>;

type SubmissionResolutionTarget = {
  submission: ReviewableSubmission;
  providerName: string;
  decision: 'accepted' | 'declined';
  reasonLabel: string;
  startWithCorrection: boolean;
};

function SubmissionResolutionDialog({
  month,
  target,
  onClose,
  onResolve,
  isPending,
}: {
  month: string;
  target: SubmissionResolutionTarget | null;
  onClose: () => void;
  onResolve: (args: ResolveArgs) => void;
  isPending: boolean;
}) {
  const [resolutionReason, setResolutionReason] = useState('');
  const [useCorrectedTimes, setUseCorrectedTimes] = useState(false);
  const [manualDrafts, setManualDrafts] = useState<ManualAvailabilityDraft[]>([]);

  useEffect(() => {
    if (!target) {
      setResolutionReason('');
      setUseCorrectedTimes(false);
      setManualDrafts([]);
      return;
    }
    const warnings = warningStringsFromUnknown(target.submission.validation_warnings);
    setUseCorrectedTimes(target.startWithCorrection);
    setManualDrafts(
      manualDraftsFromParsedShifts(
        target.submission.parsed_shifts,
        month,
        warnings,
        target.submission.decision_notes,
      ),
    );
    setResolutionReason(
      target.startWithCorrection && target.decision === 'accepted'
        ? 'ClinOps corrected the submitted availability to the exact reviewed times and approved those hours for use.'
        : target.decision === 'accepted'
          ? `ClinOps reviewed ${target.reasonLabel} and approved the submitted hours for use.`
          : `ClinOps reviewed ${target.reasonLabel} and declined the submitted hours so they are greyed out.`,
    );
  }, [month, target]);

  const updateManualDraft = (
    id: string,
    patch: Partial<ManualAvailabilityDraft>,
  ) => {
    setManualDrafts(current =>
      current.map(draft => (
        draft.id === id
          ? { ...draft, ...patch, sourceIssues: undefined }
          : draft
      )),
    );
  };

  const removeManualDraft = (id: string) => {
    setManualDrafts(current => {
      const next = current.filter(draft => draft.id !== id);
      return next.length > 0 ? next : [defaultManualAvailabilityDraft(month)];
    });
  };

  const submitResolution = () => {
    if (!target) return;
    const reason = resolutionReason.trim();
    if (!reason) {
      toast.error('Add a reason before saving the review decision.');
      return;
    }
    const sub = target.submission;
    const originalHours = expandedSubmittedHours(sub);
    const correctedHours = totalManualAvailabilityHours(manualDrafts, month);
    let correctedParsedShifts: unknown;
    let correctionSummary: string | null = null;
    let hoursBasis = originalHours;
    if (useCorrectedTimes) {
      const errors = validateManualAvailabilityDrafts(manualDrafts, month);
      if (errors.length > 0) {
        toast.error(errors[0]);
        return;
      }
      hoursBasis = correctedHours;
      correctedParsedShifts = buildCorrectedParsedShifts(sub.parsed_shifts, manualDrafts, month);
      correctionSummary = summarizeManualAvailability(manualDrafts, month);
      if (target.decision === 'accepted' && correctedHours <= 0) {
        toast.error('Corrected availability must include more than 0 hours before approval.');
        return;
      }
    }
    onResolve({
      submission_id: sub.id,
      provider_id: sub.provider_id,
      target_month: sub.target_month,
      prior_status: sub.decision_status ? String(sub.decision_status) : null,
      decision: target.decision,
      hours_basis: hoursBasis,
      original_hours_basis: originalHours,
      reason,
      existing_notes: sub.decision_notes,
      corrected_parsed_shifts: correctedParsedShifts,
      correction_summary: correctionSummary,
      provider_name: target.providerName,
    });
    onClose();
  };

  const decisionLabel =
    target?.decision === 'accepted'
      ? 'Approve hours'
      : target?.decision === 'declined'
        ? 'Decline hours'
        : '—';
  const submittedHours = expandedSubmittedHours(target?.submission);
  const correctedHours = totalManualAvailabilityHours(manualDrafts, month);

  return (
    <Dialog
      open={Boolean(target)}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {target?.decision === 'accepted' ? 'Approve hours' : 'Decline hours'}
          </DialogTitle>
          <DialogDescription>
            {target?.providerName ?? 'Provider'} · {formatMonthLabel(month)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">Submitted hours</div>
              <div className="font-medium">
                {formatHours(submittedHours)}
              </div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">Corrected hours</div>
              <div className="font-medium">
                {formatHours(correctedHours)}
              </div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">Decision</div>
              <div className="font-medium">{decisionLabel}</div>
            </div>
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="use-corrected-times"
                    checked={useCorrectedTimes}
                    onCheckedChange={checked => setUseCorrectedTimes(Boolean(checked))}
                  />
                  <Label htmlFor="use-corrected-times" className="text-sm font-medium">
                    Use corrected times for this decision
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Corrected rows replace the submitted availability for this provider-month before publish rows are rebuilt.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setUseCorrectedTimes(true);
                  setManualDrafts(current => [...current, defaultManualAvailabilityDraft(month)]);
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add row
              </Button>
            </div>

            <div className="space-y-2">
              {manualDrafts.map((draft, index) => {
                const issues = manualDraftIssues(draft, month);
                const hasIssue = issues.length > 0;
                const startInvalid = parseTimeToMinutes(draft.startTime) == null;
                const endInvalid = parseTimeToMinutes(draft.endTime) == null;
                const dateInvalid =
                  draft.kind !== 'recurring_virtual' &&
                  (!draft.date || !draft.date.startsWith(month.slice(0, 7)));
                const endBeforeStart =
                  parseTimeToMinutes(draft.startTime) != null &&
                  parseTimeToMinutes(draft.endTime) != null &&
                  parseTimeToMinutes(draft.endTime)! <= parseTimeToMinutes(draft.startTime)!;
                return (
                  <div
                    key={draft.id}
                    className={cn(
                      'grid gap-2 rounded-md border bg-background p-2 md:grid-cols-[minmax(150px,0.9fr)_minmax(140px,0.9fr)_minmax(140px,0.9fr)_minmax(110px,0.6fr)_minmax(110px,0.6fr)_auto]',
                      hasIssue && 'border-red-300 bg-red-50/70',
                    )}
                  >
                    <div className="space-y-1">
                      {index === 0 && <Label className="text-xs">Type</Label>}
                      <Select
                        value={draft.kind}
                        onValueChange={value => {
                          setUseCorrectedTimes(true);
                          updateManualDraft(draft.id, { kind: value as ManualAvailabilityKind });
                        }}
                      >
                        <SelectTrigger className="h-9 bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(MANUAL_AVAILABILITY_KIND_LABEL).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      {index === 0 && (
                        <Label className="text-xs">
                          {draft.kind === 'recurring_virtual' ? 'Weekday' : 'Date'}
                        </Label>
                      )}
                      {draft.kind === 'recurring_virtual' ? (
                        <Select
                          value={draft.dayOfWeek}
                          onValueChange={value => {
                            setUseCorrectedTimes(true);
                            updateManualDraft(draft.id, { dayOfWeek: value });
                          }}
                        >
                          <SelectTrigger
                            className={cn(
                              'h-9 bg-background',
                              hasIssue &&
                                !WEEKDAY_INDEX.has(draft.dayOfWeek.toLowerCase()) &&
                                'border-red-300 text-red-800',
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WEEKDAY_OPTIONS.map(day => (
                              <SelectItem key={day} value={day}>
                                {day}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type="date"
                          className={cn('h-9 bg-background', dateInvalid && 'border-red-300 text-red-800')}
                          value={draft.date}
                          onChange={event => {
                            setUseCorrectedTimes(true);
                            updateManualDraft(draft.id, { date: event.target.value });
                          }}
                        />
                      )}
                    </div>
                    <div className="space-y-1">
                      {index === 0 && <Label className="text-xs">Start</Label>}
                      <Input
                        type="time"
                        className={cn('h-9 bg-background', (startInvalid || endBeforeStart) && 'border-red-300 text-red-800')}
                        value={draft.startTime}
                        onChange={event => {
                          setUseCorrectedTimes(true);
                          updateManualDraft(draft.id, { startTime: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      {index === 0 && <Label className="text-xs">End</Label>}
                      <Input
                        type="time"
                        className={cn('h-9 bg-background', (endInvalid || endBeforeStart) && 'border-red-300 text-red-800')}
                        value={draft.endTime}
                        onChange={event => {
                          setUseCorrectedTimes(true);
                          updateManualDraft(draft.id, { endTime: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      {index === 0 && <Label className="text-xs">Hrs</Label>}
                      <div
                        className={cn(
                          'flex h-9 items-center justify-end rounded-md border bg-background px-2 text-sm tabular-nums',
                          hasIssue && 'border-red-300 bg-red-100 text-red-800',
                        )}
                      >
                        {formatHours(draftShiftHours(draft, month))}
                      </div>
                    </div>
                    <div className="flex items-end justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        title="Remove corrected row"
                        aria-label="Remove corrected row"
                        onClick={() => {
                          setUseCorrectedTimes(true);
                          removeManualDraft(draft.id);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {hasIssue && (
                      <div className="space-y-1 md:col-span-6">
                        <div>
                          <Badge variant="outline" className="border-red-200 bg-red-100 text-red-800">
                            Needs adjustment
                          </Badge>
                        </div>
                        <div className="text-xs leading-snug text-red-800">
                          {issues.join(' · ')}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="needs-review-reason">Review note</Label>
            <Textarea
              id="needs-review-reason"
              value={resolutionReason}
              onChange={event => setResolutionReason(event.target.value)}
              className="mt-1 min-h-24"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submitResolution} disabled={isPending || !target}>
            {isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {useCorrectedTimes && target?.decision === 'accepted'
              ? 'Approve corrected hours & recalculate'
              : target?.decision === 'accepted'
                ? 'Approve hours'
                : 'Decline hours'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const [resolutionTarget, setResolutionTarget] = useState<SubmissionResolutionTarget | null>(null);

  const openResolutionDialog = (
    row: ProviderPublishView,
    decision: 'accepted' | 'declined',
    reasonLabel: string,
    startWithCorrection = false,
  ) => {
    if (!row.submission) {
      return;
    }
    setResolutionTarget({
      submission: row.submission,
      providerName: row.provider_name,
      decision,
      reasonLabel,
      startWithCorrection,
    });
  };

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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Needs decision · {formatMonthLabel(month)}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Resolve these after a ClinOps lead decision. Approve hours rebuilds publishable shift rows; decline hours moves them to cut / declined coverage.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Expanded hrs</TableHead>
                <TableHead>What looks wrong</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Next step</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const sub = r.submission!;
                const warnings = Array.isArray(sub.validation_warnings)
                  ? (sub.validation_warnings as string[])
                  : [];
                const reasonLabel = needsReviewReasonLabel(warnings, sub.decision_notes);
                const escalationText = [
                  `Please review ${formatMonthLabel(month)} schedule submission for ${r.provider_name}.`,
                  `Issue: ${reasonLabel}.`,
                  `Expanded hours: ${formatHours(expandedSubmittedHours(sub))}.`,
                  warnings.length > 0
                    ? `System warning: ${warnings.slice(0, 3).join(' · ')}`
                    : sub.decision_notes
                      ? `System note: ${formatDecisionNoteForStaff(sub.decision_notes)}`
                      : 'System note: System could not safely decide.',
                ].join('\n');
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
                      <Badge variant="outline" className="mb-1 bg-orange-50 text-orange-800">
                        {reasonLabel}
                      </Badge>
                      <div>
                        {warnings.length > 0
                          ? warnings.slice(0, 3).join(' · ')
                          : formatDecisionNoteForStaff(sub.decision_notes) || 'System could not safely decide'}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
                        Escalate to ClinOps lead
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={isPending}
                          onClick={() => openResolutionDialog(r, 'accepted', reasonLabel, true)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Set times
                        </Button>
                        <Button
                          size="sm"
                          className="h-7"
                          disabled={isPending}
                          onClick={() => openResolutionDialog(r, 'accepted', reasonLabel)}
                        >
                          Approve hours
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                          disabled={isPending}
                          onClick={() => openResolutionDialog(r, 'declined', reasonLabel)}
                        >
                          Decline hours
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(escalationText);
                              toast.success('Escalation note copied');
                            } catch {
                              toast.error('Clipboard unavailable');
                            }
                          }}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy escalation
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
      <SubmissionResolutionDialog
        month={month}
        target={resolutionTarget}
        onClose={() => setResolutionTarget(null)}
        onResolve={onResolve}
        isPending={isPending}
      />
    </>
  );
}

function MentalHealthDashboard({
  month,
  rows,
  unmatchedSubmissions,
  acceptedRows,
  declinedRows,
  needsReviewRows,
  summary,
  shifts,
  shiftsByProvider,
  isLoading,
  shiftsLoading,
  onToggleShift,
  onToggleProvider,
  onBulkShifts,
  onResolve,
  isResolvePending,
  auditByShift,
  auditEntries,
}: {
  month: string;
  rows: ProviderPublishView[];
  unmatchedSubmissions: UnmatchedSubmission[];
  acceptedRows: ProviderPublishView[];
  declinedRows: ProviderPublishView[];
  needsReviewRows: ProviderPublishView[];
  summary: {
    totalShifts: number;
    totalProviders: number;
    homebaseShifts: number;
    ehrShifts: number;
    declinedCount: number;
    needsReviewCount: number;
    missingCount: number;
  };
  shifts: ShiftRow[];
  shiftsByProvider: Map<string, ShiftRow[]>;
  isLoading: boolean;
  shiftsLoading: boolean;
  onToggleShift: (s: ShiftRow, step: ShiftPublishStep, done: boolean) => void;
  onToggleProvider: (row: ProviderPublishView, step: ShiftPublishStep, done: boolean) => void;
  onBulkShifts: (shifts: ShiftRow[], step: ShiftPublishStep, done: boolean) => void;
  onResolve: (args: ResolveArgs) => void;
  isResolvePending: boolean;
  auditByShift?: ShiftAuditMap;
  auditEntries: PublishAuditEntry[];
}) {
  const serviceLineQ = useMonthlyServiceLineDemand(month);
  const acceptedHours = acceptedRows.reduce(
    (sum, row) => sum + Number(row.submission?.accepted_hours ?? 0),
    0,
  );
  const unmatchedRequestedHours = unmatchedSubmissions.reduce(
    (sum, row) => sum + requestedHoursFromUnmatchedSubmission(row),
    0,
  );
  const visitCapacity = Math.floor((acceptedHours * 60) / MH_VISIT_CADENCE_MINUTES);
  const homebasePct =
    summary.totalShifts > 0 ? Math.round((summary.homebaseShifts / summary.totalShifts) * 100) : 0;
  const ehrPct =
    summary.totalShifts > 0 ? Math.round((summary.ehrShifts / summary.totalShifts) * 100) : 0;
  const providerIds = useMemo(() => new Set(rows.map(r => r.provider_id)), [rows]);
  const mhAuditEntries = useMemo(
    () => auditEntries.filter(e => e.provider_id && providerIds.has(e.provider_id)),
    [auditEntries, providerIds],
  );
  const serviceLineStats = useMemo(() => {
    const targetByLine = new Map(
      (serviceLineQ.data ?? [])
        .filter(row => row.service_line === 'mh_coaching' || row.service_line === 'therapy')
        .map(row => [row.service_line as MentalHealthServiceLine, row]),
    );
    return (['mh_coaching', 'therapy'] as const).map(serviceLine => {
      const target = targetByLine.get(serviceLine);
      const lineRows = rows.filter(
        row => mentalHealthServiceLineForProvider(row.profession, row.provider_name) === serviceLine,
      );
      const lineAcceptedRows = acceptedRows.filter(
        row => mentalHealthServiceLineForProvider(row.profession, row.provider_name) === serviceLine,
      );
      const lineDeclinedRows = declinedRows.filter(
        row => mentalHealthServiceLineForProvider(row.profession, row.provider_name) === serviceLine,
      );
      const lineUnmatchedRows = unmatchedSubmissions.filter(
        row => mentalHealthServiceLineForProvider(null, row.provider_name) === serviceLine,
      );
      const accepted = lineAcceptedRows.reduce(
        (sum, row) => sum + Number(row.submission?.accepted_hours ?? 0),
        0,
      );
      const declined = lineDeclinedRows.reduce(
        (sum, row) => sum + Number(row.submission?.declined_hours ?? 0),
        0,
      );
      const unmatchedRequested = lineUnmatchedRows.reduce(
        (sum, row) => sum + requestedHoursFromUnmatchedSubmission(row),
        0,
      );
      const monthlyTarget = target ? Number(target.monthly_hours_target ?? 0) : null;
      const gap = monthlyTarget == null ? null : monthlyTarget - accepted;
      const fillPct = monthlyTarget && monthlyTarget > 0 ? (accepted / monthlyTarget) * 100 : null;
      return {
        serviceLine,
        label: SERVICE_LINE_LABEL[serviceLine],
        target,
        monthlyTarget,
        accepted,
        declined,
        unmatchedRequested,
        unmatchedCount: lineUnmatchedRows.length,
        gap,
        fillPct,
        providers: lineRows.length,
        acceptedProviders: lineAcceptedRows.length,
        visitCapacity: Math.floor((accepted * 60) / MH_VISIT_CADENCE_MINUTES),
      };
    });
  }, [acceptedRows, declinedRows, rows, serviceLineQ.data, unmatchedSubmissions]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <SummaryCard
          label="MH shifts to publish"
          value={summary.totalShifts.toString()}
          sub={`${summary.totalProviders} provider${summary.totalProviders === 1 ? '' : 's'}`}
        />
        <SummaryCard
          label="Accepted MH hours"
          value={`${acceptedHours.toFixed(1)} hrs`}
          sub={`${visitCapacity} visit slot${visitCapacity === 1 ? '' : 's'} at 40m + charting buffer`}
        />
        <SummaryCard
          label="Posted to Homebase"
          value={summary.totalShifts ? `${homebasePct}%` : '—'}
          sub={`${summary.homebaseShifts} of ${summary.totalShifts} shifts`}
        />
        <SummaryCard
          label="Posted to EHR"
          value={summary.totalShifts ? `${ehrPct}%` : '—'}
          sub={`${summary.ehrShifts} of ${summary.totalShifts} shifts`}
        />
        <SummaryCard
          label="Declined / review"
          value={`${summary.declinedCount}/${summary.needsReviewCount}`}
          sub={`${MH_MIN_SHIFT_HOURS}h minimum shift`}
        />
        <SummaryCard
          label="Unmatched MH"
          value={`${unmatchedSubmissions.length}`}
          sub={`${unmatchedRequestedHours.toFixed(1)} submitted hrs pending link`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Mental health forecast by service line</CardTitle>
          <p className="text-xs text-muted-foreground">
            Source: Metabase card 2973 for MH Coaching and card 2971 for Therapy / LPC,
            stored in service_line_demand_targets.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service line</TableHead>
                <TableHead className="text-right">Forecast hrs</TableHead>
                <TableHead className="text-right">Accepted hrs</TableHead>
                <TableHead className="text-right">Pending link hrs</TableHead>
                <TableHead className="text-right">Gap / surplus</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead className="text-right">Visit slots</TableHead>
                <TableHead className="text-right">Providers</TableHead>
                <TableHead className="text-right">Declined hrs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceLineStats.map(stat => {
                const gap = stat.gap;
                const coverageLabel = stat.fillPct == null ? '—' : `${Math.round(stat.fillPct)}%`;
                const gapLabel =
                  gap == null ? '—' : `${gap <= 0 ? '+' : '-'}${Math.abs(gap).toFixed(1)}`;
                return (
                  <TableRow key={stat.serviceLine}>
                    <TableCell>
                      <div className="font-medium">{stat.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {stat.serviceLine === 'mh_coaching'
                          ? 'Mental health coaches only'
                          : 'Therapy / LPC providers only'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stat.monthlyTarget == null ? 'No forecast' : stat.monthlyTarget.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stat.accepted.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">
                      {stat.unmatchedRequested > 0
                        ? `${stat.unmatchedRequested.toFixed(1)} (${stat.unmatchedCount})`
                        : '—'}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        gap == null ? '' : gap > 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {gapLabel}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{coverageLabel}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stat.visitCapacity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stat.acceptedProviders}/{stat.providers}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-700">
                      {stat.declined.toFixed(1)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {serviceLineQ.isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-4">
                    Loading service-line forecast
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {unmatchedSubmissions.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Unmatched mental health submissions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Submitted hrs</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmatchedSubmissions.map(row => {
                  const serviceLine = mentalHealthServiceLineForProvider(null, row.provider_name);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.provider_name || '—'}</TableCell>
                      <TableCell className="text-xs">
                        {serviceLine ? SERVICE_LINE_LABEL[serviceLine] : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {requestedHoursFromUnmatchedSubmission(row).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-white">
                          {formatMonthLabel(row.target_month)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.submitted_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-amber-100 border-amber-200 text-amber-900">
                          Pending provider link
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
            Needs Decision
            {summary.needsReviewCount > 0 && (
              <Badge className="ml-1 bg-orange-100 text-orange-800">
                {summary.needsReviewCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="declined">
            Declined
            {summary.declinedCount > 0 && (
              <Badge className="ml-1 bg-red-100 text-red-700">
                {summary.declinedCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-3.5 w-3.5 mr-1" /> History
            {mhAuditEntries.length > 0 && (
              <span className="ml-1 text-xs">({mhAuditEntries.length})</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="provider" className="mt-4 space-y-4">
          <MentalHealthPanel
            month={month}
            rows={rows}
            shiftsByProvider={shiftsByProvider}
            isLoading={isLoading}
            onToggleShift={onToggleShift}
            onToggleProvider={onToggleProvider}
            auditByShift={auditByShift}
          />
        </TabsContent>

        <TabsContent value="queue" className="mt-4 space-y-4">
          <PublishingQueue
            month={month}
            shifts={shifts}
            isLoading={shiftsLoading}
            onToggleShift={onToggleShift}
            auditByShift={auditByShift}
            onBulkShifts={onBulkShifts}
          />
        </TabsContent>

        <TabsContent value="day" className="mt-4 space-y-4">
          <ByDayPanel
            month={month}
            shifts={shifts}
            isLoading={shiftsLoading}
            onToggleShift={onToggleShift}
            auditByShift={auditByShift}
          />
        </TabsContent>

        <TabsContent value="review" className="mt-4 space-y-4">
          <NeedsReviewPanel
            month={month}
            rows={needsReviewRows}
            isLoading={isLoading}
            onResolve={onResolve}
            isPending={isResolvePending}
          />
        </TabsContent>

        <TabsContent value="declined" className="mt-4 space-y-4">
          <DeclinedPanel month={month} declinedRows={declinedRows} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          <PublishHistoryPanel month={month} entries={mhAuditEntries} />
        </TabsContent>
      </Tabs>
    </div>
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
          MH Coaching and Therapy / LPC use separate service-line forecasts and are staffed
          separately from medical state coverage.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Line</TableHead>
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
              const serviceLine = mentalHealthServiceLineForProvider(r.profession, r.provider_name);
              return (
                <Fragment key={r.provider_id}>
                  <TableRow>
                    <TableCell>
                      <div className="font-medium">{r.provider_name}</div>
                      <div className="text-xs text-muted-foreground">{r.profession ?? '—'}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {serviceLine ? SERVICE_LINE_LABEL[serviceLine] : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={sub?.decision_status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatHours(sub?.accepted_hours)}
                    </TableCell>
                    <TableCell>
                      {flats.length > 0 ? (
                        <ShiftProgress done={hbShiftDone} total={flats.length} tone="homebase" />
                      ) : (
                        <Checkbox
                          checked={hbAggregate}
                          onCheckedChange={c => onToggleProvider(r, 'homebase', !!c)}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {flats.length > 0 ? (
                        <ShiftProgress done={ehrShiftDone} total={flats.length} tone="ehr" />
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
                      <TableCell colSpan={6} className="py-2">
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
  outreachLogs,
  isLoading,
  isMarkingSent,
  onMarkSent,
}: {
  month: string;
  rows: ProviderPublishView[];
  outreachLogs: ProviderOutreachLog[];
  isLoading: boolean;
  isMarkingSent: boolean;
  onMarkSent: (
    providers: Pick<ProviderPublishView, 'provider_id' | 'provider_name' | 'provider_email'>[],
    subject: string,
    body: string,
  ) => void;
}) {
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(() => new Set());
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
  const selectedRows = useMemo(
    () => sortedRows.filter(r => selectedProviderIds.has(r.provider_id)),
    [sortedRows, selectedProviderIds],
  );
  const selectedRowsWithAddress = useMemo(
    () => selectedRows.filter(r => r.provider_email && r.provider_email.includes('@')),
    [selectedRows],
  );
  const latestLogByProvider = useMemo(() => {
    const map = new Map<string, ProviderOutreachLog>();
    for (const log of outreachLogs) {
      if (!log.provider_id) continue;
      const current = map.get(log.provider_id);
      if (!current || log.sent_at > current.sent_at) map.set(log.provider_id, log);
    }
    return map;
  }, [outreachLogs]);
  const monthLabel = formatMonthLabel(month);
  const reminderSubject = `${monthLabel} availability reminder`;
  const reminderTemplate = (name: string) =>
    `Hi ${name.split(' ')[0]}, gentle reminder to submit your ${monthLabel} availability when you have a moment. Thanks!`;
  const bulkReminderBody = [
    'Hi,',
    '',
    `Gentle reminder to submit your ${monthLabel} availability when you have a moment.`,
    '',
    'Jotform: https://form.jotform.com/252224341308043',
    '',
    'Thanks!',
  ].join('\n');
  const allWithEmailSelected =
    emailsWithAddress.length > 0 &&
    emailsWithAddress.every(r => selectedProviderIds.has(r.provider_id));
  const toggleProvider = (providerId: string, checked: boolean) => {
    setSelectedProviderIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(providerId);
      else next.delete(providerId);
      return next;
    });
  };
  const toggleAllWithEmail = (checked: boolean) => {
    setSelectedProviderIds(prev => {
      const next = new Set(prev);
      for (const row of emailsWithAddress) {
        if (checked) next.add(row.provider_id);
        else next.delete(row.provider_id);
      }
      return next;
    });
  };

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
          No missing {monthLabel} submissions. No reminder needed.
        </AlertDescription>
      </Alert>
    );
  }

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

  const emailSelected = () => {
    if (selectedRowsWithAddress.length === 0) {
      toast.error('Select at least one provider with an email address.');
      return;
    }
    const bcc = selectedRowsWithAddress.map(r => r.provider_email!).join(',');
    const href = `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(reminderSubject)}&body=${encodeURIComponent(bulkReminderBody)}`;
    window.location.href = href;
    toast.success(
      `Opened BCC draft for ${selectedRowsWithAddress.length} provider${selectedRowsWithAddress.length === 1 ? '' : 's'}`,
    );
  };

  const markSelectedSent = () => {
    if (selectedRowsWithAddress.length === 0) {
      toast.error('Select at least one provider with an email address.');
      return;
    }
    onMarkSent(selectedRowsWithAddress, reminderSubject, bulkReminderBody);
  };

  const missingEmailCount = sortedRows.length - emailsWithAddress.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-base">
              Missing submissions · {formatMonthLabel(month)} · {sortedRows.length}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Scheduler can do this. These active providers have no Jotform availability for {monthLabel}.
              Select providers, open a BCC reminder draft, then mark sent once it leaves your email client.
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
              variant="default"
              onClick={emailSelected}
              disabled={selectedRowsWithAddress.length === 0}
            >
              <Send className="h-4 w-4 mr-1" />
              Email selected ({selectedRowsWithAddress.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={markSelectedSent}
              disabled={selectedRowsWithAddress.length === 0 || isMarkingSent}
            >
              {isMarkingSent ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Mark selected sent
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={copyAllEmails}
              disabled={emailsWithAddress.length === 0}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy BCC-ready list ({emailsWithAddress.length})
            </Button>
            <Button size="sm" variant="outline" onClick={copyAll}>
              <Copy className="h-4 w-4 mr-1" />
              Copy all reminders
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-y bg-muted/30 px-4 py-3 text-xs">
          <div className="font-medium">Reminder template</div>
          <div className="mt-1 text-muted-foreground">
            Hi [first name], gentle reminder to submit your {monthLabel} availability when you have a moment. Jotform: https://form.jotform.com/252224341308043
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allWithEmailSelected}
                  disabled={emailsWithAddress.length === 0}
                  onCheckedChange={c => toggleAllWithEmail(!!c)}
                />
              </TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Profession</TableHead>
              <TableHead>Employment</TableHead>
              <TableHead>Last contacted</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map(r => {
              const latestLog = latestLogByProvider.get(r.provider_id);
              return (
                <TableRow key={r.provider_id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedProviderIds.has(r.provider_id)}
                      disabled={!r.provider_email || !r.provider_email.includes('@')}
                      onCheckedChange={c => toggleProvider(r.provider_id, !!c)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{r.provider_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.provider_email ?? <span className="italic">no email on file</span>}
                  </TableCell>
                  <TableCell className="text-xs">{r.profession ?? '—'}</TableCell>
                  <TableCell className="text-xs">{r.employment_type ?? '—'}</TableCell>
                  <TableCell className="text-xs">
                    {latestLog ? (
                      <div>
                        <div>{formatRelativeTime(latestLog.sent_at)}</div>
                        <div className="text-muted-foreground">
                          {latestLog.sent_by_label || latestLog.channel || 'Scheduling team'}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No record</span>
                    )}
                  </TableCell>
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
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type SchedulingExceptionDraft = {
  name: string;
  exceptionType: string;
  rule: string;
  schedulingAction: string;
};

const emptySchedulingExceptionDraft = (): SchedulingExceptionDraft => ({
  name: '',
  exceptionType: '',
  rule: '',
  schedulingAction: '',
});

function SchedulingExceptionsPanel({
  month,
}: {
  month: string;
}) {
  const monthLabel = formatMonthLabel(month);
  const defaultExceptionReason = 'Not expected to submit monthly scheduling availability.';
  const [exceptionDraft, setExceptionDraft] = useState<SchedulingExceptionDraft>(() => emptySchedulingExceptionDraft());
  const [editingExceptionId, setEditingExceptionId] = useState<string | null>(null);
  const [editingExceptionDraft, setEditingExceptionDraft] =
    useState<SchedulingExceptionDraft>(() => emptySchedulingExceptionDraft());
  const [providerQuery, setProviderQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderSearchHit | null>(null);
  const [reasonDraft, setReasonDraft] = useState(defaultExceptionReason);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingReason, setEditingReason] = useState('');
  const { data: schedulingExceptions = [], isLoading: exceptionsLoading } = useSchedulingExceptions();
  const { data: exceptionRowsData = [], isLoading: providerExceptionsLoading } = useProviderSchedulingExceptions();
  const { data: providerMatches = [], isFetching: isSearchingProviders } = useProviderSearch(providerQuery);
  const upsertSchedulingException = useUpsertSchedulingException();
  const deleteSchedulingException = useDeleteSchedulingException();
  const updateProviderException = useUpdateProviderSchedulingException();
  const adminOnlyRows = useMemo(
    () =>
      [...exceptionRowsData].sort((a, b) =>
        a.provider_name.localeCompare(b.provider_name, undefined, { sensitivity: 'base' }),
      ),
    [exceptionRowsData],
  );
  const exceptionsByProvider = useMemo(() => {
    const map = new Map<string, ProviderSchedulingExceptionRow>();
    for (const row of adminOnlyRows) map.set(row.provider_id, row);
    return map;
  }, [adminOnlyRows]);
  const selectedExistingException = selectedProvider
    ? exceptionsByProvider.get(selectedProvider.id)
    : null;
  const visibleProviderMatches = providerMatches.filter(p => p.id !== selectedProvider?.id);
  const exceptionIsSaving =
    upsertSchedulingException.isPending || deleteSchedulingException.isPending;

  const updateExceptionDraft = (
    field: keyof SchedulingExceptionDraft,
    value: string,
  ) => {
    setExceptionDraft(current => ({ ...current, [field]: value }));
  };

  const updateEditingExceptionDraft = (
    field: keyof SchedulingExceptionDraft,
    value: string,
  ) => {
    setEditingExceptionDraft(current => ({ ...current, [field]: value }));
  };

  const draftFromSchedulingException = (
    row: SchedulingExceptionRow,
  ): SchedulingExceptionDraft => ({
    name: row.name,
    exceptionType: row.exception_type ?? '',
    rule: row.rule,
    schedulingAction: row.scheduling_action,
  });

  const saveSchedulingException = async () => {
    try {
      await upsertSchedulingException.mutateAsync(exceptionDraft);
      toast.success(`${exceptionDraft.name.trim()} added to scheduling exceptions`);
      setExceptionDraft(emptySchedulingExceptionDraft());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save scheduling exception');
    }
  };

  const startEditingSchedulingException = (row: SchedulingExceptionRow) => {
    setEditingExceptionId(row.id);
    setEditingExceptionDraft(draftFromSchedulingException(row));
  };

  const saveSchedulingExceptionEdit = async (row: SchedulingExceptionRow) => {
    try {
      await upsertSchedulingException.mutateAsync({
        id: row.id,
        ...editingExceptionDraft,
      });
      toast.success(`${editingExceptionDraft.name.trim()} updated`);
      setEditingExceptionId(null);
      setEditingExceptionDraft(emptySchedulingExceptionDraft());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update scheduling exception');
    }
  };

  const removeSchedulingException = async (row: SchedulingExceptionRow) => {
    const confirmed = window.confirm(`Remove ${row.name} from scheduling exceptions?`);
    if (!confirmed) return;
    try {
      await deleteSchedulingException.mutateAsync(row.id);
      toast.success(`${row.name} removed from scheduling exceptions`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove scheduling exception');
    }
  };

  const selectProviderForException = (provider: ProviderSearchHit) => {
    const existing = exceptionsByProvider.get(provider.id);
    setSelectedProvider(provider);
    setReasonDraft(
      existing?.scheduling_outreach_exemption_reason ||
        defaultExceptionReason,
    );
  };

  const saveSelectedProviderException = async () => {
    if (!selectedProvider) return;
    try {
      await updateProviderException.mutateAsync({
        providerId: selectedProvider.id,
        exempt: true,
        reason: reasonDraft,
      });
      toast.success(
        `${selectedProvider.name} provider exemption ${selectedExistingException ? 'updated' : 'added'}`,
      );
      setProviderQuery('');
      setSelectedProvider(null);
      setReasonDraft(defaultExceptionReason);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update provider exception');
    }
  };

  const startEditingProviderException = (row: ProviderSchedulingExceptionRow) => {
    setEditingProviderId(row.provider_id);
    setEditingReason(row.scheduling_outreach_exemption_reason || defaultExceptionReason);
  };

  const saveProviderExceptionEdit = async (row: ProviderSchedulingExceptionRow) => {
    try {
      await updateProviderException.mutateAsync({
        providerId: row.provider_id,
        exempt: true,
        reason: editingReason,
      });
      toast.success(`${row.provider_name} provider exemption updated`);
      setEditingProviderId(null);
      setEditingReason('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update provider exception');
    }
  };

  const removeProviderException = async (row: ProviderSchedulingExceptionRow) => {
    const confirmed = window.confirm(`Remove ${row.provider_name} from provider exemptions?`);
    if (!confirmed) return;
    try {
      await updateProviderException.mutateAsync({
        providerId: row.provider_id,
        exempt: false,
        reason: null,
      });
      toast.success(`${row.provider_name} removed from provider exemptions`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove provider exception');
    }
  };

  if (exceptionsLoading || providerExceptionsLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading scheduling exceptions" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Scheduling exceptions · {monthLabel}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Standing edge cases the scheduling team should check before matching, outreach, or publishing.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(180px,0.8fr)_minmax(160px,0.6fr)_minmax(260px,1fr)_minmax(260px,1fr)_auto] xl:items-end">
              <div className="space-y-2">
                <Label htmlFor="scheduling-exception-name">Provider / case</Label>
                <Input
                  id="scheduling-exception-name"
                  value={exceptionDraft.name}
                  onChange={e => updateExceptionDraft('name', e.target.value)}
                  placeholder="Name or case"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduling-exception-type">Type</Label>
                <Input
                  id="scheduling-exception-type"
                  value={exceptionDraft.exceptionType}
                  onChange={e => updateExceptionDraft('exceptionType', e.target.value)}
                  placeholder="Category"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduling-exception-rule">Rule</Label>
                <Textarea
                  id="scheduling-exception-rule"
                  value={exceptionDraft.rule}
                  onChange={e => updateExceptionDraft('rule', e.target.value)}
                  className="min-h-[72px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduling-exception-action">Scheduling action</Label>
                <Textarea
                  id="scheduling-exception-action"
                  value={exceptionDraft.schedulingAction}
                  onChange={e => updateExceptionDraft('schedulingAction', e.target.value)}
                  className="min-h-[72px]"
                />
              </div>
              <Button
                onClick={saveSchedulingException}
                disabled={exceptionIsSaving}
              >
                {upsertSchedulingException.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Add Scheduling Exception
              </Button>
            </div>
          </div>

          {schedulingExceptions.length === 0 ? (
            <div className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
              No standing scheduling exceptions are listed.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider / case</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Scheduling action</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedulingExceptions.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {editingExceptionId === item.id ? (
                        <Input
                          value={editingExceptionDraft.name}
                          onChange={e => updateEditingExceptionDraft('name', e.target.value)}
                        />
                      ) : (
                        item.name
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {editingExceptionId === item.id ? (
                        <Input
                          value={editingExceptionDraft.exceptionType}
                          onChange={e => updateEditingExceptionDraft('exceptionType', e.target.value)}
                        />
                      ) : (
                        item.exception_type ?? '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {editingExceptionId === item.id ? (
                        <Textarea
                          value={editingExceptionDraft.rule}
                          onChange={e => updateEditingExceptionDraft('rule', e.target.value)}
                          className="min-h-[72px]"
                        />
                      ) : (
                        item.rule
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {editingExceptionId === item.id ? (
                        <Textarea
                          value={editingExceptionDraft.schedulingAction}
                          onChange={e => updateEditingExceptionDraft('schedulingAction', e.target.value)}
                          className="min-h-[72px]"
                        />
                      ) : (
                        item.scheduling_action
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingExceptionId === item.id ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title="Save scheduling exception"
                            aria-label={`Save scheduling exception for ${item.name}`}
                            disabled={exceptionIsSaving}
                            onClick={() => saveSchedulingExceptionEdit(item)}
                          >
                            {upsertSchedulingException.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Cancel edit"
                            aria-label={`Cancel editing ${item.name}`}
                            disabled={exceptionIsSaving}
                            onClick={() => {
                              setEditingExceptionId(null);
                              setEditingExceptionDraft(emptySchedulingExceptionDraft());
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Edit scheduling exception"
                            aria-label={`Edit scheduling exception for ${item.name}`}
                            onClick={() => startEditingSchedulingException(item)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600 hover:text-red-700"
                            title="Remove scheduling exception"
                            aria-label={`Remove ${item.name} from scheduling exceptions`}
                            disabled={exceptionIsSaving}
                            onClick={() => removeSchedulingException(item)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Admin-only provider exemptions</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Providers with this profile indicator are excluded from missing-submission counts and outreach lists.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 space-y-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)_auto] lg:items-end">
              <div className="space-y-2">
                <Label htmlFor="provider-exemption-search">Provider</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="provider-exemption-search"
                    value={providerQuery}
                    onChange={e => {
                      setProviderQuery(e.target.value);
                      setSelectedProvider(null);
                    }}
                    placeholder="Search name or email"
                    className="pl-9"
                  />
                </div>
                {selectedProvider && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                    <span className="font-medium">{selectedProvider.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {selectedProvider.email ?? 'No email'} · {selectedProvider.profession ?? '—'}
                    </span>
                    {selectedExistingException && (
                      <Badge variant="outline" className="bg-white">Already listed</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-7 w-7"
                      title="Clear selection"
                      aria-label="Clear provider exemption selection"
                      onClick={() => {
                        setSelectedProvider(null);
                        setReasonDraft(defaultExceptionReason);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {providerQuery.trim().length >= 2 && !selectedProvider && (
                  <div className="max-h-56 overflow-y-auto rounded-md border bg-background">
                    {isSearchingProviders ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">Searching providers...</div>
                    ) : visibleProviderMatches.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground">No matching providers.</div>
                    ) : (
                      visibleProviderMatches.map(provider => {
                        const alreadyListed = exceptionsByProvider.has(provider.id);
                        return (
                          <button
                            key={provider.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                            onClick={() => selectProviderForException(provider)}
                          >
                            <span>
                              <span className="block font-medium">{provider.name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {provider.email ?? 'No email'} · {provider.profession ?? '—'}
                              </span>
                            </span>
                            {alreadyListed && <Badge variant="outline">Listed</Badge>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider-exemption-reason">Exemption reason</Label>
                <Textarea
                  id="provider-exemption-reason"
                  value={reasonDraft}
                  onChange={e => setReasonDraft(e.target.value)}
                  className="min-h-[72px]"
                />
              </div>

              <Button
                onClick={saveSelectedProviderException}
                disabled={!selectedProvider || updateProviderException.isPending}
                className="lg:mb-0"
              >
                {updateProviderException.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                {selectedExistingException ? 'Update Provider Exemption' : 'Add Provider Exemption'}
              </Button>
            </div>
          </div>

          {adminOnlyRows.length === 0 ? (
            <div className="rounded-md border px-4 py-6 text-sm text-muted-foreground">
              No admin-only scheduling outreach exemptions are set.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Profession</TableHead>
                  <TableHead>Employment</TableHead>
                  <TableHead>Profile indicator</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminOnlyRows.map(row => (
                  <TableRow key={row.provider_id}>
                    <TableCell>
                      <div className="font-medium">{row.provider_name}</div>
                      <div className="text-xs text-muted-foreground">{row.provider_email ?? 'No email'}</div>
                    </TableCell>
                    <TableCell className="text-xs">{row.profession ?? '—'}</TableCell>
                    <TableCell className="text-xs">
                      <div>{row.employment_type ?? '—'}</div>
                      <div className="text-muted-foreground">{row.active === false ? 'Inactive' : row.employment_status ?? ''}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {editingProviderId === row.provider_id ? (
                        <Textarea
                          value={editingReason}
                          onChange={e => setEditingReason(e.target.value)}
                          className="min-h-[72px]"
                        />
                      ) : (
                        <>
                          <Badge variant="outline" className="bg-slate-50">Admin-only</Badge>
                          <span className="ml-2 text-muted-foreground">
                            {row.scheduling_outreach_exemption_reason || defaultExceptionReason}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingProviderId === row.provider_id ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title="Save provider exemption"
                            aria-label={`Save provider exemption for ${row.provider_name}`}
                            disabled={updateProviderException.isPending}
                            onClick={() => saveProviderExceptionEdit(row)}
                          >
                            {updateProviderException.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Cancel edit"
                            aria-label={`Cancel editing ${row.provider_name}`}
                            disabled={updateProviderException.isPending}
                            onClick={() => {
                              setEditingProviderId(null);
                              setEditingReason('');
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Edit provider exemption"
                            aria-label={`Edit provider exemption for ${row.provider_name}`}
                            onClick={() => startEditingProviderException(row)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600 hover:text-red-700"
                            title="Remove provider exemption"
                            aria-label={`Remove ${row.provider_name} from provider exemptions`}
                            disabled={updateProviderException.isPending}
                            onClick={() => removeProviderException(row)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
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
          (9a–9p ET weekdays / 9a–12p ET weekends). The reason column translates
          system notes into plain English.
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
              const isFullyDeclined = sub.decision_status === 'declined';
              return (
                <TableRow
                  key={r.provider_id}
                  className={isFullyDeclined ? 'bg-slate-50/80 text-muted-foreground' : undefined}
                >
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
                  <TableCell className="text-right tabular-nums text-slate-500">
                    <span className="line-through decoration-slate-400">
                      {formatHours(sub.declined_hours)}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(sub.submitted_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </TableCell>
                  <TableCell className="text-xs max-w-md">
                    <ReasonSummary
                      text={sub.decision_notes}
                      detailsText={formatDecisionNoteForStaff(sub.decision_notes)}
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
}

function DeclinedHoursPanel({
  month,
  declinedRows,
  cutRowsByProvider,
  eligibilityByProvider,
  isLoading,
}: {
  month: string;
  declinedRows: ProviderPublishView[];
  cutRowsByProvider: Map<string, ShiftRow[]>;
  eligibilityByProvider: Map<string, ProviderEligibilitySummary>;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <LoadingRow label="Loading declined hours" />
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

  const declinedHours = declinedRows.reduce(
    (sum, row) => sum + Number(row.submission?.declined_hours ?? 0),
    0,
  );
  const cutCount = declinedRows.reduce(
    (sum, row) => sum + (cutRowsByProvider.get(row.provider_id)?.length ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Providers with declined hrs"
          value={declinedRows.length.toString()}
          sub={formatMonthLabel(month)}
        />
        <SummaryCard
          label="Declined hours"
          value={`${declinedHours.toFixed(1)} hrs`}
          sub="Submission-level total"
        />
        <SummaryCard
          label="Cut shift rows"
          value={cutCount.toString()}
          sub="From shift recommendations"
        />
        <SummaryCard
          label="License visibility"
          value={`${declinedRows.filter(r => eligibilityByProvider.has(r.provider_id)).length}`}
          sub="Providers with eligible states"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarX className="h-4 w-4 text-red-600" />
            Declined hours · {formatMonthLabel(month)}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Declined or trimmed hours with the provider's eligible states and cut-row reasons.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead className="text-right">Declined</TableHead>
                <TableHead>Eligible states</TableHead>
                <TableHead>Cut shifts</TableHead>
                <TableHead>Decision detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {declinedRows.map(row => {
                const sub = row.submission!;
                const eligibility = eligibilityByProvider.get(row.provider_id);
                const eligibleStates = eligibility ? Array.from(eligibility.states).sort() : [];
                const sourceLabels = formatLicenseSources(eligibility?.sources);
                const cuts = cutRowsByProvider.get(row.provider_id) ?? [];
                const serviceLine = mentalHealthServiceLineForProvider(row.profession, row.provider_name);
                const uniqueCutReasons = Array.from(new Set(
                  cuts.map(c => c.recommendation_reason).filter(Boolean) as string[],
                ));
                const isFullyDeclined = sub.decision_status === 'declined';
                const reasonText = [sub.decision_notes, ...uniqueCutReasons].filter(Boolean).join('\n');
                const reasonDetails = [
                  formatDecisionNoteForStaff(sub.decision_notes),
                  ...uniqueCutReasons,
                ].filter(Boolean).join('\n');
                return (
                  <TableRow
                    key={row.provider_id}
                    className={isFullyDeclined ? 'bg-slate-50/80 text-muted-foreground' : undefined}
                  >
                    <TableCell className="align-top">
                      <div className="font-medium">{row.provider_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.profession ?? '—'}
                        {row.employment_type ? ` · ${row.employment_type}` : ''}
                      </div>
                      {serviceLine && (
                        <Badge variant="outline" className="mt-1 text-[11px]">
                          {SERVICE_LINE_LABEL[serviceLine]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge status={sub.decision_status} />
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums">
                      {formatHours(sub.accepted_hours)}
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums text-slate-500">
                      <span className="line-through decoration-slate-400">
                        {formatHours(sub.declined_hours)}
                      </span>
                    </TableCell>
                    <TableCell className="align-top text-xs max-w-[220px]">
                      {eligibleStates.length > 0 ? (
                        <>
                          <div className="flex flex-wrap gap-1">
                            {eligibleStates.map(state => (
                              <Badge key={state} variant="outline" className="text-[11px]">
                                {state}
                              </Badge>
                            ))}
                          </div>
                          {sourceLabels && (
                            <div className="text-[11px] text-muted-foreground mt-1">
                              {sourceLabels}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">No eligible states found</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-xs max-w-[260px]">
                      {cuts.length === 0 ? (
                        <span className="text-muted-foreground">No cut rows emitted</span>
                      ) : (
                        <div className="space-y-1">
                          {cuts.slice(0, 4).map(cut => (
                            <div
                              key={cut.id}
                              className="rounded border bg-slate-50 px-2 py-1 text-muted-foreground"
                            >
                              <div className="font-medium line-through decoration-slate-400">
                                {formatProviderShiftDate(cut)} · {formatProviderShiftTime(cut)}
                              </div>
                              <div className="text-muted-foreground">
                                {formatHours(cut.hours)}h · {labelShiftType(cut.shift_type)}
                              </div>
                            </div>
                          ))}
                          {cuts.length > 4 && (
                            <div className="text-muted-foreground">+{cuts.length - 4} more</div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-xs max-w-[360px]">
                      <ReasonSummary
                        text={reasonText}
                        detailsText={reasonDetails}
                        maxTags={5}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
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
          Generated shifts intentionally omit recurring availability that falls on these dates.
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
              schedule-recalculation preservation. {entries.length} event
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
// Scheduling workbench readiness and top-level tab panels
// ============================================================================

function ReadinessPanel({
  month,
  isLoading,
  summary,
  missingCount,
  submittedHours,
  pendingSubmissionCount,
  pendingSubmissionHours,
  needsReviewHours,
  declinedCount,
  declinedHours,
  inboxNeedsReviewCount,
  unmatchedCount,
  onReevaluate,
  isReevaluating,
  onJumpToCoverage,
  onJumpToAvailability,
  onJumpToReview,
  onJumpToPublish,
  onJumpToDeclined,
  onJumpToExceptions,
}: {
  month: string;
  isLoading: boolean;
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
  pendingSubmissionCount: number;
  pendingSubmissionHours: number;
  needsReviewHours: number;
  declinedCount: number;
  declinedHours: number;
  inboxNeedsReviewCount: number;
  unmatchedCount: number;
  onReevaluate: () => void;
  isReevaluating: boolean;
  onJumpToCoverage: () => void;
  onJumpToAvailability: (tab?: AvailabilityTabKey) => void;
  onJumpToReview: (tab?: ReviewTabKey) => void;
  onJumpToPublish: (tab?: PublishTabKey) => void;
  onJumpToDeclined: () => void;
  onJumpToExceptions: () => void;
}) {
  const coverageQ = useStateCoverage(month);
  const coverageRows = useMemo(() => coverageQ.data?.rows ?? [], [coverageQ.data]);

  const demandHours = useMemo(
    () => coverageRows.reduce((s, r) => s + r.needed, 0),
    [coverageRows],
  );

  const acceptedHours = useMemo(
    () => coverageRows.reduce((s, r) => s + r.filled, 0),
    [coverageRows],
  );

  const stateGapHours = useMemo(
    () => coverageRows.reduce((s, r) => s + Math.max(0, r.needed - r.filled), 0),
    [coverageRows],
  );
  const stateSurplusHours = useMemo(
    () => coverageRows.reduce((s, r) => s + Math.max(0, r.filled - r.needed), 0),
    [coverageRows],
  );
  const shortStateRows = useMemo(
    () =>
      coverageRows
        .map(r => ({ ...r, shortage: Math.max(0, r.needed - r.filled) }))
        .filter(r => r.shortage > 0.05)
        .sort((a, b) => b.shortage - a.shortage),
    [coverageRows],
  );
  const surplusStateRows = useMemo(
    () =>
      coverageRows
        .map(r => ({ ...r, surplus: Math.max(0, r.filled - r.needed) }))
        .filter(r => r.surplus > 0.05)
        .sort((a, b) => b.surplus - a.surplus),
    [coverageRows],
  );
  const netCoverageHours = acceptedHours - demandHours;
  const acceptedPct =
    demandHours > 0 ? Math.min(999, Math.round((acceptedHours / demandHours) * 100)) : null;
  const formatSignedCoverageHours = (hours: number) =>
    `${hours >= 0 ? '+' : '-'}${Math.abs(hours).toFixed(0)} hrs`;
  const criticalGapStates = useMemo(
    () =>
      coverageRows.filter(
        r => r.needed > 0 && r.pct_filled < 60,
      ),
    [coverageRows],
  );
  const watchGapStates = useMemo(
    () =>
      coverageRows.filter(
        r => r.needed > 0 && r.pct_filled >= 60 && r.pct_filled < 95,
      ),
    [coverageRows],
  );

  const homebasePct =
    summary.totalShifts > 0 ? Math.round((summary.homebaseShifts / summary.totalShifts) * 100) : 0;
  const ehrPct =
    summary.totalShifts > 0 ? Math.round((summary.ehrShifts / summary.totalShifts) * 100) : 0;
  const reviewCount = summary.needsReviewCount + inboxNeedsReviewCount;
  const hasPublishRows = summary.totalShifts > 0;
  const checksLoading = isLoading || coverageQ.isLoading;

  type BlockerCategory = 'Scheduler can do this' | 'Escalate to ClinOps lead' | 'System/admin issue';

  type OperatorBlocker = {
    label: string;
    detail: string;
    category: BlockerCategory;
    action: string;
    onClick: () => void;
  };

  const hardBlockers = useMemo<OperatorBlocker[]>(() => {
    const out: OperatorBlocker[] = [];
    if (coverageQ.isError) {
      out.push({
        label: 'Coverage could not load',
        detail: 'Do not publish until the Coverage Gaps tab loads successfully.',
        category: 'System/admin issue',
        action: 'Open Coverage Gaps',
        onClick: onJumpToCoverage,
      });
    } else if (!coverageQ.isLoading && coverageRows.length === 0) {
      out.push({
        label: 'No coverage rows for this month',
        detail: 'Recalculate the schedule from the latest submissions. If coverage still does not load, ask an admin for help.',
        category: 'System/admin issue',
        action: 'Open Coverage Gaps',
        onClick: onJumpToCoverage,
      });
    }
    if (!checksLoading && !hasPublishRows) {
      out.push({
        label: 'No publishable shift list yet',
        detail: submittedHours > 0
          ? 'Availability exists, but the accepted shift list is not ready. Recalculate the schedule from the latest submissions.'
          : `No usable ${formatMonthLabel(month)} availability has been expanded yet.`,
        category: 'Scheduler can do this',
        action: 'Recalculate schedule',
        onClick: onReevaluate,
      });
    }
    if (hasPublishRows && unmatchedCount > 0) {
      out.push({
        label: `${unmatchedCount} unmatched submission${unmatchedCount === 1 ? '' : 's'}`,
        detail: 'A provider name or email did not match the provider directory. If the match is obvious, fix it; otherwise escalate.',
        category: 'Scheduler can do this',
        action: 'Open Unmatched',
        onClick: () => onJumpToAvailability('unmatched'),
      });
    }
    if (reviewCount > 0) {
      out.push({
        label: `${reviewCount} item${reviewCount === 1 ? '' : 's'} need manual review`,
        detail: `${summary.needsReviewCount} unusual-hours flag${summary.needsReviewCount === 1 ? '' : 's'} and ${inboxNeedsReviewCount} resubmission${inboxNeedsReviewCount === 1 ? '' : 's'} need a ClinOps lead decision.`,
        category: 'Escalate to ClinOps lead',
        action: summary.needsReviewCount > 0 ? 'Open Needs Decision' : 'Open Resubmits',
        onClick: summary.needsReviewCount > 0 ? () => onJumpToReview('decisions') : () => onJumpToReview('resubmits'),
      });
    }
    if (criticalGapStates.length > 0) {
      out.push({
        label: `${criticalGapStates.length} state${criticalGapStates.length === 1 ? '' : 's'} critically under-covered`,
        detail: `Affected states: ${criticalGapStates.slice(0, 6).map(s => `${s.state} ${Math.round(s.pct_filled)}% covered`).join(', ')}${criticalGapStates.length > 6 ? ', plus more' : ''}.`,
        category: 'Escalate to ClinOps lead',
        action: 'Open Coverage Gaps',
        onClick: onJumpToCoverage,
      });
    }
    if (missingCount > 0) {
      out.push({
        label: `${missingCount} provider${missingCount === 1 ? '' : 's'} missing ${formatMonthLabel(month)} availability`,
        detail: `These active providers have not submitted ${formatMonthLabel(month)} availability. Send reminders before publishing so staff can capture any last covered hours.`,
        category: 'Scheduler can do this',
        action: 'Open Missing',
        onClick: () => onJumpToAvailability('missing'),
      });
    }
    return out;
  }, [
    coverageQ.isError,
    coverageQ.isLoading,
    coverageRows,
    checksLoading,
    hasPublishRows,
    unmatchedCount,
    submittedHours,
    reviewCount,
    summary.needsReviewCount,
    inboxNeedsReviewCount,
    criticalGapStates,
    missingCount,
    month,
    onReevaluate,
    onJumpToAvailability,
    onJumpToCoverage,
    onJumpToReview,
  ]);

  const workbenchReady = !checksLoading && hardBlockers.length === 0 && hasPublishRows;
  const publishingComplete = workbenchReady && homebasePct === 100 && ehrPct === 100;

  type Readiness = {
    label: 'Checking' | 'Blocked' | 'Action Needed' | 'Ready to Publish' | 'Publishing' | 'Complete';
    tone: string;
  };
  const readiness: Readiness = (() => {
    if (checksLoading) return { label: 'Checking', tone: 'bg-slate-100 text-slate-700 border-slate-200' };
    if (hardBlockers.length > 0) return { label: 'Blocked', tone: 'bg-red-100 text-red-800 border-red-200' };
    if (missingCount > 0) return { label: 'Action Needed', tone: 'bg-amber-100 text-amber-800 border-amber-200' };
    if (publishingComplete) return { label: 'Complete', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    if (homebasePct > 0 || ehrPct > 0) return { label: 'Publishing', tone: 'bg-blue-100 text-blue-800 border-blue-200' };
    return { label: 'Ready to Publish', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  })();

  const { blocker, nextAction, nextActionJump, nextCategory, nextDisabled } = useMemo<{
    blocker: string;
    nextAction: string;
    nextActionJump: () => void;
    nextCategory: BlockerCategory;
    nextDisabled?: boolean;
  }>(() => {
    if (!hasPublishRows) {
      return {
        blocker: 'Accepted shift list is not ready yet',
        nextAction: 'Recalculate schedule from latest submissions',
        nextActionJump: onReevaluate,
        nextCategory: 'Scheduler can do this',
        nextDisabled: isReevaluating,
      };
    }
    if (unmatchedCount > 0) {
      return {
        blocker: `${unmatchedCount} unmatched submission${unmatchedCount === 1 ? '' : 's'}`,
        nextAction: 'Fix unmatched submissions',
        nextActionJump: () => onJumpToAvailability('unmatched'),
        nextCategory: 'Scheduler can do this',
      };
    }
    if (reviewCount > 0) {
      return {
        blocker: `${reviewCount} item${reviewCount === 1 ? '' : 's'} need ClinOps lead review`,
        nextAction: summary.needsReviewCount > 0
          ? 'Approve or decline flagged hours'
          : 'Approve or park resubmitted hours',
        nextActionJump: summary.needsReviewCount > 0 ? () => onJumpToReview('decisions') : () => onJumpToReview('resubmits'),
        nextCategory: 'Escalate to ClinOps lead',
      };
    }
    if (criticalGapStates.length > 0) {
      return {
        blocker: `${criticalGapStates.length} state${criticalGapStates.length === 1 ? '' : 's'} critically under-covered`,
        nextAction: 'Escalate coverage gaps to ClinOps lead',
        nextActionJump: onJumpToCoverage,
        nextCategory: 'Escalate to ClinOps lead',
      };
    }
    if (missingCount > 0) {
      return {
        blocker: `${missingCount} provider${missingCount === 1 ? '' : 's'} missing ${formatMonthLabel(month)} availability`,
        nextAction: 'Send missing availability reminders',
        nextActionJump: () => onJumpToAvailability('missing'),
        nextCategory: 'Scheduler can do this',
      };
    }
    if (homebasePct < 100) {
      return {
        blocker: 'None blocking the build',
        nextAction: 'Post accepted shifts to Homebase',
        nextActionJump: () => onJumpToPublish(),
        nextCategory: 'Scheduler can do this',
      };
    }
    if (ehrPct < 100) {
      return {
        blocker: 'Homebase is done',
        nextAction: 'Post accepted shifts to EHR',
        nextActionJump: () => onJumpToPublish(),
        nextCategory: 'Scheduler can do this',
      };
    }
    return {
      blocker: `None - ${formatMonthLabel(month)} is fully published`,
      nextAction: `No action needed - ${formatMonthLabel(month)} schedule is publish-complete`,
      nextActionJump: () => onJumpToPublish(),
      nextCategory: 'Scheduler can do this',
    };
  }, [
    month,
    hasPublishRows,
    unmatchedCount,
    reviewCount,
    summary.needsReviewCount,
    criticalGapStates.length,
    missingCount,
    homebasePct,
    ehrPct,
    isReevaluating,
    onReevaluate,
    onJumpToAvailability,
    onJumpToCoverage,
    onJumpToReview,
    onJumpToPublish,
  ]);

  type OperatorStep = {
    label: string;
    detail: string;
    status: 'done' | 'current' | 'blocked' | 'waiting';
    action?: string;
    onClick?: () => void;
    disabled?: boolean;
  };

  const workflowSteps: OperatorStep[] = [
    {
      label: '1. Confirm Jotform availability',
      detail: submittedHours > 0
        ? `${submittedHours.toFixed(0)} expanded availability hours are in the workbench.`
        : 'No expanded availability hours are visible yet.',
      status: submittedHours > 0 ? 'done' : 'blocked',
      action: 'Open Availability',
      onClick: () => onJumpToAvailability('submissions'),
    },
    {
      label: '2. Build the recommended shift list',
      detail: hasPublishRows
        ? `${summary.totalShifts} publishable shift${summary.totalShifts === 1 ? '' : 's'} for ${summary.totalProviders} provider${summary.totalProviders === 1 ? '' : 's'}.`
        : submittedHours > 0
          ? 'Click Recalculate schedule, then wait for shift rows to appear.'
          : 'Wait for availability before recalculating the schedule.',
      status: hasPublishRows ? 'done' : submittedHours > 0 ? 'current' : 'waiting',
      action: !hasPublishRows && submittedHours > 0 ? 'Recalculate schedule' : undefined,
      onClick: !hasPublishRows && submittedHours > 0 ? onReevaluate : undefined,
      disabled: isReevaluating,
    },
    {
      label: '3. Clear manual review',
      detail: reviewCount === 0
        ? 'No ambiguous submissions or resubmissions need action.'
        : `${reviewCount} item${reviewCount === 1 ? '' : 's'} need a ClinOps lead decision before publishing.`,
      status: reviewCount === 0 ? 'done' : 'blocked',
      action: summary.needsReviewCount > 0 ? 'Open Needs Decision' : 'Open Resubmits',
      onClick: summary.needsReviewCount > 0 ? () => onJumpToReview('decisions') : () => onJumpToReview('resubmits'),
    },
    {
      label: '4. Check state coverage',
      detail: criticalGapStates.length > 0
        ? `${criticalGapStates.length} state${criticalGapStates.length === 1 ? '' : 's'} are critically under-covered.`
        : watchGapStates.length > 0
          ? `${watchGapStates.length} state${watchGapStates.length === 1 ? '' : 's'} have thin coverage but are not stop-level.`
          : 'No stop-level under-covered states.',
      status: coverageQ.isLoading ? 'waiting' : criticalGapStates.length > 0 ? 'blocked' : watchGapStates.length > 0 ? 'current' : 'done',
      action: 'Open Coverage',
      onClick: onJumpToCoverage,
    },
    {
      label: '5. Post accepted shifts to Homebase',
      detail: hasPublishRows
        ? `${summary.homebaseShifts}/${summary.totalShifts} shifts posted to Homebase.`
        : 'Homebase posting starts after the shift list is built.',
      status: !workbenchReady ? 'waiting' : homebasePct === 100 ? 'done' : 'current',
      action: 'Open Publish',
      onClick: () => onJumpToPublish(),
    },
    {
      label: '6. Transfer posted shifts to EHR',
      detail: hasPublishRows
        ? `${summary.ehrShifts}/${summary.totalShifts} shifts confirmed in EHR.`
        : 'EHR transfer starts after Homebase posting.',
      status: !workbenchReady || homebasePct < 100 ? 'waiting' : ehrPct === 100 ? 'done' : 'current',
      action: 'Open Publish',
      onClick: () => onJumpToPublish(),
    },
  ];

  const softWarnings = useMemo<OperatorBlocker[]>(() => {
    const out: OperatorBlocker[] = [];
    if (watchGapStates.length > 0 && criticalGapStates.length === 0) {
      out.push({
        label: `${watchGapStates.length} state${watchGapStates.length === 1 ? '' : 's'} with thin coverage`,
        detail: 'Continue only if approved; ask the ClinOps lead whether extra hours are needed before launch.',
        category: 'Escalate to ClinOps lead',
        action: 'Open Coverage',
        onClick: onJumpToCoverage,
      });
    }
    return out;
  }, [
    criticalGapStates.length,
    watchGapStates.length,
    onJumpToCoverage,
  ]);

  type ActionCenterItem = {
    key: string;
    label: string;
    value: string;
    detail: string;
    badge: string;
    action: string;
    onClick: () => void;
    tone: string;
    disabled?: boolean;
    loading?: boolean;
  };

  const actionItems = useMemo<ActionCenterItem[]>(() => {
    const out: ActionCenterItem[] = [];
    if (pendingSubmissionCount > 0) {
      out.push({
        key: 'pending',
        label: 'Needs recalculation',
        value: pendingSubmissionCount.toString(),
        detail: `${pendingSubmissionHours.toFixed(1)} submitted hour${pendingSubmissionHours.toFixed(1) === '1.0' ? '' : 's'} need a schedule decision. Recalculate to move them into accepted, declined, or needs review.`,
        badge: 'Rebuild schedule',
        action: 'Open Pending Recalculation',
        onClick: () => onJumpToReview('recalculate'),
        tone: 'border-blue-200 bg-blue-50/60',
        disabled: isReevaluating,
        loading: isReevaluating,
      });
    }
    if (summary.needsReviewCount > 0) {
      out.push({
        key: 'needs-review',
        label: 'Needs decision',
        value: summary.needsReviewCount.toString(),
        detail: `${needsReviewHours.toFixed(1)} submitted hour${needsReviewHours.toFixed(1) === '1.0' ? '' : 's'} need an in-platform accept or decline decision.`,
        badge: 'Approve / decline',
        action: 'Open Needs Decision',
        onClick: () => onJumpToReview('decisions'),
        tone: 'border-orange-200 bg-orange-50/70',
      });
    }
    if (inboxNeedsReviewCount > 0) {
      out.push({
        key: 'resubmits',
        label: 'Resubmits',
        value: inboxNeedsReviewCount.toString(),
        detail: 'Changed availability is waiting to be approved or parked before the schedule is final.',
        badge: 'Approve / park',
        action: 'Open Resubmits',
        onClick: () => onJumpToReview('resubmits'),
        tone: 'border-sky-200 bg-sky-50/70',
      });
    }
    if (unmatchedCount > 0) {
      out.push({
        key: 'unmatched',
        label: 'Unmatched',
        value: unmatchedCount.toString(),
        detail: 'Submissions cannot be evaluated until the provider is linked to the directory.',
        badge: 'Fix match',
        action: 'Open Unmatched',
        onClick: () => onJumpToAvailability('unmatched'),
        tone: 'border-amber-200 bg-amber-50/70',
      });
    }
    if (declinedCount > 0) {
      out.push({
        key: 'declined',
        label: 'Declined hours',
        value: `${declinedHours.toFixed(1)} hrs`,
        detail: `${declinedCount} provider${declinedCount === 1 ? '' : 's'} have declined or trimmed hours. Review why before answering coverage questions.`,
        badge: 'Explain cuts',
        action: 'Review Cut / Declined',
        onClick: onJumpToDeclined,
        tone: 'border-red-200 bg-red-50/60',
      });
    }
    if (missingCount > 0) {
      out.push({
        key: 'missing',
        label: 'Missing submissions',
        value: missingCount.toString(),
        detail: `${missingCount} provider${missingCount === 1 ? '' : 's'} still need outreach for ${formatMonthLabel(month)} availability.`,
        badge: 'Chase',
        action: 'Open Missing',
        onClick: () => onJumpToAvailability('missing'),
        tone: 'border-slate-200 bg-slate-50',
      });
    }
    return out;
  }, [
    declinedCount,
    declinedHours,
    inboxNeedsReviewCount,
    isReevaluating,
    missingCount,
    month,
    needsReviewHours,
    onJumpToAvailability,
    onJumpToDeclined,
    onJumpToReview,
    pendingSubmissionCount,
    pendingSubmissionHours,
    summary.needsReviewCount,
    unmatchedCount,
  ]);

  const lastUpdated = useMemo(() => {
    const ts = coverageQ.dataUpdatedAt || Date.now();
    return new Date(ts).toLocaleString();
  }, [coverageQ.dataUpdatedAt]);

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
              <div className="font-medium">Publish gate</div>
              <div className="text-xs opacity-90">{blocker}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-right max-w-[260px]">
              <div className="font-medium">One next action</div>
              <Badge variant="outline" className="mt-1 bg-white/70 text-[11px]">
                {nextCategory}
              </Badge>
              <div className="opacity-90">{nextAction}</div>
            </div>
            <Button size="sm" onClick={nextActionJump} disabled={nextDisabled}>
              {nextDisabled ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Go
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <ReadinessTaskLauncher
        tasks={[
          {
            label: 'Check publish readiness',
            detail: 'Show the current gate, blocker, and next action.',
            onClick: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
          },
          {
            label: 'Review changed hours',
            detail: 'Compare prior vs new provider submissions.',
            onClick: () => onJumpToReview('resubmits'),
          },
          {
            label: 'Approve flagged hours',
            detail: 'Resolve invalid times or unusual-hour flags.',
            onClick: () => onJumpToReview('decisions'),
          },
          {
            label: 'Chase missing submissions',
            detail: 'Copy reminders or mark outreach sent.',
            onClick: () => onJumpToAvailability('missing'),
          },
          {
            label: 'Explain cut hours',
            detail: 'See why submitted hours were trimmed.',
            onClick: onJumpToDeclined,
          },
          {
            label: 'Check a provider',
            detail: 'Search submitted, accepted, review, and publish status.',
            onClick: () => document.getElementById('scheduling-provider-search')?.focus(),
          },
          {
            label: 'Publish to Homebase / EHR',
            detail: 'Work the publish queue and history.',
            onClick: () => onJumpToPublish(),
          },
        ]}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-blue-600" />
            Action required
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Accepted hours need no action here. These are the places to clear pending, review, declined, missing, or mismatched hours.
          </p>
        </CardHeader>
        <CardContent>
          {actionItems.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              No pending review actions for {formatMonthLabel(month)}. Use Publish when the gate is ready.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {actionItems.map(item => (
                <div key={item.key} className={`rounded-md border px-3 py-3 ${item.tone}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-950">{item.value}</div>
                    </div>
                    <Badge variant="outline" className="bg-white text-[11px]">
                      {item.badge}
                    </Badge>
                  </div>
                  <div className="mt-2 min-h-[36px] text-xs text-muted-foreground">{item.detail}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 h-8 bg-white/80"
                    onClick={item.onClick}
                    disabled={item.disabled}
                  >
                    {item.loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    {item.action}
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SourceOfTruthPanel />

      <Card className="border-sky-200 bg-sky-50/40">
        <CardContent className="py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-sky-700" />
              Known scheduling exceptions
            </div>
            <div className="text-xs text-muted-foreground">
              Richard Rash, Margo / Margaret Mulgrew, Shashai, and admin-only provider exemptions are tracked in Exceptions.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={onJumpToExceptions}>
            Open Exceptions
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)] gap-4">
        <OperatorWorkflowCard steps={workflowSteps} />
        <OperatorBlockersCard
          hardBlockers={hardBlockers}
          softWarnings={softWarnings}
          isLoading={checksLoading}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Hours needed"
          value={demandHours ? `${demandHours.toFixed(0)} hrs` : '—'}
          sub={`${formatMonthLabel(month)} state targets incl. access buffer`}
        />
        <SummaryCard
          label="Expanded submitted"
          value={submittedHours ? `${submittedHours.toFixed(0)} hrs` : '—'}
          sub="Recurring expanded minus off dates"
        />
        <SummaryCard
          label="Accepted usable"
          value={acceptedHours ? `${acceptedHours.toFixed(0)} hrs` : '—'}
          sub={acceptedPct !== null ? `${acceptedPct}% total · ${formatSignedCoverageHours(netCoverageHours)} net` : undefined}
        />
        <SummaryCard
          label={stateGapHours > 0 ? 'State-specific shortage' : 'State coverage surplus'}
          value={`${(stateGapHours > 0 ? stateGapHours : stateSurplusHours).toFixed(0)} hrs`}
          sub={
            stateGapHours > 0
              ? `${stateSurplusHours.toFixed(0)} hrs extra elsewhere`
              : `${formatSignedCoverageHours(netCoverageHours)} net accepted`
          }
        />
      </div>

      {stateGapHours > 0 && acceptedPct !== null && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="py-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="space-y-3">
                <div className="text-sm font-medium">
                  Total accepted can be over target while specific states are still short.
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatMonthLabel(month)} is {acceptedPct}% accepted overall, but {stateGapHours.toFixed(0)} hrs are still short in
                  specific states. The {stateSurplusHours.toFixed(0)} extra hrs in over-covered states do not cover those gaps because
                  hours only count where the shift is assigned and the provider is eligible. Non-protected surplus blocks are split or cut;
                  remaining extra should come from Friday PM/weekend coverage protected before monthly trimming or explicit out-of-forecast scope.
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-medium text-red-800">Short states</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {shortStateRows.slice(0, 6).map(row => (
                        <Badge key={row.state} variant="outline" className="bg-white/80 text-red-800">
                          {row.state} {row.shortage.toFixed(0)} hrs short
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-blue-800">Remaining extra by state</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {surplusStateRows.slice(0, 6).map(row => (
                        <Badge key={row.state} variant="outline" className="bg-white/80 text-blue-800">
                          {row.state} +{row.surplus.toFixed(0)} hrs
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={onJumpToCoverage} className="shrink-0">
              Open State Breakdown
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Missing submissions"
          value={String(missingCount)}
          sub={`Providers without ${formatMonthLabel(month)} hours`}
        />
        <SummaryCard
          label="Needs decision"
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
              Critically under-covered states
            </CardTitle>
          </CardHeader>
          <CardContent>
            {coverageQ.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : criticalGapStates.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No state is critically under-covered.
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
              Review coverage
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

function ReadinessTaskLauncher({
  tasks,
}: {
  tasks: { label: string; detail: string; onClick: () => void }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <PlayCircle className="h-4 w-4 text-emerald-700" />
          I need to...
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {tasks.map(task => (
            <button
              key={task.label}
              type="button"
              className="rounded-md border bg-background px-3 py-2 text-left transition-colors hover:bg-muted"
              onClick={task.onClick}
            >
              <div className="text-sm font-medium">{task.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">{task.detail}</div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SourceOfTruthPanel() {
  const sources = [
    {
      label: 'Jotform',
      owns: 'Submitted availability',
      detail: 'Provider-requested hours, days off, notes, and resubmissions.',
    },
    {
      label: 'Lovable',
      owns: 'Schedule decisions',
      detail: 'Accepted hours, needs decision, cut / declined hours, and recommendations.',
    },
    {
      label: 'Homebase / EHR',
      owns: 'Posted schedule tracking',
      detail: 'Manual publish progress for accepted shifts after the schedule is ready.',
    },
    {
      label: 'Metabase',
      owns: 'Forecast inputs',
      detail: 'State demand, service-line targets, utilization, and access-risk inputs.',
    },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-sky-700" />
          Source of truth
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-4">
          {sources.map(source => (
            <div key={source.label} className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-sm font-semibold">{source.label}</div>
              <div className="mt-1 text-xs font-medium">{source.owns}</div>
              <div className="mt-1 text-xs text-muted-foreground">{source.detail}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OperatorWorkflowCard({
  steps,
}: {
  steps: {
    label: string;
    detail: string;
    status: 'done' | 'current' | 'blocked' | 'waiting';
    action?: string;
    onClick?: () => void;
    disabled?: boolean;
  }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-emerald-600" />
          Staff workflow
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Use the publish gate above for the next action. This checklist shows where that action sits in the full process.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map(step => (
          <div
            key={step.label}
            className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex items-start gap-2">
              <OperatorStepIcon status={step.status} />
              <div>
                <div className="text-sm font-medium">{step.label}</div>
                <div className="text-xs text-muted-foreground">{step.detail}</div>
              </div>
            </div>
            {step.action && step.onClick && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={step.onClick}
                disabled={step.disabled}
              >
                {step.disabled ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {step.action}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function OperatorStepIcon({
  status,
}: {
  status: 'done' | 'current' | 'blocked' | 'waiting';
}) {
  if (status === 'done') return <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />;
  if (status === 'blocked') return <AlertCircle className="mt-0.5 h-4 w-4 text-red-600" />;
  if (status === 'current') return <PlayCircle className="mt-0.5 h-4 w-4 text-blue-600" />;
  return <CircleDot className="mt-0.5 h-4 w-4 text-muted-foreground" />;
}

function OperatorBlockersCard({
  hardBlockers,
  softWarnings,
  isLoading,
}: {
  hardBlockers: {
    label: string;
    detail: string;
    category: string;
    action: string;
    onClick: () => void;
  }[];
  softWarnings: {
    label: string;
    detail: string;
    category: string;
    action: string;
    onClick: () => void;
  }[];
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Blockers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Stop before publishing
          </div>
          <div className="mt-2 space-y-2">
            {isLoading ? (
              <div className="text-xs text-muted-foreground">Checking readiness data...</div>
            ) : hardBlockers.length === 0 ? (
              <div className="flex items-start gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                No stop items. Use the Publish tab to work the queue.
              </div>
            ) : (
              hardBlockers.map(item => (
                <div key={item.label} className="rounded-md border border-red-200 bg-red-50 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-red-800">{item.label}</div>
                    <Badge variant="outline" className="bg-white text-[11px]">
                      {item.category}
                    </Badge>
                  </div>
                  <div className="text-xs text-red-700 mt-1">{item.detail}</div>
                  <Button size="sm" variant="outline" className="mt-2 h-7" onClick={item.onClick}>
                    {item.action}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Continue while publishing
          </div>
          <div className="mt-2 space-y-2">
            {softWarnings.length === 0 ? (
              <div className="text-xs text-muted-foreground">No chase list items right now.</div>
            ) : (
              softWarnings.map(item => (
                <div key={item.label} className="rounded-md border border-amber-200 bg-amber-50 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-amber-900">{item.label}</div>
                    <Badge variant="outline" className="bg-white text-[11px]">
                      {item.category}
                    </Badge>
                  </div>
                  <div className="text-xs text-amber-800 mt-1">{item.detail}</div>
                  <Button size="sm" variant="outline" className="mt-2 h-7" onClick={item.onClick}>
                    {item.action}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PublishInstructionsCard() {
  const steps = [
    'Post accepted shifts to Homebase.',
    'Mark Homebase complete in the Workbench.',
    'Post the same accepted shifts to EHR.',
    'Mark EHR complete in the Workbench.',
  ];
  return (
    <Card className="border-blue-200 bg-blue-50/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Publish steps</CardTitle>
        <p className="text-xs text-blue-900">
          Do not publish until Readiness says it is OK to publish, unless a ClinOps lead explicitly tells you to continue.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-4">
          {steps.map((step, index) => (
            <div key={step} className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs">
              <div className="font-medium text-blue-900">Step {index + 1}</div>
              <div className="mt-1 text-blue-800">{step}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PublishGateBanner({
  month,
  summary,
  submittedHours,
  inboxNeedsReviewCount,
  unmatchedCount,
  missingCount,
  onJumpToAvailability,
  onJumpToReview,
  onJumpToCoverage,
}: {
  month: string;
  summary: {
    totalShifts: number;
    homebaseShifts: number;
    ehrShifts: number;
    needsReviewCount: number;
  };
  submittedHours: number;
  inboxNeedsReviewCount: number;
  unmatchedCount: number;
  missingCount: number;
  onJumpToAvailability: (tab?: AvailabilityTabKey) => void;
  onJumpToReview: (tab?: ReviewTabKey) => void;
  onJumpToCoverage: () => void;
}) {
  const coverageQ = useStateCoverage(month);
  const coverageRows = useMemo(() => coverageQ.data?.rows ?? [], [coverageQ.data]);
  const criticalGapStates = useMemo(
    () => coverageRows.filter(r => r.needed > 0 && r.pct_filled < 60),
    [coverageRows],
  );
  const reviewCount = summary.needsReviewCount + inboxNeedsReviewCount;

  const stopItems = useMemo(() => {
    const out: {
      label: string;
      action: string;
      onClick: () => void;
    }[] = [];
    if (coverageQ.isError) {
      out.push({
        label: 'Coverage failed to load. Open Coverage Gaps and reload before publishing.',
        action: 'Open Coverage',
        onClick: onJumpToCoverage,
      });
    } else if (!coverageQ.isLoading && coverageRows.length === 0) {
      out.push({
        label: 'No coverage rows exist for this month.',
        action: 'Open Coverage',
        onClick: onJumpToCoverage,
      });
    }
    if (!summary.totalShifts) {
      out.push({
        label: submittedHours > 0
          ? 'No publishable shifts yet. Click Recalculate schedule in the header.'
          : 'No usable availability has been expanded yet.',
        action: 'Open Availability',
        onClick: () => onJumpToAvailability('submissions'),
      });
    }
    if (summary.totalShifts > 0 && unmatchedCount > 0) {
      out.push({
        label: `${unmatchedCount} unmatched submission${unmatchedCount === 1 ? '' : 's'} must be fixed or escalated first.`,
        action: 'Open Unmatched',
        onClick: () => onJumpToAvailability('unmatched'),
      });
    }
    if (reviewCount > 0) {
      out.push({
        label: `${reviewCount} review item${reviewCount === 1 ? '' : 's'} must be escalated to a ClinOps lead first.`,
        action: summary.needsReviewCount > 0 ? 'Open Needs Decision' : 'Open Resubmits',
        onClick: summary.needsReviewCount > 0 ? () => onJumpToReview('decisions') : () => onJumpToReview('resubmits'),
      });
    }
    if (criticalGapStates.length > 0) {
      out.push({
        label: `Critically under-covered state: ${criticalGapStates.slice(0, 5).map(s => `${s.state} ${Math.round(s.pct_filled)}%`).join(', ')}${criticalGapStates.length > 5 ? ', plus more' : ''}.`,
        action: 'Open Coverage',
        onClick: onJumpToCoverage,
      });
    }
    if (missingCount > 0) {
      out.push({
        label: `${missingCount} provider${missingCount === 1 ? '' : 's'} still need ${formatMonthLabel(month)} availability reminders.`,
        action: 'Open Missing',
        onClick: () => onJumpToAvailability('missing'),
      });
    }
    return out;
  }, [
    coverageQ.isError,
    coverageQ.isLoading,
    coverageRows.length,
    summary.totalShifts,
    summary.needsReviewCount,
    submittedHours,
    unmatchedCount,
    missingCount,
    reviewCount,
    criticalGapStates,
    month,
    onJumpToAvailability,
    onJumpToCoverage,
    onJumpToReview,
  ]);

  if (coverageQ.isLoading) {
    return (
      <Alert className="border-slate-200 bg-slate-50">
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription>
          Checking coverage before publishing...
        </AlertDescription>
      </Alert>
    );
  }

  if (stopItems.length > 0) {
    return (
      <Alert variant="destructive" className="bg-red-50">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <div className="font-medium">Stop before publishing</div>
          <div className="mt-1 text-xs">
            {stopItems[0].label}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {stopItems.slice(0, 3).map(item => (
              <Button key={item.label} size="sm" variant="outline" onClick={item.onClick}>
                {item.action}
              </Button>
            ))}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const homebaseLeft = Math.max(0, summary.totalShifts - summary.homebaseShifts);
  const ehrLeft = Math.max(0, summary.totalShifts - summary.ehrShifts);
  const title =
    homebaseLeft > 0
      ? 'Ready for Homebase'
      : ehrLeft > 0
        ? 'Homebase complete - finish EHR'
        : 'Publishing complete';
  const body =
    homebaseLeft > 0
      ? `${homebaseLeft} shift${homebaseLeft === 1 ? '' : 's'} still need to be posted to Homebase.`
      : ehrLeft > 0
        ? `${ehrLeft} Homebase-posted shift${ehrLeft === 1 ? '' : 's'} still need EHR confirmation.`
        : `All ${summary.totalShifts} shift${summary.totalShifts === 1 ? '' : 's'} are posted and confirmed.`;

  return (
    <Alert className="border-emerald-200 bg-emerald-50">
      <CheckCircle2 className="h-4 w-4 text-emerald-700" />
      <AlertDescription>
        <div className="font-medium text-emerald-900">{title}</div>
        <div className="mt-1 text-xs text-emerald-800">{body}</div>
      </AlertDescription>
    </Alert>
  );
}

function CostPerVisitPanel({
  month,
  rows,
  payRates,
  isLoading,
}: {
  month: string;
  rows: ProviderPublishView[];
  payRates: ProviderPayRateRow[];
  isLoading: boolean;
}) {
  const upsertRate = useUpsertProviderPayRate();
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});

  const model = useMemo(
    () =>
      buildSchedulingCostModel({
        monthStart: month,
        payRates,
        rows: rows.map(row => ({
          provider_id: row.provider_id,
          provider_name: row.provider_name,
          profession: row.profession,
          employment_type: row.employment_type,
          provider_source: row.provider_source,
          decision_status: row.submission?.decision_status ?? null,
          accepted_hours: row.submission?.accepted_hours ?? null,
          declined_hours: row.submission?.declined_hours ?? null,
          decision_notes: row.submission?.decision_notes ?? null,
        })),
      }),
    [month, payRates, rows],
  );

  const actionableRows = useMemo(
    () => model.providerRows.filter(row => row.acceptedHours > 0 || row.declinedHours > 0),
    [model.providerRows],
  );

  const setDraft = (providerId: string, value: string) => {
    setRateDrafts(current => ({ ...current, [providerId]: value }));
  };

  const saveDraft = (row: SchedulingCostProviderRow) => {
    const raw = rateDrafts[row.provider_id];
    const hourlyRate = Number(raw);
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
      toast.error('Enter a valid hourly rate');
      return;
    }
    upsertRate.mutate(
      {
        providerId: row.provider_id,
        hourlyRate,
        effectiveFrom: month,
        source: 'manual_workbench',
      },
      {
        onSuccess: () => {
          toast.success(`Saved ${formatCurrency(hourlyRate, 2)}/hr for ${row.provider_name}`);
          setRateDrafts(current => {
            const next = { ...current };
            delete next[row.provider_id];
            return next;
          });
        },
        onError: error => toast.error(`Could not save rate: ${(error as Error).message}`),
      },
    );
  };

  if (isLoading) {
    return <LoadingRow label="Loading cost per visit" />;
  }

  if (model.providerRows.length === 0) {
    return (
      <EmptyState
        title={`No scheduling decisions for ${formatMonthLabel(month)} yet`}
        body="Recalculate the schedule after availability submissions are loaded. This view uses accepted hours and provider rates from those monthly decisions."
      />
    );
  }

  const h = model.highlights;
  const missingCount = model.missingRateRows.length;
  const cpvSub =
    missingCount > 0
      ? `${formatHours(model.knownRateHours)} known-rate hrs; ${formatHours(model.missingRateHours)} hrs excluded until rates are entered`
      : `${formatHours(model.knownRateHours)} known-rate hrs at 70% utilization`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-700" />
            Cost / Visit · {formatMonthLabel(month)}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Uses accepted provider hours for this month. Standard care uses 2 visits/hr; mental health coach, therapist, and LPC rows use 3 visits per 2.5h shift. CPV assumes 70% target utilization.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <CostMetricCard
              label="CPV @ 70%"
              value={formatCurrency(model.costPerVisitAtTarget, 2)}
              sub={cpvSub}
              tone={missingCount > 0 ? 'warn' : 'good'}
            />
            <CostMetricCard
              label="Approved hours"
              value={formatHours(model.totalApprovedHours)}
              sub="Accepted provider hours"
              tone="neutral"
            />
            <CostMetricCard
              label="Available slots"
              value={formatWholeNumber(model.totalAvailableSlots)}
              sub="Standard 2/hr; MH 3 per 2.5h"
              tone="neutral"
            />
            <CostMetricCard
              label="Visits @ 70%"
              value={formatWholeNumber(model.totalTargetUtilizedVisits)}
              sub="Target-utilized slot capacity"
              tone="neutral"
            />
            <CostMetricCard
              label="Known wage cost"
              value={formatCurrency(model.totalKnownWageCost)}
              sub={missingCount > 0 ? `${missingCount} provider${missingCount === 1 ? '' : 's'} excluded` : 'All accepted hours rated'}
              tone={missingCount > 0 ? 'warn' : 'good'}
            />
          </div>

          {missingCount > 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-xs text-amber-900">
                CPV excludes {formatHours(model.missingRateHours)} accepted hour{model.missingRateHours === 1 ? '' : 's'} without a provider rate.
                Enter rates below to sync them to provider_pay_rates and refresh this estimate.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {missingCount > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Missing rates</CardTitle>
            <p className="text-xs text-muted-foreground">
              These accepted hours are counted in capacity, but excluded from wage cost until a rate is saved.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Accepted hrs</TableHead>
                  <TableHead className="text-right">Slots</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.missingRateRows.map(row => (
                  <TableRow key={row.provider_id}>
                    <TableCell>
                      <div className="font-medium">{row.provider_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.profession ?? '—'}
                        {row.employment_type ? ` · ${row.employment_type}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatHours(row.acceptedHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatWholeNumber(row.availableSlots)}</TableCell>
                    <TableCell>
                      <div className="relative max-w-40">
                        <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">$</span>
                        <Input
                          inputMode="decimal"
                          value={rateDrafts[row.provider_id] ?? ''}
                          onChange={event => setDraft(row.provider_id, event.target.value)}
                          placeholder="Hourly rate"
                          className="pl-7"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => saveDraft(row)}
                        disabled={upsertRate.isPending || !rateDrafts[row.provider_id]}
                      >
                        {upsertRate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <RoutingDecisionCard
          label="Lower-rate providers used"
          value={`${h.lowerRateAcceptedProviders}`}
          detail={`${formatHours(h.lowerRateAcceptedHours)} accepted hrs followed the lowest-rate routing rule.`}
          tone="good"
        />
        <RoutingDecisionCard
          label="Higher-rate/capacity cuts"
          value={`${h.higherRateDeprioritizedProviders}`}
          detail={`${formatHours(h.higherRateDeprioritizedHours)} hrs cut or deprioritized; est. ${formatCurrency(h.estimatedCutCost)} in avoided wages.`}
          tone={h.higherRateDeprioritizedProviders > 0 ? 'warn' : 'neutral'}
        />
        <RoutingDecisionCard
          label="Clinical lead overrides"
          value={`${h.clinicalLeadProviders}`}
          detail={`${formatHours(h.clinicalLeadHours)} hrs kept ahead of rate ranking for clinical lead priority.`}
          tone={h.clinicalLeadProviders > 0 ? 'blue' : 'neutral'}
        />
        <RoutingDecisionCard
          label="DirectShifts/access share"
          value={`${h.directshiftsAccessSharePct.toFixed(1)}%`}
          detail={`${formatHours(h.directshiftsAccessHours)} hrs accepted for ${h.directshiftsAccessProviders} provider${h.directshiftsAccessProviders === 1 ? '' : 's'}; target ${h.directshiftsTargetSharePct.toFixed(0)}%.`}
          tone={h.directshiftsAccessSharePct + 0.5 >= h.directshiftsTargetSharePct ? 'good' : 'warn'}
        />
        <RoutingDecisionCard
          label="Same-rate DS spread"
          value={`${h.sameRateDirectshiftsMaxSpreadPct.toFixed(1)}%`}
          detail={`${h.sameRateDirectshiftsGroups} same-rate DirectShifts/access group${h.sameRateDirectshiftsGroups === 1 ? '' : 's'} checked by accepted share of submitted hours.`}
          tone={h.sameRateDirectshiftsMaxSpreadPct <= 10 ? 'good' : 'warn'}
        />
        <RoutingDecisionCard
          label="Equity floors"
          value={`${h.equityFloorMetProviders}`}
          detail={`${h.equityFloorUnmetProviders} eligible submitter${h.equityFloorUnmetProviders === 1 ? '' : 's'} could not receive a floor because no valid compatible demand remained.`}
          tone={h.equityFloorUnmetProviders > 0 ? 'warn' : 'good'}
        />
        <RoutingDecisionCard
          label="Soft cap relaxed"
          value={`${h.softCapExceededProviders}`}
          detail="Providers allowed beyond 75% of submitted forecastable hours only after under-cap peers could not cover demand."
          tone={h.softCapExceededProviders > 0 ? 'warn' : 'neutral'}
        />
        <RoutingDecisionCard
          label="Utilization tie-breaks"
          value={`${h.utilizationTieBreakProviders}`}
          detail="Providers whose decisions explicitly used utilization as a tie-break."
          tone={h.utilizationTieBreakProviders > 0 ? 'blue' : 'neutral'}
        />
        <RoutingDecisionCard
          label="Access protected"
          value={`${h.protectedAccessProviders}`}
          detail={`${formatHours(h.protectedAccessHours)} protected hrs from Friday afternoon, weekend, or access-buffer slices.`}
          tone={h.protectedAccessProviders > 0 ? 'good' : 'neutral'}
        />
        <RoutingDecisionCard
          label="Missing-rate risk"
          value={`${h.missingRateProviders}`}
          detail={`${formatHours(h.missingRateHours)} accepted hrs need a rate before the CPV estimate is complete.`}
          tone={h.missingRateProviders > 0 ? 'warn' : 'good'}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Provider cost and routing detail</CardTitle>
          <p className="text-xs text-muted-foreground">
            Provider-level view of accepted hours, wage rate, projected cost, and the concise routing signals behind the decision.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Declined</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                  <TableHead className="text-right">CPV @ 70%</TableHead>
                  <TableHead>Routing tags</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actionableRows.map(row => (
                  <CostProviderTableRow key={row.provider_id} row={row} />
                ))}
                {actionableRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-xs text-muted-foreground">
                      No accepted or declined hours are available for this month yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CostMetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-foreground';
  return (
    <div className="rounded-md border bg-background px-3 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-1 min-h-8 text-xs leading-snug text-muted-foreground">{sub}</div>
    </div>
  );
}

function RoutingDecisionCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'good' | 'warn' | 'blue' | 'neutral';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'blue'
          ? 'text-blue-700'
          : 'text-foreground';
  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className="mt-1 text-xs leading-snug text-muted-foreground">{detail}</div>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function CostProviderTableRow({ row }: { row: SchedulingCostProviderRow }) {
  const details = formatDecisionNoteForStaff(row.decisionDetails);
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{row.provider_name}</div>
        <div className="text-xs text-muted-foreground">
          {row.profession ?? '—'}
          {row.employment_type ? ` · ${row.employment_type}` : ''}
          {row.provider_source ? ` · ${row.provider_source}` : ''}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={row.decision_status as DecisionStatus | null | undefined} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatHours(row.acceptedHours)}</TableCell>
      <TableCell className={`text-right tabular-nums ${row.declinedHours > 0 ? 'text-red-700' : ''}`}>
        {formatHours(row.declinedHours)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.hourlyRate != null ? (
          <>
            {formatCurrency(row.hourlyRate, 2)}
            <div className="text-[11px] text-muted-foreground">{row.rateSourceLabel}</div>
          </>
        ) : (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
            Missing
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatCurrency(row.wageCost)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCurrency(row.costPerVisitAtTarget, 2)}
        <div className="text-[11px] text-muted-foreground">{row.visitSlotModelLabel}</div>
      </TableCell>
      <TableCell className="min-w-52">
        <div className="flex flex-wrap gap-1">
          {row.routingTags.slice(0, 4).map(tag => (
            <Badge key={tag} variant="outline" className="text-[11px] font-medium">
              {tag}
            </Badge>
          ))}
          {row.routingTags.length > 4 && (
            <Badge variant="outline" className="text-[11px] font-medium">
              +{row.routingTags.length - 4}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="min-w-64 max-w-80 text-xs text-muted-foreground">
        {details ? (
          <details>
            <summary className="cursor-pointer">Details</summary>
            <div className="mt-1 whitespace-pre-wrap rounded bg-muted/60 p-2 leading-snug">
              {details}
            </div>
          </details>
        ) : (
          '—'
        )}
      </TableCell>
    </TableRow>
  );
}

function ForecastPanel({ month }: { month: string }) {
  const forecastDemandQ = useMonthlyDemand(month);
  const serviceLineQ = useMonthlyServiceLineDemand(month);
  const slaQ = useMonthlySlaRisk(month);
  const demandRows = forecastDemandQ.data;
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

  if (forecastDemandQ.isLoading) {
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
        body="The accepted shift list has not been connected to state coverage yet. Next: click 'Recalculate schedule' in the header, then come back. If it still does not load, ask an admin for help."
      />
    );
  }

  const sorted = [...rows].sort((a, b) => a.pct_filled - b.pct_filled);
  const criticalRows = sorted.filter(r => r.needed > 0 && r.pct_filled < 60);
  const watchRows = sorted.filter(r => r.needed > 0 && r.pct_filled >= 60 && r.pct_filled < 95);
  const totalGap = rows.reduce((sum, r) => sum + Math.max(0, r.needed - r.filled), 0);

  const guidanceFor = (row: StateCoverageRow): { label: 'Stop' | 'Watch' | 'OK' | 'Extra'; className: string; action: string } => {
    const shortage = Math.max(0, row.needed - row.filled);
    if (row.filled > row.needed && row.needed > 0) {
      return {
        label: 'Extra',
        className: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
        action: 'Over target after split/cut pass. Check for protected Friday/weekend coverage or out-of-forecast scope.',
      };
    }
    if (row.needed > 0 && row.pct_filled < 60) {
      return {
        label: 'Stop',
        className: 'bg-red-100 text-red-800 hover:bg-red-100',
        action: `Escalate to ClinOps lead before publishing. ${Math.ceil(shortage)} more hour${Math.ceil(shortage) === 1 ? '' : 's'} needed.`,
      };
    }
    if (row.needed > 0 && row.pct_filled < 95) {
      return {
        label: 'Watch',
        className: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
        action: `Continue only if approved. ${Math.ceil(shortage)} more hour${Math.ceil(shortage) === 1 ? '' : 's'} would improve coverage.`,
      };
    }
    return {
      label: 'OK',
      className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
      action: 'Covered. No scheduler action needed.',
    };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          State coverage guidance · {formatMonthLabel(month)}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          This tells the scheduling team whether publishing can continue. Midpoint demand targets are treated as the final monthly need.
          Non-protected surplus blocks are split or cut before publish; any remaining extra should be protected Friday/weekend coverage or explicit out-of-forecast scope.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-y bg-muted/30 px-4 py-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <CoverageStat label="Stop states" value={String(criticalRows.length)} tone={criticalRows.length > 0 ? 'bad' : 'good'} />
            <CoverageStat label="Watch states" value={String(watchRows.length)} tone={watchRows.length > 0 ? 'warn' : 'good'} />
            <CoverageStat label="Hours still needed" value={`${totalGap.toFixed(0)} hrs`} tone={totalGap > 0 ? 'warn' : 'good'} />
            <CoverageStat label="Accepted providers" value={String(acceptedRows.length)} tone="neutral" />
            <CoverageStat label="Missing availability" value={String(missingRows.length)} tone={missingRows.length > 0 ? 'warn' : 'good'} />
          </div>
          {criticalRows.length > 0 && (
            <Alert variant="destructive" className="mt-3 bg-red-50">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Stop before publishing. Escalate these critically under-covered states to the ClinOps lead:
                {' '}
                {criticalRows.slice(0, 8).map(r => `${r.state} ${Math.round(r.pct_filled)}%`).join(', ')}
                {criticalRows.length > 8 ? ', plus more' : ''}.
              </AlertDescription>
            </Alert>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Hours needed</TableHead>
              <TableHead className="text-right">Accepted hrs</TableHead>
              <TableHead className="text-right">Short / extra</TableHead>
              <TableHead className="text-right">Coverage</TableHead>
              <TableHead className="text-right">Licensed providers</TableHead>
              <TableHead className="text-right">Missing availability</TableHead>
              <TableHead>Scheduler guidance</TableHead>
              <TableHead>Recommended action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(r => {
              const diff = r.filled - r.needed;
              const guidance = guidanceFor(r);
              return (
                <TableRow key={r.state}>
                  <TableCell className="font-medium">{r.state}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.needed.toFixed(0)}
                    {r.access_buffer_hours > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        includes extra access protection
                      </div>
                    )}
                  </TableCell>
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
                    <Badge className={guidance.className}>{guidance.label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px]">
                    {guidance.action}
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

function CoverageStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'bad'
          ? 'text-red-700'
          : 'text-foreground';
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
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

type ProviderPriorityKey =
  | 'clinical_supervisor'
  | 'vitable_internal'
  | 'directshifts_brittany_priority'
  | 'access_provider';

type ProviderPriority = {
  key: ProviderPriorityKey;
  rank: 0 | 1 | 2;
  label: string;
};

const PROVIDER_PRIORITY_BY_KEY: Record<ProviderPriorityKey, ProviderPriority> = {
  clinical_supervisor: { key: 'clinical_supervisor', rank: 0, label: 'Clinical lead/admin' },
  vitable_internal: { key: 'vitable_internal', rank: 1, label: 'Rate-ranked Vitable provider' },
  directshifts_brittany_priority: {
    key: 'directshifts_brittany_priority',
    rank: 1,
    label: 'Rate-ranked DirectShifts Brittney Afram',
  },
  access_provider: { key: 'access_provider', rank: 1, label: 'Rate-ranked access provider' },
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
  const providerNameTokens = new Set(
    row.provider_name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean),
  );
  const isNamedClinicalLeadAdmin =
    (providerNameTokens.has('genevieve') && providerNameTokens.has('teetie')) ||
    (providerNameTokens.has('shanta') && providerNameTokens.has('williams')) ||
    (providerNameTokens.has('rebecca') && providerNameTokens.has('keuch'));

  if (
    isNamedClinicalLeadAdmin ||
    haystack.includes('clinical supervisor') ||
    haystack.includes('clinical lead') ||
    haystack.includes('clinical admin') ||
    haystack.includes('clinical administrator') ||
    haystack.includes('supervisor')
  ) {
    return PROVIDER_PRIORITY_BY_KEY.clinical_supervisor;
  }
  const isBrittneyAfram =
    providerNameTokens.has('afram') &&
    (providerNameTokens.has('brittney') || providerNameTokens.has('brittany'));
  const isDirectShiftsProvider =
    employmentType === 'agency' ||
    source.includes('directshifts') ||
    source.includes('direct shifts') ||
    haystack.includes('directshifts') ||
    haystack.includes('direct shifts') ||
    haystack.includes('agency supplied') ||
    isBrittneyAfram;
  if (isDirectShiftsProvider && isBrittneyAfram) {
    return PROVIDER_PRIORITY_BY_KEY.directshifts_brittany_priority;
  }
  if (
    isDirectShiftsProvider ||
    source.includes('access') ||
    haystack.includes('access provider')
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
  const rate = providerRateFromNotes(row.submission?.decision_notes);
  if (rate != null) reasons.push(`$${rate.toFixed(2)}/hr`);
  else if (valueFromDecisionNote(row.submission?.decision_notes, 'provider_hourly_rate') === 'missing') {
    reasons.push('rate missing');
  }
  const utilization = providerUtilizationFromNotes(row.submission?.decision_notes);
  if (utilization != null) reasons.push(`${utilization.toFixed(1)}% util`);
  else if (valueFromDecisionNote(row.submission?.decision_notes, 'provider_utilization_pct') === 'missing') {
    reasons.push('util missing');
  }
  const cohort = valueFromDecisionNote(row.submission?.decision_notes, 'cohort');
  if (cohort === 'directshifts_access') reasons.push('DS/access share');
  const acceptancePct = valueFromDecisionNote(row.submission?.decision_notes, 'provider_acceptance_pct');
  const acceptancePctNumber = Number(acceptancePct);
  if (Number.isFinite(acceptancePctNumber)) reasons.push(`${acceptancePctNumber.toFixed(1)}% of submitted`);
  const equityFloor = valueFromDecisionNote(row.submission?.decision_notes, 'equity_floor');
  if (equityFloor === 'met') reasons.push('floor met');
  else if (equityFloor?.startsWith('unmet')) reasons.push('floor unmet');
  const emp = (row.employment_type ?? '').trim();
  if (emp) reasons.push(emp.toUpperCase());
  const accepted = Number(row.submission?.accepted_hours ?? 0);
  const declined = Number(row.submission?.declined_hours ?? 0);
  if (accepted > 0 && declined === 0) reasons.push('Full accept');
  if (declined > 0 && accepted > 0) reasons.push('Partial accept');
  return reasons.join(' · ') || '—';
}

function providerRateFromNotes(notes: string | null | undefined): number | null {
  const raw = valueFromDecisionNote(notes, 'provider_hourly_rate');
  if (!raw || raw === 'missing') return null;
  const rate = Number(raw);
  return Number.isFinite(rate) ? rate : null;
}

function providerRateSortValue(row: ProviderPublishView): number {
  return providerRateFromNotes(row.submission?.decision_notes) ?? Number.POSITIVE_INFINITY;
}

function providerUtilizationFromNotes(notes: string | null | undefined): number | null {
  const raw = valueFromDecisionNote(notes, 'provider_utilization_pct');
  if (!raw || raw === 'missing') return null;
  const utilization = Number(raw);
  return Number.isFinite(utilization) ? utilization : null;
}

function inferDeclineReason(row: ProviderPublishView): string {
  const notes = (row.submission?.decision_notes ?? '').trim();
  if (notes) return formatDecisionNoteForStaff(notes);
  const status = row.submission?.decision_status;
  if (status === 'declined') return 'Declined (no reason recorded - see Data Sources)';
  const declined = Number(row.submission?.declined_hours ?? 0);
  if (declined > 0) return `${declined.toFixed(1)} hrs cut`;
  return '';
}

function ProviderPriorityPolicyCard() {
  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-emerald-700" />
          Priority policy
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Order of operations: validated clinical lead hours are accepted in full first, current hourly rate routes remaining hours second, then the DirectShifts/access share target applies. DirectShifts/access now targets roughly 15% of accepted telehealth hours.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="font-medium">1. Clinical leads</div>
            <div className="text-muted-foreground">Validated clinical lead/supervisor hours are accepted in full before rate.</div>
          </div>
          <div>
            <div className="font-medium">2. Hourly rate</div>
            <div className="text-muted-foreground">Known current hourly rate is the main cost rule across provider sources.</div>
          </div>
          <div>
            <div className="font-medium">3. DirectShifts rate</div>
            <div className="text-muted-foreground">DirectShifts/access targets 15%; same-rate DirectShifts providers stay close by accepted share.</div>
          </div>
          <div>
            <div className="font-medium">4. Caps and visibility</div>
            <div className="text-muted-foreground">A 75% soft cap redistributes first. Utilization is visible only unless explicitly enabled.</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
      const ra = providerRateSortValue(a);
      const rb = providerRateSortValue(b);
      if (ra !== rb) return ra - rb;
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
      <>
        <ProviderPriorityPolicyCard />
        <EmptyState
          title={`No matching decisions yet for ${formatMonthLabel(month)}`}
          body="The matching view summarizes which providers were accepted, cut, or flagged. What's missing: at least one schedule recalculation after Jotform submissions. Next: open Availability to confirm submissions are in, then click 'Recalculate schedule' in the page header."
        />
      </>
    );
  }

  return (
    <>
      <ProviderPriorityPolicyCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider recommendations · {formatMonthLabel(month)}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Who is getting hours, why, and what was cut. The system matches providers to states
            where they can cover visits, then applies the priority policy above.
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
    </>
  );
}

// ============================================================================
// Audit / Why — explains every accept / decline / cut / needs-review
// ============================================================================

function classifyReason(text: string): string {
  const t = text.toLowerCase();
  if (!t) return 'No reason recorded';
  if (t.includes('equity_floor') || t.includes('soft_cap') || t.includes('provider_acceptance_pct'))
    return 'Equity redistribution';
  if (t.includes('directshifts_target_share') || t.includes('cohort=directshifts_access'))
    return 'DirectShifts/access share';
  if (t.includes('provider_meeting_blackout') || t.includes('provider meeting blackout'))
    return 'Provider meeting blocked';
  if (t.includes('long_shift_break') || t.includes('mandatory 1-hour break'))
    return 'Required shift break';
  if (t.includes('unavailable_override'))
    return 'Availability correction';
  if (t.includes('directshifts_brittany_priority'))
    return 'DirectShifts Brittney Afram priority';
  if (t.includes('access_growth_buffer') || t.includes('access buffer'))
    return 'Extra access protection';
  if (t.includes('scarce_window') || t.includes('scarce coverage'))
    return 'Friday/weekend access protected';
  if (t.includes('outside') && t.includes('business')) return 'Outside business hours';
  if (t.includes('capacity') || t.includes('oversupply') || t.includes('surplus'))
    return 'State already covered';
  if (t.includes('unavailable') || t.includes('off-day') || t.includes('off day'))
    return 'Provider unavailable';
  if (t.includes('license') || t.includes('licensure')) return 'License issue';
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
    ['Metabase source', 'cards 2974 / 2973 / 2971 / 2940 → compute-demand-forecast → demand_forecast / state_demand_targets / service_line_demand_targets / provider_state_active', 'Forecast, Readiness, Coverage, Source audit, state coverage'],
    ['Jotform availability', 'sync-jotform-submissions → schedule_submissions.raw_answers / parsed_shifts', 'Source of truth for requested monthly provider hours, Matching, Audit'],
    ['Demand forecast', 'compute-demand-forecast → demand_forecast → state_demand_targets', 'Forecast, Readiness, Coverage'],
    ['Provider directory', 'providers', 'Missing submissions, Setup, Matching'],
    ['Medallion licensure', 'sync-medallion-licenses → medallion_provider_licenses → v_provider_state_eligibility', 'State coverage, licensed-provider counts, Source audit'],
    ['DirectShifts licensure', 'directshifts_provider_licenses → v_provider_state_eligibility', 'State coverage, licensed-provider counts, Source audit'],
    ['ClinOps licensure', 'provider_licenses → v_provider_state_eligibility', 'State coverage, licensed-provider counts'],
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
      label: 'State needs hours but has no licensed providers',
      count: demandWithoutEligibleProviders.length,
      detail: demandWithoutEligibleProviders.slice(0, 5).map(r => r.state).join(', '),
    },
    {
      label: 'Accepted providers missing publish rows',
      count: missingPublishRows,
      detail: missingPublishRows ? 'Recalculate schedule to create accepted shift rows' : '',
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
        reasonText: formatDecisionNoteForStaff(note) || 'Accepted in full',
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
      reasonText: formatDecisionNoteForStaff(note) || 'Declined (no reason recorded)',
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
      reasonText: formatDecisionNoteForStaff(note) || 'Flagged for manual review',
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
          body="Once the schedule is recalculated, every accept / decline / cut shows up here with a plain-English reason. Next: confirm submissions are in on Availability, then click 'Recalculate schedule'."
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
