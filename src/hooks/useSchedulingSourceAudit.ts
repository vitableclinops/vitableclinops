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
  id: 'homebase' | 'metabase' | 'jotform';
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

type ClinopsSlaDay = {
  state: string;
  date: string;
  computed_at: string;
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

async function getHomebaseAudit(month: string): Promise<SourceAuditSection> {
  const start = monthIso(month);
  const end = nextMonthIso(month);

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
      { label: 'Month shifts', value: `${fmtInt(shifts.length)} shifts · ${fmtHours(scheduledHours)} hrs` },
      { label: 'Published / scheduled', value: `${fmtInt(publishedShifts)} published · ${fmtInt(unscheduledRows)} unscheduled` },
      { label: 'Homebase rates', value: `${fmtInt(rates.length)} active/source rows`, tone: rates.length ? 'good' : 'warn' },
    ],
    fieldCoverage: [
      'locations: uuid, name/address/state/time zone, synced_at',
      'employees: Homebase id, name, email, location, provider match, match confidence',
      'shifts: Homebase id, user/employee link, location, role, department, start/end, hours, published/scheduled',
      'rates: provider_pay_rates from sync-homebase-rates when deployed',
    ],
    gaps: [
      shiftsWithoutEmployee > 0 ? `${fmtInt(shiftsWithoutEmployee)} month shifts have no linked Homebase employee row` : '',
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

  const [syncRunResult, rawExportsResult, leftoverResult, slaResult, providerUtilResult, providerUtilDailyResult, networkUtilResult, targetsResult, forecastResult, slaDailyResult] =
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
  const forecast = forecastResult.ok ? forecastResult.value : [];
  const slaDaily = slaDailyResult.ok ? slaDailyResult.value : [];
  const errors = [
    syncRunResult,
    rawExportsResult,
    leftoverResult,
    slaResult,
    providerUtilResult,
    providerUtilDailyResult,
    networkUtilResult,
    targetsResult,
    forecastResult,
    slaDailyResult,
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
    maxIso(forecast.map(r => r.computed_at)),
    maxIso(slaDaily.map(r => r.computed_at)),
  ]);

  const leftoverSlots = leftover.reduce((sum, row) => sum + Number(row.unfilled_slots ?? 0), 0);

  return {
    id: 'metabase',
    title: 'Metabase',
    status: statusFromFreshness(updatedAt, rawExports.length > 0 || targets.length > 0 || forecast.length > 0, errors.length > 0),
    updatedAt,
    error: errors[0],
    metrics: [
      { label: 'Latest sync', value: syncRun?.status ?? 'No sync-metabase run found', tone: syncRun?.status === 'success' ? 'good' : 'warn' },
      { label: 'Raw reports', value: `${fmtInt(latestRawByReport.size)} report keys` },
      { label: 'ClinOps forecast', value: `${fmtInt(targets.length)} state targets · ${fmtInt(forecast.length)} daily rows` },
      { label: 'SLA/access', value: `${fmtInt(sla.length)} state rows · ${fmtInt(slaDaily.length)} daily ClinOps rows` },
      { label: 'Leftover slots', value: `${fmtInt(leftover.length)} rows · ${fmtInt(leftoverSlots)} slots` },
      { label: 'Utilization', value: `${fmtInt(providerUtil.length)} provider rows · ${fmtInt(providerUtilDaily.length)} daily provider rows · ${fmtInt(networkUtil.length)} network rows` },
    ],
    fieldCoverage: [
      'forecast cards: telehealth, MH coaching, therapy, in-home via compute-demand-forecast',
      'raw exports: SLA MTD, telemedicine availability, PCP coverage, provider appointment count',
      'tables: state demand, daily forecast, SLA, leftover slots, provider utilization',
    ],
    gaps: [
      'Service-line monthly totals from compute-demand-forecast are response-only unless persisted by a future table',
      'Raw Metabase rows are only preserved for reports configured with metabase_raw_exports',
    ],
    details: [
      ...Array.from(latestRawByReport.values())
        .sort((a, b) => b.pulled_at.localeCompare(a.pulled_at))
        .slice(0, 8)
        .map(row => ({ label: `raw: ${row.report_key}`, count: row.row_count })),
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

export function useSchedulingSourceAudit(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['scheduling-source-audit', monthStart],
    queryFn: async (): Promise<SchedulingSourceAudit> => {
      const [homebase, metabase, jotform] = await Promise.all([
        getHomebaseAudit(monthStart),
        getMetabaseAudit(monthStart),
        getJotformAudit(monthStart),
      ]);
      return {
        month: monthStart,
        homebase,
        metabase,
        jotform,
      };
    },
    staleTime: 60_000,
  });
}
