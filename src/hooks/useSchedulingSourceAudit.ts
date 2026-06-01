import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';

type SourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type NamedCount = {
  label: string;
  count: number;
};

export type SourceMetric = {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
};

export type SourceAuditSection = {
  id: 'homebase' | 'metabase' | 'jotform' | 'medallion' | 'directshifts';
  title: string;
  status: 'healthy' | 'watch' | 'missing' | 'error';
  updatedAt: string | null;
  metrics: SourceMetric[];
  fieldCoverage: string[];
  gaps: string[];
  details: NamedCount[];
  error?: string;
};

export type SchedulingSourceAudit = {
  month: string;
  homebase: SourceAuditSection;
  metabase: SourceAuditSection;
  jotform: SourceAuditSection;
  medallion: SourceAuditSection;
  directshifts: SourceAuditSection;
};

type HomebaseRun = {
  status: string | null;
  finished_at: string | null;
  started_at: string | null;
  locations_synced: number | null;
  employees_synced: number | null;
  employees_matched: number | null;
  employees_unmatched: number | null;
  shifts_synced: number | null;
};

type SyncRun = {
  function_name: string;
  status: string;
  finished_at: string | null;
  started_at: string;
  rows_processed: number | null;
  rows_failed: number | null;
  error_message: string | null;
};

type ClinopsSyncRun = SyncRun;

type HomebaseLocation = {
  state: string | null;
  synced_at: string | null;
};

type HomebaseEmployee = {
  profile_id: string | null;
  match_confidence: string | null;
  synced_at: string | null;
};

type HomebaseShift = {
  role: string | null;
  department: string | null;
  scheduled_hours: number | null;
  published: boolean | null;
  scheduled: boolean | null;
  start_at: string | null;
  synced_at: string | null;
  homebase_employee_id: string | null;
};

type RawExport = {
  report_key: string;
  pulled_at: string;
  pulled_date: string;
  row_count: number;
};

type LeftoverSlot = {
  state_abbreviation: string;
  unfilled_slots: number;
  synced_at: string | null;
  imported_at: string;
};

type SlaAttainment = {
  state_abbreviation: string;
  sla_pct: number;
  synced_at: string | null;
  imported_at: string;
};

type UtilizationRow = {
  synced_at: string | null;
  imported_at: string;
};

type ClinopsDemandTarget = {
  state: string;
  computed_at: string;
};

type ClinopsDemandDay = {
  state: string | null;
  computed_at: string | null;
};

type ClinopsServiceLineTarget = {
  service_line: string;
  computed_at: string;
};

type ClinopsSlaDay = {
  state: string;
  date: string;
  computed_at: string;
};

type MetabasePcpCoverageRow = {
  provider_id: string | null;
  state: string;
  is_active: boolean | null;
  report_date: string;
  synced_at: string;
};

type ProviderStateActiveRow = {
  provider_id: string;
  state: string;
  is_active: boolean;
  source: string;
  synced_at: string;
};

type MedallionLicenseRow = {
  provider_id: string | null;
  provider_name: string | null;
  medallion_provider_id: string | null;
  state: string;
  status: string;
  expiration_date: string | null;
  synced_at: string;
};

type DirectShiftsLicenseRow = {
  provider_id: string | null;
  provider_email: string | null;
  provider_name: string | null;
  state: string;
  status: string;
  effective_to: string | null;
  updated_at: string;
};

type JotformSubmission = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  decision_status: string | null;
  raw_answers: unknown;
  parsed_shifts: unknown;
  validation_status: string | null;
  submitted_at: string;
};

type ShiftRecommendationAuditRow = {
  provider_id: string | null;
  publish_status: string;
  recommendation: string;
  created_at: string | null;
};

type PayRateAuditRow = {
  provider_id: string;
  source: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
};

const monthIso = (month: string) => (month.length === 7 ? `${month}-01` : month);

const nextMonthIso = (month: string) => {
  const [y, m] = monthIso(month).split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

const fmtInt = (value: number | null | undefined) =>
  Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

const fmtHours = (value: number) =>
  value.toLocaleString('en-US', { maximumFractionDigits: 1 });

const maxIso = (values: Array<string | null | undefined>) => {
  const present = values.filter((v): v is string => Boolean(v));
  return present.length ? present.sort().at(-1) ?? null : null;
};

const statusFromFreshness = (
  updatedAt: string | null,
  hasRows: boolean,
  hasError: boolean,
): SourceAuditSection['status'] => {
  if (hasError) return 'error';
  if (!hasRows) return 'missing';
  if (!updatedAt) return 'watch';
  const ageHours = (Date.now() - new Date(updatedAt).getTime()) / 36e5;
  return ageHours > 36 ? 'watch' : 'healthy';
};

const topCounts = <T,>(
  rows: T[],
  labelFor: (row: T) => string | null | undefined,
  limit = 6,
): NamedCount[] => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = (labelFor(row) ?? 'Unknown').trim() || 'Unknown';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
};

const settle = async <T,>(fn: () => Promise<T>): Promise<SourceResult<T>> => {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const parsedHasAvailability = (value: unknown) => {
  if (!value || typeof value !== 'object') return false;
  const blob = value as Record<string, unknown>;
  return ['recurring_virtual', 'one_off_virtual', 'in_home_clinic'].some(key => {
    const raw = blob[key];
    if (Array.isArray(raw)) return raw.length > 0;
    if (typeof raw !== 'string') return Boolean(raw);
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
    } catch {
      return raw.trim().length > 0;
    }
  });
};

const isAllocationLicenseStatus = (status: string | null | undefined) =>
  ['active', 'verified', 'pending_renewal'].includes((status ?? '').trim().toLowerCase());

const expiresWithinDays = (date: string | null | undefined, days: number) => {
  if (!date) return false;
  const expires = new Date(`${date}T00:00:00Z`).getTime();
  if (!Number.isFinite(expires)) return false;
  const now = Date.now();
  return expires >= now && expires <= now + days * 864e5;
};

async function getHomebaseAudit(): Promise<SourceAuditSection> {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 14);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 15);
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);

  const [runResult, syncRunResult, locationsResult, employeesResult, shiftsResult, ratesResult] =
    await Promise.all([
      settle(async () => {
        const { data, error } = await supabase
          .from('homebase_sync_runs')
          .select('status, finished_at, started_at, locations_synced, employees_synced, employees_matched, employees_unmatched, shifts_synced')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data as HomebaseRun | null;
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('sync_runs')
          .select('function_name, status, finished_at, started_at, rows_processed, rows_failed, error_message')
          .eq('function_name', 'sync-homebase')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data as SyncRun | null;
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('homebase_locations')
          .select('state, synced_at')
          .range(0, 9999);
        if (error) throw error;
        return (data ?? []) as HomebaseLocation[];
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('homebase_employees')
          .select('profile_id, match_confidence, synced_at')
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as HomebaseEmployee[];
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('homebase_shifts')
          .select('role, department, scheduled_hours, published, scheduled, start_at, synced_at, homebase_employee_id')
          .gte('start_at', start)
          .lt('start_at', end)
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as HomebaseShift[];
      }),
      settle(async () => {
        const { data, error } = await clinopsSupabase
          .from('provider_pay_rates')
          .select('provider_id, source, effective_from, effective_to, created_at')
          .ilike('source', 'homebase%')
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as PayRateAuditRow[];
      }),
    ]);

  const run = runResult.ok ? runResult.value : null;
  const genericRun = syncRunResult.ok ? syncRunResult.value : null;
  const locations = locationsResult.ok ? locationsResult.value : [];
  const employees = employeesResult.ok ? employeesResult.value : [];
  const shifts = shiftsResult.ok ? shiftsResult.value : [];
  const rates = ratesResult.ok ? ratesResult.value : [];
  const errors = [runResult, syncRunResult, locationsResult, employeesResult, shiftsResult, ratesResult]
    .filter((r): r is { ok: false; error: string } => !r.ok)
    .map(r => r.error);

  const matchedEmployees = employees.filter(e => Boolean(e.profile_id)).length;
  const unmatchedEmployees = employees.length - matchedEmployees;
  const scheduledHours = shifts.reduce((sum, row) => sum + Number(row.scheduled_hours ?? 0), 0);
  const publishedShifts = shifts.filter(row => row.published).length;
  const unscheduledRows = shifts.filter(row => row.scheduled === false).length;
  const shiftsWithoutEmployee = shifts.filter(row => !row.homebase_employee_id).length;
  const updatedAt = maxIso([
    run?.finished_at,
    genericRun?.finished_at,
    maxIso(locations.map(r => r.synced_at)),
    maxIso(employees.map(r => r.synced_at)),
    maxIso(shifts.map(r => r.synced_at)),
    maxIso(rates.map(r => r.created_at)),
  ]);

  return {
    id: 'homebase',
    title: 'Homebase',
    status: statusFromFreshness(updatedAt, locations.length > 0 || employees.length > 0 || shifts.length > 0, errors.length > 0),
    updatedAt,
    error: errors[0],
    metrics: [
      { label: 'Latest sync', value: run?.status ?? genericRun?.status ?? 'No run found', tone: run?.status === 'success' || genericRun?.status === 'success' ? 'good' : 'warn' },
      { label: 'Locations', value: fmtInt(locations.length || run?.locations_synced) },
      { label: 'Employees', value: `${fmtInt(employees.length || run?.employees_synced)} total · ${fmtInt(matchedEmployees || run?.employees_matched)} matched · ${fmtInt(unmatchedEmployees || run?.employees_unmatched)} unmatched`, tone: unmatchedEmployees > 0 ? 'warn' : 'good' },
      { label: 'Near-term shifts', value: `${fmtInt(shifts.length)} shifts · ${fmtHours(scheduledHours)} hrs` },
      { label: 'Published / scheduled', value: `${fmtInt(publishedShifts)} published · ${fmtInt(unscheduledRows)} unscheduled` },
      { label: 'Homebase rates', value: `${fmtInt(rates.length)} active/source rows`, tone: rates.length ? 'good' : 'warn' },
    ],
    fieldCoverage: [
      'locations: uuid, name/address/state/time zone, synced_at',
      'employees: Homebase id, name, email, location, provider match, match confidence',
      'near-term shifts: Homebase id, user/employee link, location, role, department, start/end, hours, published/scheduled',
      'rates: provider_pay_rates from sync-homebase-rates when deployed',
    ],
    gaps: [
      'Homebase only covers the live near-term calendar; Jotform is the source of truth for monthly scheduling recommendations',
      shiftsWithoutEmployee > 0 ? `${fmtInt(shiftsWithoutEmployee)} near-term shifts have no linked Homebase employee row` : '',
      unmatchedEmployees > 0 ? `${fmtInt(unmatchedEmployees)} employees are not matched to provider profiles` : '',
      'Raw Homebase API payloads are not preserved in first-class audit tables today',
    ].filter(Boolean),
    details: [
      ...topCounts(shifts, row => row.role, 5).map(r => ({ label: `role: ${r.label}`, count: r.count })),
      ...topCounts(shifts, row => row.department, 3).map(r => ({ label: `department: ${r.label}`, count: r.count })),
      ...topCounts(locations, row => row.state, 4).map(r => ({ label: `location state: ${r.label}`, count: r.count })),
    ],
  };
}

async function getMetabaseAudit(month: string): Promise<SourceAuditSection> {
  const start = monthIso(month);
  const end = nextMonthIso(month);

  const [syncRunResult, rawExportsResult, leftoverResult, slaResult, providerUtilResult, providerUtilDailyResult, networkUtilResult, targetsResult, serviceLineResult, forecastResult, slaDailyResult, pcpCoverageResult, activeStateResult] =
    await Promise.all([
      settle(async () => {
        const { data, error } = await supabase
          .from('sync_runs')
          .select('function_name, status, finished_at, started_at, rows_processed, rows_failed, error_message')
          .eq('function_name', 'sync-metabase')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data as SyncRun | null;
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('metabase_raw_exports')
          .select('report_key, pulled_at, pulled_date, row_count')
          .order('pulled_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return (data ?? []) as RawExport[];
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('state_leftover_slots')
          .select('state_abbreviation, unfilled_slots, synced_at, imported_at')
          .gte('slot_date', start)
          .lt('slot_date', end)
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as LeftoverSlot[];
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('state_sla_attainment')
          .select('state_abbreviation, sla_pct, synced_at, imported_at')
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as SlaAttainment[];
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('provider_utilization')
          .select('synced_at, imported_at')
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as UtilizationRow[];
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('provider_utilization_daily')
          .select('synced_at, imported_at')
          .gte('util_date', start)
          .lt('util_date', end)
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as UtilizationRow[];
      }),
      settle(async () => {
        const { data, error } = await supabase
          .from('utilization_daily')
          .select('synced_at, imported_at')
          .gte('util_date', start)
          .lt('util_date', end)
          .range(0, 9999);
        if (error) throw error;
        return (data ?? []) as UtilizationRow[];
      }),
      settle(async () => {
        const { data, error } = await clinopsSupabase
          .from('state_demand_targets')
          .select('state, computed_at')
          .eq('month', start)
          .range(0, 9999);
        if (error) throw error;
        return (data ?? []) as ClinopsDemandTarget[];
      }),
      settle(async () => {
        const { data, error } = await clinopsSupabase
          .from('service_line_demand_targets')
          .select('service_line, computed_at')
          .eq('month', start)
          .range(0, 9999);
        if (error) throw error;
        return (data ?? []) as ClinopsServiceLineTarget[];
      }),
      settle(async () => {
        const { data, error } = await clinopsSupabase
          .from('demand_forecast')
          .select('state, computed_at')
          .gte('date', start)
          .lt('date', end)
          .eq('is_baseline', true)
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as ClinopsDemandDay[];
      }),
      settle(async () => {
        const { data, error } = await clinopsSupabase
          .from('sla_daily')
          .select('state, date, computed_at')
          .gte('date', start)
          .lt('date', end)
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as ClinopsSlaDay[];
      }),
      settle(async () => {
        const { data, error } = await clinopsSupabase
          .from('metabase_pcp_state_coverage')
          .select('provider_id, state, is_active, report_date, synced_at')
          .order('synced_at', { ascending: false })
          .limit(5000);
        if (error) throw error;
        return (data ?? []) as MetabasePcpCoverageRow[];
      }),
      settle(async () => {
        const { data, error } = await clinopsSupabase
          .from('provider_state_active')
          .select('provider_id, state, is_active, source, synced_at')
          .eq('source', 'metabase_pcp_state_coverage')
          .range(0, 49999);
        if (error) throw error;
        return (data ?? []) as ProviderStateActiveRow[];
      }),
    ]);

  const syncRun = syncRunResult.ok ? syncRunResult.value : null;
  const rawExports = rawExportsResult.ok ? rawExportsResult.value : [];
  const latestRawByReport = new Map<string, RawExport>();
  for (const row of rawExports) {
    if (!latestRawByReport.has(row.report_key)) latestRawByReport.set(row.report_key, row);
  }
  const leftover = leftoverResult.ok ? leftoverResult.value : [];
  const sla = slaResult.ok ? slaResult.value : [];
  const providerUtil = providerUtilResult.ok ? providerUtilResult.value : [];
  const providerUtilDaily = providerUtilDailyResult.ok ? providerUtilDailyResult.value : [];
  const networkUtil = networkUtilResult.ok ? networkUtilResult.value : [];
  const targets = targetsResult.ok ? targetsResult.value : [];
  const serviceLines = serviceLineResult.ok ? serviceLineResult.value : [];
  const forecast = forecastResult.ok ? forecastResult.value : [];
  const slaDaily = slaDailyResult.ok ? slaDailyResult.value : [];
  const pcpCoverage = pcpCoverageResult.ok ? pcpCoverageResult.value : [];
  const activeStates = activeStateResult.ok ? activeStateResult.value : [];
  const errors = [
    syncRunResult,
    rawExportsResult,
    leftoverResult,
    slaResult,
    providerUtilResult,
    providerUtilDailyResult,
    networkUtilResult,
    targetsResult,
    serviceLineResult,
    forecastResult,
    slaDailyResult,
    pcpCoverageResult,
    activeStateResult,
  ]
    .filter((r): r is { ok: false; error: string } => !r.ok)
    .map(r => r.error);
  const updatedAt = maxIso([
    syncRun?.finished_at,
    maxIso(Array.from(latestRawByReport.values()).map(r => r.pulled_at)),
    maxIso(leftover.map(r => r.synced_at ?? r.imported_at)),
    maxIso(sla.map(r => r.synced_at ?? r.imported_at)),
    maxIso(providerUtil.map(r => r.synced_at ?? r.imported_at)),
    maxIso(providerUtilDaily.map(r => r.synced_at ?? r.imported_at)),
    maxIso(networkUtil.map(r => r.synced_at ?? r.imported_at)),
    maxIso(targets.map(r => r.computed_at)),
    maxIso(serviceLines.map(r => r.computed_at)),
    maxIso(forecast.map(r => r.computed_at)),
    maxIso(slaDaily.map(r => r.computed_at)),
    maxIso(pcpCoverage.map(r => r.synced_at)),
    maxIso(activeStates.map(r => r.synced_at)),
  ]);

  const leftoverSlots = leftover.reduce((sum, row) => sum + Number(row.unfilled_slots ?? 0), 0);
  const activeStateProviders = new Set(activeStates.map(row => row.provider_id)).size;
  const activeStateRows = activeStates.filter(row => row.is_active).length;
  const inactiveStateRows = activeStates.filter(row => !row.is_active).length;

  return {
    id: 'metabase',
    title: 'Metabase',
    status: statusFromFreshness(updatedAt, rawExports.length > 0 || targets.length > 0 || forecast.length > 0 || activeStates.length > 0, errors.length > 0),
    updatedAt,
    error: errors[0],
    metrics: [
      { label: 'Latest sync', value: syncRun?.status ?? 'No sync-metabase run found', tone: syncRun?.status === 'success' ? 'good' : 'warn' },
      { label: 'Raw reports', value: `${fmtInt(latestRawByReport.size)} report keys` },
      { label: 'ClinOps forecast', value: `${fmtInt(targets.length)} state targets · ${fmtInt(serviceLines.length)} service lines · ${fmtInt(forecast.length)} daily rows` },
      { label: 'SLA/access', value: `${fmtInt(sla.length)} state rows · ${fmtInt(slaDaily.length)} daily ClinOps rows` },
      { label: 'PCP active states', value: `${fmtInt(activeStates.length)} provider-state rows · ${fmtInt(activeStateRows)} active · ${fmtInt(inactiveStateRows)} inactive`, tone: activeStates.length ? 'good' : 'warn' },
      { label: 'PCP coverage raw', value: `${fmtInt(pcpCoverage.length)} card 2940 rows · ${fmtInt(activeStateProviders)} matched providers` },
      { label: 'Leftover slots', value: `${fmtInt(leftover.length)} rows · ${fmtInt(leftoverSlots)} slots` },
      { label: 'Utilization', value: `${fmtInt(providerUtil.length)} provider rows · ${fmtInt(providerUtilDaily.length)} daily provider rows · ${fmtInt(networkUtil.length)} network rows` },
    ],
    fieldCoverage: [
      'forecast cards: telehealth 2974, MH coaching 2973, therapy 2971 via compute-demand-forecast',
      'active-state overlay: PCP state coverage card 2940 via compute-demand-forecast',
      'raw exports: SLA MTD, telemedicine availability, PCP coverage, provider appointment count',
      'tables: state demand, daily forecast, SLA, leftover slots, provider utilization',
    ],
    gaps: [
      'In-home scheduling is intentionally excluded from this simplified monthly forecast',
      activeStates.length === 0 ? 'No matched Metabase PCP active-state rows are available yet; allocation falls back to license sources until card 2940 syncs' : '',
      'Raw Metabase rows are only preserved for reports configured with metabase_raw_exports',
    ].filter(Boolean),
    details: [
      ...Array.from(latestRawByReport.values())
        .sort((a, b) => b.pulled_at.localeCompare(a.pulled_at))
        .slice(0, 8)
        .map(row => ({ label: `raw: ${row.report_key}`, count: row.row_count })),
      ...topCounts(activeStates, row => row.state, 5).map(r => ({ label: `active state: ${r.label}`, count: r.count })),
      ...topCounts(leftover, row => row.state_abbreviation, 5).map(r => ({ label: `leftover state: ${r.label}`, count: r.count })),
    ],
  };
}

async function getJotformAudit(month: string): Promise<SourceAuditSection> {
  const start = monthIso(month);

  const [submissionsResult, shiftsResult] = await Promise.all([
    settle(async () => {
      const { data, error } = await clinopsSupabase
        .from('schedule_submissions')
        .select('id, provider_id, provider_name, decision_status, raw_answers, parsed_shifts, validation_status, submitted_at')
        .eq('target_month', start)
        .range(0, 49999);
      if (error) throw error;
      return (data ?? []) as JotformSubmission[];
    }),
    settle(async () => {
      const { data, error } = await clinopsSupabase
        .from('shift_recommendations')
        .select('provider_id, publish_status, recommendation, created_at')
        .eq('target_month', start)
        .range(0, 49999);
      if (error) throw error;
      return (data ?? []) as ShiftRecommendationAuditRow[];
    }),
  ]);

  const submissions = submissionsResult.ok ? submissionsResult.value : [];
  const shifts = shiftsResult.ok ? shiftsResult.value : [];
  const errors = [submissionsResult, shiftsResult]
    .filter((r): r is { ok: false; error: string } => !r.ok)
    .map(r => r.error);

  const matched = submissions.filter(row => Boolean(row.provider_id)).length;
  const unmatched = submissions.length - matched;
  const rawPresent = submissions.filter(row => Boolean(row.raw_answers)).length;
  const parsedPresent = submissions.filter(row => parsedHasAvailability(row.parsed_shifts)).length;
  const needsReview = submissions.filter(row =>
    row.validation_status === 'needs_review' || row.decision_status === 'needs_review',
  ).length;
  const statusCounts = topCounts(submissions, row => row.decision_status ?? 'pending', 8);
  const recommendations = shifts.filter(row => row.recommendation === 'publish').length;
  const updatedAt = maxIso([
    maxIso(submissions.map(row => row.submitted_at)),
    maxIso(shifts.map(row => row.created_at)),
  ]);

  return {
    id: 'jotform',
    title: 'Jotform',
    status: statusFromFreshness(updatedAt, submissions.length > 0, errors.length > 0),
    updatedAt,
    error: errors[0],
    metrics: [
      { label: 'Submissions', value: `${fmtInt(submissions.length)} total · ${fmtInt(matched)} matched · ${fmtInt(unmatched)} unmatched`, tone: unmatched > 0 ? 'warn' : 'good' },
      { label: 'Raw answers', value: `${fmtInt(rawPresent)} preserved` },
      { label: 'Parsed availability', value: `${fmtInt(parsedPresent)} with usable shift widgets`, tone: parsedPresent === submissions.length || submissions.length === 0 ? 'good' : 'warn' },
      { label: 'Needs review', value: fmtInt(needsReview), tone: needsReview > 0 ? 'warn' : 'good' },
      { label: 'Publish rows', value: `${fmtInt(recommendations)} publish recommendations` },
    ],
    fieldCoverage: [
      'raw_answers: full Jotform answer payload',
      'parsed_shifts: requested states/hours, shift types, virtual/in-home widgets, unavailable dates, travel radius, comments, NPS/feedback',
      'validation: raw/normalized/effective hours, warnings, normalized slots, duplicate/unavailable reductions',
      'decisions: accepted/declined/needs-review status and evaluator notes',
    ],
    gaps: [
      'sync-jotform-submissions does not currently write a generic sync_runs audit row',
      'Jotform sync skips submissions without a target month before they reach schedule_submissions',
    ],
    details: [
      ...statusCounts.map(r => ({ label: `decision: ${r.label}`, count: r.count })),
      ...topCounts(submissions, row => row.validation_status ?? 'validation unset', 4).map(r => ({ label: r.label, count: r.count })),
    ],
  };
}

async function getMedallionAudit(): Promise<SourceAuditSection> {
  const [runResult, licensesResult] = await Promise.all([
    settle(async () => {
      const { data, error } = await clinopsSupabase
        .from('sync_runs')
        .select('function_name, status, finished_at, started_at, rows_processed, rows_failed, error_message')
        .eq('function_name', 'sync-medallion-licenses')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ClinopsSyncRun | null;
    }),
    settle(async () => {
      const { data, error } = await clinopsSupabase
        .from('medallion_provider_licenses')
        .select('provider_id, provider_name, medallion_provider_id, state, status, expiration_date, synced_at')
        .range(0, 49999);
      if (error) throw error;
      return (data ?? []) as MedallionLicenseRow[];
    }),
  ]);

  const run = runResult.ok ? runResult.value : null;
  const licenses = licensesResult.ok ? licensesResult.value : [];
  const errors = [runResult, licensesResult]
    .filter((r): r is { ok: false; error: string } => !r.ok)
    .map(r => r.error);

  const matched = licenses.filter(row => Boolean(row.provider_id)).length;
  const active = licenses.filter(row => isAllocationLicenseStatus(row.status)).length;
  const expiring = licenses.filter(row => expiresWithinDays(row.expiration_date, 45)).length;
  const providers = new Set(licenses.map(row => row.provider_id ?? row.medallion_provider_id ?? row.provider_name).filter(Boolean)).size;
  const states = new Set(licenses.map(row => row.state).filter(Boolean)).size;
  const updatedAt = maxIso([
    run?.finished_at,
    maxIso(licenses.map(row => row.synced_at)),
  ]);

  return {
    id: 'medallion',
    title: 'Medallion',
    status: statusFromFreshness(updatedAt, licenses.length > 0 || Boolean(run), errors.length > 0),
    updatedAt,
    error: errors[0],
    metrics: [
      { label: 'Latest sync', value: run?.status ?? 'No sync run found', tone: run?.status === 'success' ? 'good' : 'warn' },
      { label: 'License rows', value: `${fmtInt(licenses.length)} total · ${fmtInt(active)} allocation-active` },
      { label: 'Matched providers', value: `${fmtInt(matched)} matched · ${fmtInt(licenses.length - matched)} unmatched`, tone: licenses.length === matched ? 'good' : 'warn' },
      { label: 'Coverage breadth', value: `${fmtInt(providers)} providers · ${fmtInt(states)} states` },
      { label: 'Expiring soon', value: `${fmtInt(expiring)} within 45 days`, tone: expiring > 0 ? 'warn' : 'good' },
    ],
    fieldCoverage: [
      'Medallion API licenses: provider identity, state, status, license number/type, issue and expiration dates',
      'Provider matching: medallion_provider_id, email, NPI, then normalized provider name',
      'Allocation path: medallion_provider_licenses → v_provider_state_eligibility → evaluator',
    ],
    gaps: [
      licenses.length === 0 ? 'No Medallion license rows have synced yet' : '',
      licenses.length - matched > 0 ? `${fmtInt(licenses.length - matched)} Medallion rows are not matched to ClinOps providers` : '',
      expiring > 0 ? `${fmtInt(expiring)} Medallion licenses expire within 45 days` : '',
    ].filter(Boolean),
    details: [
      ...topCounts(licenses, row => row.status, 5).map(r => ({ label: `status: ${r.label}`, count: r.count })),
      ...topCounts(licenses, row => row.state, 6).map(r => ({ label: `state: ${r.label}`, count: r.count })),
    ],
  };
}

async function getDirectShiftsAudit(): Promise<SourceAuditSection> {
  const licensesResult = await settle(async () => {
    const { data, error } = await clinopsSupabase
      .from('directshifts_provider_licenses')
      .select('provider_id, provider_email, provider_name, state, status, effective_to, updated_at')
      .range(0, 49999);
    if (error) throw error;
    return (data ?? []) as DirectShiftsLicenseRow[];
  });

  const licenses = licensesResult.ok ? licensesResult.value : [];
  const errors: string[] = licensesResult.ok ? [] : [licensesResult.error];
  const matched = licenses.filter(row => Boolean(row.provider_id)).length;
  const active = licenses.filter(row => isAllocationLicenseStatus(row.status)).length;
  const expiring = licenses.filter(row => expiresWithinDays(row.effective_to, 45)).length;
  const providers = new Set(licenses.map(row => row.provider_id ?? row.provider_email ?? row.provider_name).filter(Boolean)).size;
  const states = new Set(licenses.map(row => row.state).filter(Boolean)).size;
  const updatedAt = maxIso(licenses.map(row => row.updated_at));

  return {
    id: 'directshifts',
    title: 'DirectShifts',
    status: errors.length > 0 ? 'error' : licenses.length > 0 ? 'healthy' : 'missing',
    updatedAt,
    error: errors[0],
    metrics: [
      { label: 'Static rows', value: `${fmtInt(licenses.length)} total · ${fmtInt(active)} allocation-active`, tone: licenses.length ? 'good' : 'warn' },
      { label: 'Provider IDs', value: `${fmtInt(matched)} direct IDs · ${fmtInt(licenses.length - matched)} email/name rows`, tone: licenses.length - matched > 0 ? 'warn' : 'good' },
      { label: 'Coverage breadth', value: `${fmtInt(providers)} providers · ${fmtInt(states)} states` },
      { label: 'Ending soon', value: `${fmtInt(expiring)} within 45 days`, tone: expiring > 0 ? 'warn' : 'good' },
    ],
    fieldCoverage: [
      'Static DirectShifts licenses: provider id/email/name, state, status, license number/type, effective dates',
      'Allocation path: directshifts_provider_licenses → v_provider_state_eligibility → evaluator',
    ],
    gaps: [
      licenses.length === 0 ? 'No DirectShifts static license rows are configured' : '',
      'DirectShifts is static input; refresh rows whenever the DirectShifts roster or licenses change',
      expiring > 0 ? `${fmtInt(expiring)} DirectShifts rows end within 45 days` : '',
    ].filter(Boolean),
    details: [
      ...topCounts(licenses, row => row.status, 5).map(r => ({ label: `status: ${r.label}`, count: r.count })),
      ...topCounts(licenses, row => row.state, 6).map(r => ({ label: `state: ${r.label}`, count: r.count })),
    ],
  };
}

export function useSchedulingSourceAudit(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['scheduling-source-audit', monthStart],
    queryFn: async (): Promise<SchedulingSourceAudit> => {
      const [homebase, metabase, jotform, medallion, directshifts] = await Promise.all([
        getHomebaseAudit(),
        getMetabaseAudit(monthStart),
        getJotformAudit(monthStart),
        getMedallionAudit(),
        getDirectShiftsAudit(),
      ]);
      return {
        month: monthStart,
        homebase,
        metabase,
        jotform,
        medallion,
        directshifts,
      };
    },
    staleTime: 60_000,
  });
}
