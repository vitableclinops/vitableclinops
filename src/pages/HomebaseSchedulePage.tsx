import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppSidebar } from '@/components/AppSidebar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import type { ClinOpsTables } from '@/integrations/supabase/clinopsTypes';
import { IssueActions } from '@/components/scheduling/IssueActions';
import {
  useReconciliationOverrides,
  type ReconciliationOverrideRow,
} from '@/hooks/useReconciliationOverrides';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  dedupeShiftRecommendationRows,
  filterRowsToLatestAcceptedSubmissions,
  type LatestSchedulingSubmission,
} from '@/lib/scheduling/latestSubmissions';
import { cn, downloadCSV, formatLocalDate } from '@/lib/utils';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';

type HomebaseShift = ClinOpsTables<'homebase_shifts'>;
type HomebaseEmployee = ClinOpsTables<'homebase_employees'>;
type ApprovedShift = ClinOpsTables<'shift_recommendations'>;
type ApprovedScheduleBlock = Pick<
  ApprovedShift,
  'provider_id' | 'provider_name' | 'shift_date' | 'start_min' | 'end_min' | 'shift_type'
> & {
  id: string;
  hours: number;
  sourceRowIds: string[];
};
type ScheduleStatus = 'published' | 'unpublished' | 'unscheduled';
type StatusFilter = ScheduleStatus | 'all';
type ReconciliationSeverity = 'empty' | 'green' | 'yellow' | 'red';
type ReconciliationIssueType =
  | 'missing_homebase'
  | 'time_mismatch'
  | 'homebase_unpublished'
  | 'homebase_unscheduled'
  | 'extra_homebase'
  | 'unmatched_homebase_employee';

interface HomebaseScheduleRow {
  shift: HomebaseShift;
  employee: HomebaseEmployee | null;
  dateKey: string;
}

interface HomebaseSyncResult {
  employees_synced?: number;
  shifts_synced?: number;
  locations_synced?: number;
}

const DEFAULT_RANGE_DAYS = 29;
const JULY_2026_START = '2026-07-01';
const JULY_2026_END = '2026-07-31';
const OPERATIONAL_BLOCK_MINUTES = 30;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface ComparableHomebaseShift extends HomebaseScheduleRow {
  providerId: string | null;
  providerName: string;
  startMin: number;
  endMin: number;
  status: ScheduleStatus;
}

interface ReconciliationIssue {
  id: string;
  type: ReconciliationIssueType;
  severity: Exclude<ReconciliationSeverity, 'empty' | 'green'>;
  dateKey: string;
  providerName: string;
  title: string;
  detail: string;
  fix: string;
  approved?: ApprovedScheduleBlock;
  homebase?: ComparableHomebaseShift;
}

interface DayReconciliation {
  dateKey: string;
  approvedCount: number;
  homebaseCount: number;
  matchedCount: number;
  issues: ReconciliationIssue[];
  severity: ReconciliationSeverity;
}

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const addDaysIso = (iso: string, days: number) => {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const getMonthStartIso = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;

const getMonthEndIso = (monthStart: string) => {
  const [year, month] = monthStart.split('-').map(Number);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
};

const etDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const etDateTimePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const etDateLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const etTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const getEtDateKey = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = etDatePartsFormatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value ?? '';
  const month = parts.find(part => part.type === 'month')?.value ?? '';
  const day = parts.find(part => part.type === 'day')?.value ?? '';
  return year && month && day ? `${year}-${month}-${day}` : '';
};

const getEtDateTimeParts = (iso: string | null): { date: string; minutes: number } | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = etDateTimePartsFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const hour = Number(values.hour) % 24;
  const minute = Number(values.minute);
  if (!values.year || !values.month || !values.day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: hour * 60 + minute,
  };
};

const formatEtDate = (iso: string | null) => {
  if (!iso) return 'No date';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'No date' : etDateLabelFormatter.format(date);
};

const formatEtTime = (iso: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : etTimeFormatter.format(date);
};

const formatEtTimeRange = (startAt: string | null, endAt: string | null) =>
  `${formatEtTime(startAt)}-${formatEtTime(endAt)}`;

const formatDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const formatApprovedTimeRange = (row: Pick<ApprovedShift, 'start_min' | 'end_min'>) =>
  `${formatClockMinutes(row.start_min)}-${formatClockMinutes(row.end_min)}`;

const formatClockMinutes = (minutes: number) => {
  const safe = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(safe / 60);
  const minute = safe % 60;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
};

const formatSyncedAt = (iso: string | null) => {
  if (!iso) return 'Not synced';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Not synced' : dateTimeFormatter.format(date);
};

const getEmployeeName = (employee: HomebaseEmployee | null, shift: HomebaseShift) => {
  const name = [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (employee?.email) return employee.email;
  if (shift.homebase_user_id) return `Homebase user ${shift.homebase_user_id}`;
  return 'Unassigned';
};

const getScheduleStatus = (shift: HomebaseShift): ScheduleStatus => {
  if (shift.scheduled === false) return 'unscheduled';
  return shift.published ? 'published' : 'unpublished';
};

const getMonthStartFromIso = (iso: string) => `${iso.slice(0, 7)}-01`;

const dateRange = (startDate: string, endDate: string): string[] => {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) return [];
  const days: string[] = [];
  for (let cur = startDate; cur <= endDate; cur = addDaysIso(cur, 1)) {
    days.push(cur);
  }
  return days;
};

const utcDayOfWeek = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return 0;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const issueSeverityRank = (issue: ReconciliationIssue) => (issue.severity === 'red' ? 2 : 1);

const pickBestHomebaseCandidate = (rows: ComparableHomebaseShift[]) =>
  [...rows].sort((a, b) => {
    const rank = (row: ComparableHomebaseShift) =>
      row.status === 'published' ? 0 : row.status === 'unpublished' ? 1 : 2;
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    return (b.shift.synced_at ?? '').localeCompare(a.shift.synced_at ?? '');
  })[0] ?? null;

const approvedBlockKey = (row: Pick<ApprovedShift, 'provider_id' | 'provider_name' | 'shift_date' | 'shift_type'>) =>
  `${row.provider_id ?? row.provider_name}|${row.shift_date}|${row.shift_type}`;

const coalesceApprovedScheduleBlocks = (rows: ApprovedShift[]): ApprovedScheduleBlock[] => {
  const sorted = [...rows].sort((a, b) =>
    approvedBlockKey(a).localeCompare(approvedBlockKey(b)) ||
    a.start_min - b.start_min ||
    a.end_min - b.end_min ||
    a.id.localeCompare(b.id),
  );
  const blocks: ApprovedScheduleBlock[] = [];

  for (const row of sorted) {
    const previous = blocks[blocks.length - 1];
    if (
      previous &&
      approvedBlockKey(previous) === approvedBlockKey(row) &&
      previous.end_min === row.start_min
    ) {
      previous.end_min = row.end_min;
      previous.hours = roundHours((previous.end_min - previous.start_min) / 60);
      previous.sourceRowIds.push(row.id);
      previous.id = previous.sourceRowIds.join('+');
      continue;
    }

    blocks.push({
      id: row.id,
      provider_id: row.provider_id,
      provider_name: row.provider_name,
      shift_date: row.shift_date,
      start_min: row.start_min,
      end_min: row.end_min,
      hours: roundHours((row.end_min - row.start_min) / 60),
      shift_type: row.shift_type,
      sourceRowIds: [row.id],
    });
  }

  return blocks
    .map(snapApprovedBlockToOperationalWindow)
    .filter((block): block is ApprovedScheduleBlock => Boolean(block));
};

const roundHours = (value: number) => Math.round(value * 100) / 100;

const snapApprovedBlockToOperationalWindow = (block: ApprovedScheduleBlock): ApprovedScheduleBlock | null => {
  const startMin = Math.ceil(block.start_min / OPERATIONAL_BLOCK_MINUTES) * OPERATIONAL_BLOCK_MINUTES;
  const endMin = Math.floor(block.end_min / OPERATIONAL_BLOCK_MINUTES) * OPERATIONAL_BLOCK_MINUTES;
  if (endMin <= startMin) return null;
  return {
    ...block,
    start_min: startMin,
    end_min: endMin,
    hours: roundHours((endMin - startMin) / 60),
  };
};

const useHomebaseSchedule = (startDate: string, endDate: string, enabled: boolean) =>
  useQuery({
    queryKey: ['homebase-schedule', startDate, endDate],
    enabled,
    queryFn: async (): Promise<HomebaseScheduleRow[]> => {
      const queryStart = `${addDaysIso(startDate, -1)}T00:00:00.000Z`;
      const queryEnd = `${addDaysIso(endDate, 2)}T00:00:00.000Z`;

      const { data: shifts, error: shiftsError } = await clinopsSupabase
        .from('homebase_shifts')
        .select('*')
        .not('start_at', 'is', null)
        .gte('start_at', queryStart)
        .lt('start_at', queryEnd)
        .order('start_at', { ascending: true })
        .range(0, 49999);

      if (shiftsError) throw shiftsError;

      const employeeIds = Array.from(
        new Set((shifts ?? []).map(shift => shift.homebase_employee_id).filter(Boolean) as string[]),
      );
      const employeeMap = new Map<string, HomebaseEmployee>();

      if (employeeIds.length > 0) {
        const { data: employees, error: employeesError } = await clinopsSupabase
          .from('homebase_employees')
          .select('*')
          .in('id', employeeIds)
          .range(0, 9999);

        if (employeesError) throw employeesError;
        for (const employee of employees ?? []) {
          employeeMap.set(employee.id, employee);
        }
      }

      return (shifts ?? [])
        .map(shift => {
          const dateKey = getEtDateKey(shift.start_at);
          return {
            shift,
            dateKey,
            employee: shift.homebase_employee_id ? employeeMap.get(shift.homebase_employee_id) ?? null : null,
          };
        })
        .filter(row => row.dateKey >= startDate && row.dateKey <= endDate);
    },
  });

const useApprovedSchedule = (startDate: string, endDate: string, enabled: boolean) =>
  useQuery({
    queryKey: ['homebase-reconciliation-approved', startDate, endDate],
    enabled,
    queryFn: async (): Promise<ApprovedShift[]> => {
      const startMonth = getMonthStartFromIso(startDate);
      const endMonth = getMonthStartFromIso(endDate);
      const [recommendationsRes, submissionsRes] = await Promise.all([
        clinopsSupabase
          .from('shift_recommendations')
          .select('*')
          .eq('recommendation', 'publish')
          .gte('shift_date', startDate)
          .lte('shift_date', endDate)
          .order('shift_date', { ascending: true })
          .order('start_min', { ascending: true })
          .range(0, 49999),
        clinopsSupabase
          .from('schedule_submissions')
          .select('id, provider_id, target_month, decision_status, submitted_at')
          .gte('target_month', startMonth)
          .lte('target_month', endMonth)
          .range(0, 49999),
      ]);
      if (recommendationsRes.error) throw recommendationsRes.error;
      if (submissionsRes.error) throw submissionsRes.error;
      return dedupeShiftRecommendationRows(
        filterRowsToLatestAcceptedSubmissions(
          (recommendationsRes.data ?? []) as ApprovedShift[],
          (submissionsRes.data ?? []) as LatestSchedulingSubmission[],
        ),
      );
    },
    staleTime: 30_000,
  });

const toComparableHomebaseShift = (row: HomebaseScheduleRow): ComparableHomebaseShift | null => {
  const start = getEtDateTimeParts(row.shift.start_at);
  const end = getEtDateTimeParts(row.shift.end_at);
  if (!start || !end) return null;
  let endMin = end.minutes;
  if (end.date > start.date || endMin < start.minutes) endMin += 24 * 60;
  return {
    ...row,
    dateKey: start.date,
    providerId: row.employee?.profile_id ?? null,
    providerName: getEmployeeName(row.employee, row.shift),
    startMin: start.minutes,
    endMin,
    status: getScheduleStatus(row.shift),
  };
};

const buildReconciliation = (
  approvedRows: ApprovedScheduleBlock[],
  homebaseRows: HomebaseScheduleRow[],
  startDate: string,
  endDate: string,
): DayReconciliation[] => {
  const days = dateRange(startDate, endDate);
  const dayMap = new Map<string, DayReconciliation>(
    days.map(dateKey => [
      dateKey,
      {
        dateKey,
        approvedCount: 0,
        homebaseCount: 0,
        matchedCount: 0,
        issues: [],
        severity: 'empty',
      },
    ]),
  );

  const homebaseComparable = homebaseRows
    .map(toComparableHomebaseShift)
    .filter((row): row is ComparableHomebaseShift =>
      Boolean(row && row.dateKey >= startDate && row.dateKey <= endDate),
    );
  const usedHomebaseIds = new Set<string>();

  for (const row of approvedRows) {
    const day = dayMap.get(row.shift_date);
    if (day) day.approvedCount += 1;
  }
  for (const row of homebaseComparable) {
    const day = dayMap.get(row.dateKey);
    if (day) day.homebaseCount += 1;
  }

  const pushIssue = (issue: ReconciliationIssue) => {
    const day = dayMap.get(issue.dateKey);
    if (!day) return;
    day.issues.push(issue);
  };

  for (const approved of approvedRows) {
    const dateKey = approved.shift_date;
    const providerName = approved.provider_name;
    const candidates = homebaseComparable.filter(row =>
      row.providerId === approved.provider_id &&
      row.dateKey === dateKey &&
      !usedHomebaseIds.has(row.shift.id),
    );
    const exact = pickBestHomebaseCandidate(
      candidates.filter(candidate =>
        candidate.startMin === approved.start_min &&
        candidate.endMin === approved.end_min,
      ),
    );

    if (exact) {
      usedHomebaseIds.add(exact.shift.id);
      const day = dayMap.get(dateKey);
      if (day) day.matchedCount += 1;
      if (exact.status !== 'published') {
        const type: ReconciliationIssueType =
          exact.status === 'unscheduled' ? 'homebase_unscheduled' : 'homebase_unpublished';
        const severity: ReconciliationIssue['severity'] =
          exact.status === 'unscheduled' ? 'red' : 'yellow';
        pushIssue({
          id: `${type}-${approved.id}-${exact.shift.homebase_id}`,
          type,
          severity,
          dateKey,
          providerName,
          title: exact.status === 'unscheduled' ? 'Homebase shift is unscheduled' : 'Homebase shift is not published',
          detail: `${providerName} ${formatApprovedTimeRange(approved)} exists in Homebase but is ${exact.status}.`,
          fix: exact.status === 'unscheduled'
            ? 'Schedule or recreate this shift in Homebase, then sync again.'
            : 'Publish this Homebase shift.',
          approved,
          homebase: exact,
        });
      }
      continue;
    }

    const nearest = pickBestHomebaseCandidate(
      candidates
        .map(candidate => ({
          candidate,
          delta: Math.abs(candidate.startMin - approved.start_min) + Math.abs(candidate.endMin - approved.end_min),
        }))
        .sort((a, b) => a.delta - b.delta)
        .map(item => item.candidate),
    );

    if (nearest) {
      usedHomebaseIds.add(nearest.shift.id);
      pushIssue({
        id: `time-mismatch-${approved.id}-${nearest.shift.homebase_id}`,
        type: 'time_mismatch',
        severity: 'red',
        dateKey,
        providerName,
        title: 'Shift time differs',
        detail: `${providerName} is approved for ${formatApprovedTimeRange(approved)} but Homebase has ${formatEtTimeRange(nearest.shift.start_at, nearest.shift.end_at)}.`,
        fix: `Update Homebase to ${formatApprovedTimeRange(approved)}, or update the approved Lovable schedule if Homebase is correct.`,
        approved,
        homebase: nearest,
      });
      continue;
    }

    pushIssue({
      id: `missing-homebase-${approved.id}`,
      type: 'missing_homebase',
      severity: 'red',
      dateKey,
      providerName,
      title: 'Approved shift missing from Homebase',
      detail: `${providerName} ${formatApprovedTimeRange(approved)} is approved in Lovable but no Homebase shift was found for that provider on this date.`,
      fix: 'Create this shift in Homebase, then sync Homebase again.',
      approved,
    });
  }

  for (const homebase of homebaseComparable) {
    if (usedHomebaseIds.has(homebase.shift.id)) continue;
    if (!homebase.providerId) {
      pushIssue({
        id: `unmatched-homebase-${homebase.shift.homebase_id}`,
        type: 'unmatched_homebase_employee',
        severity: 'red',
        dateKey: homebase.dateKey,
        providerName: homebase.providerName,
        title: 'Homebase employee is not matched',
        detail: `${homebase.providerName} ${formatEtTimeRange(homebase.shift.start_at, homebase.shift.end_at)} is in Homebase but is not linked to a ClinOps provider profile.`,
        fix: 'Map this Homebase employee to the correct provider profile, sync again, then re-check the day.',
        homebase,
      });
      continue;
    }

    pushIssue({
      id: `extra-homebase-${homebase.shift.homebase_id}`,
      type: 'extra_homebase',
      severity: 'red',
      dateKey: homebase.dateKey,
      providerName: homebase.providerName,
      title: 'Extra Homebase shift',
      detail: `${homebase.providerName} ${formatEtTimeRange(homebase.shift.start_at, homebase.shift.end_at)} is in Homebase but does not match an approved Lovable shift.`,
      fix: 'Remove or adjust this Homebase shift, or approve the matching availability in Lovable if it should stay.',
      homebase,
    });
  }

  return days.map(dateKey => {
    const day = dayMap.get(dateKey)!;
    const worstIssue = [...day.issues].sort((a, b) => issueSeverityRank(b) - issueSeverityRank(a))[0];
    const hasAnySchedule = day.approvedCount > 0 || day.homebaseCount > 0;
    const severity: ReconciliationSeverity = worstIssue
      ? worstIssue.severity
      : hasAnySchedule
        ? 'green'
        : 'empty';
    return {
      ...day,
      issues: [...day.issues].sort((a, b) =>
        issueSeverityRank(b) - issueSeverityRank(a) ||
        a.providerName.localeCompare(b.providerName) ||
        a.title.localeCompare(b.title),
      ),
      severity,
    };
  });
};

export const HomebaseScheduleContent = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const today = useMemo(() => formatLocalDate(new Date()), []);
  const [startDate, setStartDate] = useState(JULY_2026_START);
  const [endDate, setEndDate] = useState(JULY_2026_END);
  const [selectedDate, setSelectedDate] = useState(JULY_2026_START);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const invalidRange = !isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate;
  const scheduleQ = useHomebaseSchedule(startDate, endDate, !invalidRange);
  const approvedQ = useApprovedSchedule(startDate, endDate, !invalidRange);
  const overridesQ = useReconciliationOverrides(startDate, endDate, !invalidRange);
  const overrides = useMemo(
    () => overridesQ.data ?? new Map<string, ReconciliationOverrideRow>(),
    [overridesQ.data],
  );
  const [showResolved, setShowResolved] = useState(false);
  const rows = useMemo(() => scheduleQ.data ?? [], [scheduleQ.data]);
  const approvedSourceRows = useMemo(() => approvedQ.data ?? [], [approvedQ.data]);
  const approvedRows = useMemo(
    () => coalesceApprovedScheduleBlocks(approvedSourceRows),
    [approvedSourceRows],
  );
  const reconciliationDays = useMemo(
    () => buildReconciliation(approvedRows, rows, startDate, endDate),
    [approvedRows, rows, startDate, endDate],
  );
  const effectiveDays = useMemo<DayReconciliation[]>(() => {
    if (overrides.size === 0) return reconciliationDays;
    return reconciliationDays.map(day => {
      const openIssues = day.issues.filter(issue => !overrides.has(issue.id));
      const worst = [...openIssues].sort((a, b) => issueSeverityRank(b) - issueSeverityRank(a))[0];
      const hasAnySchedule = day.approvedCount > 0 || day.homebaseCount > 0;
      const severity: ReconciliationSeverity = worst
        ? worst.severity
        : hasAnySchedule
          ? 'green'
          : 'empty';
      return { ...day, issues: day.issues, severity, _openCount: openIssues.length } as DayReconciliation & { _openCount: number };
    });
  }, [reconciliationDays, overrides]);
  const selectedDay = useMemo(
    () => effectiveDays.find(day => day.dateKey === selectedDate) ?? effectiveDays[0] ?? null,
    [effectiveDays, selectedDate],
  );

  const preferredSelectedDate = useMemo(() => {
    if (effectiveDays.length === 0) return startDate;
    return (
      effectiveDays.find(day => day.severity === 'red') ??
      effectiveDays.find(day => day.severity === 'yellow') ??
      effectiveDays.find(day => day.severity === 'green') ??
      effectiveDays[0]
    ).dateKey;
  }, [effectiveDays, startDate]);

  useEffect(() => {
    if (!selectedDate || selectedDate < startDate || selectedDate > endDate) {
      setSelectedDate(preferredSelectedDate);
    }
  }, [endDate, preferredSelectedDate, selectedDate, startDate]);

  const syncMutation = useMutation({
    mutationFn: async (): Promise<HomebaseSyncResult> => {
      if (invalidRange) throw new Error('Choose a valid Homebase date range.');
      const { data, error } = await clinopsSupabase.functions.invoke('sync-homebase', {
        body: {
          start_date: startDate,
          end_date: endDate,
        },
      });
      if (error) throw error;
      return (data ?? {}) as HomebaseSyncResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['homebase-schedule'] });
      toast({
        title: 'Homebase synced',
        description: `${result.shifts_synced ?? 0} shifts refreshed for ${startDate} through ${endDate}.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Homebase sync failed',
        description: error instanceof Error ? error.message : 'Unable to refresh Homebase shifts.',
        variant: 'destructive',
      });
    },
  });

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(row => {
      const status = getScheduleStatus(row.shift);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!needle) return true;

      const provider = getEmployeeName(row.employee, row.shift);
      const haystack = [
        provider,
        row.employee?.email,
        row.shift.role,
        row.shift.department,
        row.shift.homebase_id,
        status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const providerIds = new Set<string>();
    let hours = 0;
    let published = 0;
    let unpublished = 0;
    let unscheduled = 0;
    let latestSync = '';

    for (const row of rows) {
      hours += Number(row.shift.scheduled_hours ?? 0);
      if (row.employee?.profile_id) providerIds.add(row.employee.profile_id);
      if (row.shift.synced_at && row.shift.synced_at > latestSync) latestSync = row.shift.synced_at;

      const status = getScheduleStatus(row.shift);
      if (status === 'published') published += 1;
      if (status === 'unpublished') unpublished += 1;
      if (status === 'unscheduled') unscheduled += 1;
    }

    return { hours, published, unpublished, unscheduled, matchedProviders: providerIds.size, latestSync };
  }, [rows]);

  const reconciliationTotals = useMemo(() => {
    const issueDays = effectiveDays.filter(day => day.severity === 'red').length;
    const publishDays = effectiveDays.filter(day => day.severity === 'yellow').length;
    const cleanDays = effectiveDays.filter(day => day.severity === 'green').length;
    const openIssues = effectiveDays.flatMap(day => day.issues.filter(i => !overrides.has(i.id)));
    const redIssues = openIssues.filter(issue => issue.severity === 'red').length;
    const yellowIssues = openIssues.filter(issue => issue.severity === 'yellow').length;
    const matchedCount = effectiveDays.reduce((sum, day) => sum + day.matchedCount, 0);
    const resolvedCount = effectiveDays.reduce(
      (sum, day) => sum + day.issues.filter(i => overrides.has(i.id)).length,
      0,
    );
    return {
      issueDays,
      publishDays,
      cleanDays,
      redIssues,
      yellowIssues,
      matchedCount,
      issueCount: openIssues.length,
      resolvedCount,
    };
  }, [effectiveDays, overrides]);

  const setNextThirtyDays = () => {
    setStartDate(today);
    setEndDate(addDaysIso(today, DEFAULT_RANGE_DAYS));
  };

  const setJuly2026 = () => {
    setStartDate(JULY_2026_START);
    setEndDate(JULY_2026_END);
    setSelectedDate(JULY_2026_START);
  };

  const setCurrentMonth = () => {
    const monthStart = getMonthStartIso();
    setStartDate(monthStart);
    setEndDate(getMonthEndIso(monthStart));
  };

  const downloadScheduleCsv = () => {
    downloadCSV(
      filteredRows.map(row => ({
        homebase_shift_id: row.shift.homebase_id,
        date_et: row.dateKey,
        start_time_et: formatEtTime(row.shift.start_at),
        end_time_et: formatEtTime(row.shift.end_at),
        provider: getEmployeeName(row.employee, row.shift),
        email: row.employee?.email ?? '',
        role: row.shift.role ?? '',
        department: row.shift.department ?? '',
        scheduled_hours: row.shift.scheduled_hours ?? '',
        status: getScheduleStatus(row.shift),
        published: row.shift.published ?? '',
        scheduled: row.shift.scheduled ?? '',
        synced_at: row.shift.synced_at ?? '',
      })),
      `homebase_schedule_${startDate}_to_${endDate}.csv`,
    );
  };

  const downloadReconciliationCsv = () => {
    const issues = reconciliationDays.flatMap(day => day.issues);
    downloadCSV(
      issues.map(issue => ({
        date: issue.dateKey,
        severity: issue.severity,
        issue: issue.title,
        provider: issue.providerName,
        approved_time: issue.approved ? formatApprovedTimeRange(issue.approved) : '',
        homebase_time: issue.homebase ? formatEtTimeRange(issue.homebase.shift.start_at, issue.homebase.shift.end_at) : '',
        homebase_status: issue.homebase?.status ?? '',
        fix: issue.fix,
        approved_shift_id: issue.approved?.id ?? '',
        approved_source_row_ids: issue.approved?.sourceRowIds.join(',') ?? '',
        homebase_shift_id: issue.homebase?.shift.homebase_id ?? '',
      })),
      `homebase_reconciliation_${startDate}_to_${endDate}.csv`,
    );
  };

  const reconciliationError = scheduleQ.error ?? approvedQ.error;
  const reconciliationLoading = scheduleQ.isLoading || approvedQ.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarRange className="h-6 w-6 text-emerald-600" />
            Homebase Schedule
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compare approved Lovable shifts against synced Homebase shifts.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor="homebase-start" className="text-xs font-medium text-muted-foreground">Start</label>
            <Input
              id="homebase-start"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor="homebase-end" className="text-xs font-medium text-muted-foreground">End</label>
            <Input
              id="homebase-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
          <Button variant="outline" size="sm" onClick={setJuly2026} className="h-9">
            July 2026
          </Button>
          <Button variant="outline" size="sm" onClick={setNextThirtyDays} className="h-9">
            Next 30 days
          </Button>
          <Button variant="outline" size="sm" onClick={setCurrentMonth} className="h-9">
            Current month
          </Button>
          <Button
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={invalidRange || syncMutation.isPending}
            className="h-9"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Sync Homebase
          </Button>
        </div>
      </div>

      {invalidRange && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Choose a valid Homebase range with the end date on or after the start date.</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="reconciliation" className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <TabsList>
            <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
            <TabsTrigger value="raw">Raw Homebase</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadReconciliationCsv}
              disabled={reconciliationTotals.issueCount === 0}
              className="h-9"
            >
              <Download className="h-4 w-4 mr-1" />
              Issue CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadScheduleCsv}
              disabled={!filteredRows.length}
              className="h-9"
            >
              <Download className="h-4 w-4 mr-1" />
              Raw CSV
            </Button>
          </div>
        </div>

        <TabsContent value="reconciliation" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label="Mismatch days" value={`${reconciliationTotals.issueDays}`} sub={`${reconciliationTotals.redIssues} blocking issues`} accent={reconciliationTotals.issueDays > 0 ? 'bad' : 'good'} />
            <KpiCard label="Needs publish" value={`${reconciliationTotals.publishDays}`} sub={`${reconciliationTotals.yellowIssues} yellow shifts`} accent={reconciliationTotals.publishDays > 0 ? 'warn' : 'good'} />
            <KpiCard label="Clean days" value={`${reconciliationTotals.cleanDays}`} sub="approved matches Homebase" accent="good" />
            <KpiCard
              label="Approved shifts"
              value={`${approvedRows.length}`}
              sub={`${reconciliationTotals.matchedCount} matched${approvedSourceRows.length !== approvedRows.length ? ` · ${approvedSourceRows.length} source rows` : ''}`}
            />
            <KpiCard label="Last sync" value={formatSyncedAt(totals.latestSync)} sub={`${rows.length} Homebase rows`} />
          </div>

          {reconciliationLoading ? (
            <Card>
              <CardContent className="py-16 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </CardContent>
            </Card>
          ) : reconciliationError ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-destructive">
                {reconciliationError instanceof Error ? reconciliationError.message : 'Unable to load reconciliation data.'}
              </CardContent>
            </Card>
          ) : (
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
              <ReconciliationCalendar
                days={effectiveDays}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                overrides={overrides}
              />
              <ReconciliationDayDetails
                day={selectedDay}
                overrides={overrides}
                showResolved={showResolved}
                onShowResolvedChange={setShowResolved}
                resolvedCount={reconciliationTotals.resolvedCount}
                onResync={() => syncMutation.mutate()}
                isResyncing={syncMutation.isPending}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="raw" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label="Shifts" value={`${rows.length}`} sub={`${filteredRows.length} visible`} />
            <KpiCard label="Published" value={`${totals.published}`} sub={`${totals.unpublished} unpublished`} accent={totals.unpublished > 0 ? 'warn' : 'good'} />
            <KpiCard label="Hours" value={totals.hours.toFixed(1)} sub="scheduled in range" />
            <KpiCard label="Matched providers" value={`${totals.matchedProviders}`} sub="linked to ClinOps profiles" />
            <KpiCard label="Last sync" value={formatSyncedAt(totals.latestSync)} sub="from stored Homebase data" />
          </div>

          <RawHomebaseScheduleTable
            rows={filteredRows}
            isLoading={scheduleQ.isLoading}
            error={scheduleQ.error}
            search={search}
            statusFilter={statusFilter}
            onSearchChange={setSearch}
            onStatusFilterChange={setStatusFilter}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const HomebaseSchedulePage = () => {
  const { profile, roles } = useAuth();
  const userRole = roles.includes('admin')
    ? 'admin'
    : roles.includes('pod_lead')
    ? 'pod_lead'
    : 'provider';

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar
        userRole={userRole}
        userName={profile?.full_name || 'User'}
        userEmail={profile?.email || ''}
        userAvatarUrl={profile?.avatar_url || undefined}
      />

      <main className="ml-16 lg:ml-64 transition-all duration-300 min-w-0">
        <div className="p-4 md:p-6 lg:p-8">
          <HomebaseScheduleContent />
        </div>
      </main>
    </div>
  );
};

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: 'good' | 'warn' | 'bad' | 'neutral';
}

const KpiCard = ({ label, value, sub, accent = 'neutral' }: KpiCardProps) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${
        accent === 'good' ? 'text-emerald-600'
        : accent === 'warn' ? 'text-amber-600'
        : accent === 'bad' ? 'text-red-600'
        : ''
      }`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </CardContent>
  </Card>
);

const ReconciliationCalendar = ({
  days,
  selectedDate,
  onSelectDate,
}: {
  days: DayReconciliation[];
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
}) => {
  const firstDayOffset = days[0] ? utcDayOfWeek(days[0].dateKey) : 0;
  const cells: Array<DayReconciliation | null> = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...days,
  ];

  return (
    <Card className="min-w-0">
      <CardContent className="min-w-0 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Schedule map</h2>
            <p className="text-xs text-muted-foreground">
              Green matches, yellow needs publishing, red needs schedule changes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <LegendDot className="bg-emerald-500" label="Matched" />
            <LegendDot className="bg-amber-500" label="Needs publish" />
            <LegendDot className="bg-red-500" label="Mismatch" />
          </div>
        </div>
        <div className="max-w-full overflow-x-auto pb-1">
          <div className="min-w-[620px] space-y-2">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase text-muted-foreground">
              {WEEKDAY_LABELS.map(label => (
                <div key={label} className="py-1">{label}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {cells.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} className="min-h-24 rounded-md border border-transparent" />;
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => onSelectDate(day.dateKey)}
                    className={cn(
                      'min-h-24 rounded-md border p-2 text-left transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      day.severity === 'red' && 'border-red-300 bg-red-50 text-red-950',
                      day.severity === 'yellow' && 'border-amber-300 bg-amber-50 text-amber-950',
                      day.severity === 'green' && 'border-emerald-300 bg-emerald-50 text-emerald-950',
                      day.severity === 'empty' && 'border-slate-200 bg-white text-slate-600',
                      selectedDate === day.dateKey && 'ring-2 ring-offset-1 ring-slate-900',
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-sm font-semibold tabular-nums">{Number(day.dateKey.slice(-2))}</span>
                      <DaySeverityBadge severity={day.severity} />
                    </div>
                    <div className="mt-3 space-y-1 text-[11px] leading-tight">
                      <div>{day.approvedCount} approved</div>
                      <div>{day.homebaseCount} Homebase</div>
                      {day.issues.length > 0 ? (
                        <div className="font-medium">{day.issues.length} issue{day.issues.length === 1 ? '' : 's'}</div>
                      ) : day.severity === 'green' ? (
                        <div className="font-medium">matched</div>
                      ) : (
                        <div className="text-muted-foreground">no shifts</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const ReconciliationDayDetails = ({ day }: { day: DayReconciliation | null }) => {
  if (!day) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No day selected.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold">{formatDateKey(day.dateKey)}</h2>
            <p className="text-xs text-muted-foreground">
              {day.approvedCount} approved · {day.homebaseCount} in Homebase · {day.matchedCount} matched
            </p>
          </div>
          <DayStatusBadge day={day} />
        </div>

        {day.issues.length === 0 ? (
          <div className="rounded-md border bg-muted/20 p-4 text-sm">
            {day.severity === 'green'
              ? 'Approved Lovable shifts match published Homebase shifts for this day.'
              : 'No approved or Homebase shifts for this day.'}
          </div>
        ) : (
          <div className="space-y-3">
            {day.issues.map(issue => (
              <div
                key={issue.id}
                className={cn(
                  'rounded-md border p-3',
                  issue.severity === 'red' ? 'border-red-200 bg-red-50/80' : 'border-amber-200 bg-amber-50/80',
                )}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {issue.severity === 'red' ? (
                        <XCircle className="h-4 w-4 text-red-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                      )}
                      <span className="font-medium">{issue.title}</span>
                      <Badge variant="outline" className="bg-white/70">{issue.providerName}</Badge>
                    </div>
                    <p className="mt-2 text-sm">{issue.detail}</p>
                    <p className="mt-2 text-xs font-medium text-muted-foreground">{issue.fix}</p>
                  </div>
                  <IssueTypeBadge issue={issue} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const RawHomebaseScheduleTable = ({
  rows,
  isLoading,
  error,
  search,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
}: {
  rows: HomebaseScheduleRow[];
  isLoading: boolean;
  error: unknown;
  search: string;
  statusFilter: StatusFilter;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
}) => (
  <Card>
    <CardContent className="p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search provider, role, department"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}>
          <SelectTrigger className="w-full md:w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="unpublished">Unpublished</SelectItem>
            <SelectItem value="unscheduled">Unscheduled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="py-16 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : 'Unable to load Homebase shifts.'}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No Homebase shifts match this view.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Date</th>
                <th className="px-2 py-2 text-left font-medium">Time (ET)</th>
                <th className="px-2 py-2 text-left font-medium">Provider</th>
                <th className="px-2 py-2 text-left font-medium">Role</th>
                <th className="px-2 py-2 text-left font-medium">Department</th>
                <th className="px-2 py-2 text-right font-medium">Hours</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
                <th className="px-2 py-2 text-left font-medium">Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(row => (
                <tr key={row.shift.id} className="hover:bg-muted/30">
                  <td className="px-2 py-2 whitespace-nowrap">
                    <div className="font-medium">{formatEtDate(row.shift.start_at)}</div>
                    <div className="text-xs text-muted-foreground">{row.dateKey}</div>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap font-mono text-xs">
                    {formatEtTimeRange(row.shift.start_at, row.shift.end_at)}
                  </td>
                  <td className="px-2 py-2 min-w-[190px]">
                    <div className="font-medium">{getEmployeeName(row.employee, row.shift)}</div>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {row.employee?.email && <span>{row.employee.email}</span>}
                      {row.employee?.profile_id ? (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">matched</Badge>
                      ) : (
                        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">unmatched</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">{row.shift.role ?? '—'}</td>
                  <td className="px-2 py-2">{row.shift.department ?? '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{Number(row.shift.scheduled_hours ?? 0).toFixed(1)}</td>
                  <td className="px-2 py-2">
                    <HomebaseStatusBadge status={getScheduleStatus(row.shift)} />
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {formatSyncedAt(row.shift.synced_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardContent>
  </Card>
);

const LegendDot = ({ className, label }: { className: string; label: string }) => (
  <span className="inline-flex items-center gap-1">
    <span className={cn('h-2.5 w-2.5 rounded-full', className)} />
    {label}
  </span>
);

const DaySeverityBadge = ({ severity }: { severity: ReconciliationSeverity }) => {
  if (severity === 'red') return <span className="h-2.5 w-2.5 rounded-full bg-red-500" />;
  if (severity === 'yellow') return <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />;
  if (severity === 'green') return <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />;
  return <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />;
};

const DayStatusBadge = ({ day }: { day: DayReconciliation }) => {
  if (day.severity === 'red') {
    return <Badge className="bg-red-600"><XCircle className="h-3 w-3 mr-1" />Mismatch</Badge>;
  }
  if (day.severity === 'yellow') {
    return <Badge className="bg-amber-600"><AlertTriangle className="h-3 w-3 mr-1" />Needs publish</Badge>;
  }
  if (day.severity === 'green') {
    return <Badge className="bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />Matched</Badge>;
  }
  return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />No shifts</Badge>;
};

const IssueTypeBadge = ({ issue }: { issue: ReconciliationIssue }) => {
  const labels: Record<ReconciliationIssueType, string> = {
    missing_homebase: 'missing',
    time_mismatch: 'time',
    homebase_unpublished: 'unpublished',
    homebase_unscheduled: 'unscheduled',
    extra_homebase: 'extra',
    unmatched_homebase_employee: 'unmatched',
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        'bg-white/70',
        issue.severity === 'red' ? 'border-red-300 text-red-800' : 'border-amber-300 text-amber-800',
      )}
    >
      {labels[issue.type]}
    </Badge>
  );
};

const HomebaseStatusBadge = ({ status }: { status: ScheduleStatus }) => {
  if (status === 'published') {
    return <Badge className="bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />Published</Badge>;
  }
  if (status === 'unpublished') {
    return <Badge className="bg-amber-600"><AlertTriangle className="h-3 w-3 mr-1" />Unpublished</Badge>;
  }
  return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Unscheduled</Badge>;
};

export default HomebaseSchedulePage;
