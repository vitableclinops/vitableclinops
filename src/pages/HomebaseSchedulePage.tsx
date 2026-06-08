import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppSidebar } from '@/components/AppSidebar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import type { ClinOpsTables } from '@/integrations/supabase/clinopsTypes';
import { downloadCSV, formatLocalDate } from '@/lib/utils';
import { AlertTriangle, CalendarRange, CheckCircle2, Clock, Download, Loader2, RefreshCw, Search } from 'lucide-react';

type HomebaseShift = ClinOpsTables<'homebase_shifts'>;
type HomebaseEmployee = ClinOpsTables<'homebase_employees'>;
type ScheduleStatus = 'published' | 'unpublished' | 'unscheduled';
type StatusFilter = ScheduleStatus | 'all';

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

const HomebaseSchedulePage = () => {
  const { profile, roles } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userRole = roles.includes('admin')
    ? 'admin'
    : roles.includes('pod_lead')
    ? 'pod_lead'
    : 'provider';

  const today = useMemo(() => formatLocalDate(new Date()), []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(() => addDaysIso(today, DEFAULT_RANGE_DAYS));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const invalidRange = !isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate;
  const scheduleQ = useHomebaseSchedule(startDate, endDate, !invalidRange);
  const rows = useMemo(() => scheduleQ.data ?? [], [scheduleQ.data]);

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

  const setNextThirtyDays = () => {
    setStartDate(today);
    setEndDate(addDaysIso(today, DEFAULT_RANGE_DAYS));
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
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <CalendarRange className="h-6 w-6 text-emerald-600" />
                Homebase Schedule
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Synced Homebase shifts, organized for schedule review instead of setup.
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
              <Button
                variant="outline"
                size="sm"
                onClick={setNextThirtyDays}
                className="h-9"
              >
                Next 30 days
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={setCurrentMonth}
                className="h-9"
              >
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
              <Button
                variant="outline"
                size="sm"
                onClick={downloadScheduleCsv}
                disabled={!filteredRows.length}
                className="h-9"
              >
                <Download className="h-4 w-4 mr-1" />
                CSV
              </Button>
            </div>
          </div>

          {invalidRange && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Choose a valid Homebase range with the end date on or after the start date.</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label="Shifts" value={`${rows.length}`} sub={`${filteredRows.length} visible`} />
            <KpiCard label="Published" value={`${totals.published}`} sub={`${totals.unpublished} unpublished`} accent={totals.unpublished > 0 ? 'warn' : 'good'} />
            <KpiCard label="Hours" value={totals.hours.toFixed(1)} sub="scheduled in range" />
            <KpiCard label="Matched providers" value={`${totals.matchedProviders}`} sub="linked to ClinOps profiles" />
            <KpiCard label="Last sync" value={formatSyncedAt(totals.latestSync)} sub="from stored Homebase data" />
          </div>

          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative max-w-md flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search provider, role, department"
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
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

              {scheduleQ.isLoading ? (
                <div className="py-16 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : scheduleQ.error ? (
                <div className="py-12 text-center text-sm text-destructive">
                  {scheduleQ.error instanceof Error ? scheduleQ.error.message : 'Unable to load Homebase shifts.'}
                </div>
              ) : filteredRows.length === 0 ? (
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
                      {filteredRows.map(row => (
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
        </div>
      </main>
    </div>
  );
};

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: 'good' | 'warn' | 'neutral';
}

const KpiCard = ({ label, value, sub, accent = 'neutral' }: KpiCardProps) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${
        accent === 'good' ? 'text-emerald-600'
        : accent === 'warn' ? 'text-amber-600'
        : ''
      }`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </CardContent>
  </Card>
);

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
