import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import { useAuth } from '@/hooks/useAuth';
import {
  dedupeShiftRecommendationRows,
  filterRowsToLatestAcceptedSubmissions,
  filterRowsToLatestSubmissions,
  type LatestSchedulingSubmission,
} from '@/lib/scheduling/latestSubmissions';

type UntypedSupabaseError = { message?: string };
type UntypedSupabaseResult = {
  data: unknown;
  error: UntypedSupabaseError | null;
  count?: number | null;
};
type UntypedSupabaseQuery = PromiseLike<UntypedSupabaseResult> & {
  select(columns?: string, options?: Record<string, unknown>): UntypedSupabaseQuery;
  insert(payload: unknown, options?: Record<string, unknown>): UntypedSupabaseQuery;
  update(payload: unknown, options?: Record<string, unknown>): UntypedSupabaseQuery;
  upsert(payload: unknown, options?: Record<string, unknown>): UntypedSupabaseQuery;
  delete(options?: Record<string, unknown>): UntypedSupabaseQuery;
  eq(column: string, value: unknown): UntypedSupabaseQuery;
  neq(column: string, value: unknown): UntypedSupabaseQuery;
  is(column: string, value: unknown): UntypedSupabaseQuery;
  in(column: string, values: readonly unknown[]): UntypedSupabaseQuery;
  gte(column: string, value: unknown): UntypedSupabaseQuery;
  lte(column: string, value: unknown): UntypedSupabaseQuery;
  or(filters: string): UntypedSupabaseQuery;
  order(column: string, options?: Record<string, unknown>): UntypedSupabaseQuery;
  range(from: number, to: number): UntypedSupabaseQuery;
  limit(count: number): UntypedSupabaseQuery;
};
type UntypedClinopsClient = {
  from(table: string): UntypedSupabaseQuery;
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ error: UntypedSupabaseError | null }>;
};

const clinopsDb = clinopsSupabase as unknown as UntypedClinopsClient;

export type DecisionStatus =
  | 'pending'
  | 'accepted'
  | 'partial'
  | 'declined'
  | 'needs_review'
  | 'superseded';

export type ParsedShift = {
  date?: string;
  start_time?: string;
  end_time?: string;
  hours?: number;
  shift_type?: string;
  state?: string;
  notes?: string;
  status?: string;
};

export type SubmissionRow = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  decision_status: DecisionStatus;
  accepted_hours: number | null;
  declined_hours: number | null;
  decision_notes: string | null;
  decision_run_id: string | null;
  parsed_shifts: ParsedShift[] | null;
  raw_answers?: unknown;
  submitted_at: string;
  decided_at: string | null;
  validation_status: string | null;
  validation_warnings: unknown;
  raw_requested_hours: number | null;
  normalized_requested_hours: number | null;
  effective_hours_used_for_forecast: number | null;
  human_review_state: 'pending' | 'approved' | 'parked' | null;
  human_review_resolved_at: string | null;
  human_review_resolved_label: string | null;
  human_review_notes: string | null;
};

export type ProviderRow = {
  id: string;
  name: string;
  email: string | null;
  profession: string | null;
  employment_type: string | null;
  employment_status: string | null;
  readiness_status: string | null;
  shift_types: string[] | null;
  source: string | null;
  scheduling_outreach_exempt: boolean | null;
  scheduling_outreach_exemption_reason: string | null;
  active: boolean | null;
};

export type PublishStatusRow = {
  id: string;
  provider_id: string;
  target_month: string;
  homebase_posted_at: string | null;
  homebase_posted_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
  notes: string | null;
};

export type ProviderPublishView = {
  provider_id: string;
  provider_name: string;
  provider_email: string | null;
  profession: string | null;
  employment_type: string | null;
  readiness_status: string | null;
  shift_types: string[] | null;
  provider_source: string | null;
  scheduling_outreach_exempt: boolean | null;
  scheduling_outreach_exemption_reason: string | null;
  submission: SubmissionRow | null;
  publish: PublishStatusRow | null;
};

export type ProviderOutreachLog = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  provider_email: string | null;
  target_month: string;
  outreach_type: string;
  status: string;
  channel: string;
  subject: string | null;
  body: string | null;
  batch_id: string | null;
  sent_at: string;
  sent_by: string | null;
  sent_by_label: string | null;
  notes: string | null;
  created_at: string;
};

export type ProviderSchedulingExceptionRow = {
  provider_id: string;
  provider_name: string;
  provider_email: string | null;
  profession: string | null;
  employment_type: string | null;
  employment_status: string | null;
  scheduling_outreach_exempt: boolean | null;
  scheduling_outreach_exemption_reason: string | null;
  active: boolean | null;
};

export type SchedulingExceptionRow = {
  id: string;
  slug: string;
  name: string;
  exception_type: string | null;
  rule: string;
  scheduling_action: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProviderStateEligibilityRow = {
  provider_id: string | null;
  state: string | null;
  allocation_eligible: boolean | null;
  eligibility_status: string | null;
  license_sources: string[] | null;
  metabase_active: boolean | null;
};

export type ProviderPayRateRow = {
  id: string;
  provider_id: string;
  hourly_rate: number;
  role: string | null;
  effective_from: string;
  effective_to: string | null;
  source: string | null;
  created_at: string | null;
};

export type AvailabilitySubmissionRow = {
  id: string;
  jotform_submission_id: string;
  provider_id: string | null;
  provider_name: string;
  provider_email: string | null;
  provider_profession: string | null;
  target_month: string;
  decision_status: DecisionStatus | string | null;
  accepted_hours: number | null;
  declined_hours: number | null;
  decision_notes: string | null;
  decision_run_id: string | null;
  parsed_shifts: unknown;
  raw_answers: unknown;
  submitted_at: string;
  validation_status: string | null;
  validation_warnings: unknown;
  raw_requested_hours: number | null;
  normalized_requested_hours: number | null;
  effective_hours_used_for_forecast: number | null;
  human_review_state: 'pending' | 'approved' | 'parked' | null;
  human_review_resolved_at: string | null;
  human_review_resolved_label: string | null;
  human_review_notes: string | null;
};

type AvailabilitySubmissionRecord = Omit<
  AvailabilitySubmissionRow,
  'provider_email' | 'provider_profession'
>;

const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m);

const pad2 = (n: number) => String(n).padStart(2, '0');

const monthEndIso = (m: string) => {
  const monthStart = monthIso(m);
  const [year, month] = monthStart.split('-').map(Number);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(endDay)}`;
};

/** Parse a Jotform widget date string like "06-06-2026" or "2026-06-06" into ISO (YYYY-MM-DD). */
const parseFormDateToIso = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // 2026-06-06
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 06-06-2026 or 6/6/2026 (MM-DD-YYYY)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`;
  return null;
};

const expandDateRange = (startIso: string, endIso: string): string[] => {
  const out: string[] = [];
  const s = new Date(`${startIso}T00:00:00Z`);
  const e = new Date(`${endIso}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return [startIso];
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
  }
  return out;
};

export type UnavailableRange = {
  startIso: string;
  endIso: string;
  dates: string[];
};

/**
 * Extract unavailable date ranges from a submission's `parsed_shifts` blob.
 * The Jotform "When will you be unavailable to work?" widget stores rows with
 * Start Date / End Date and supports inclusive ranges; legacy rows may store
 * only `Date`.
 */
/** Mirrors the edge-function `parseWidgetArray`: the Jotform widget often
 *  arrives as a JSON-encoded string rather than a true array. */
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
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is Record<string, unknown> => e != null && typeof e === 'object',
  );
};

export function extractUnavailableRanges(
  parsedShifts: unknown,
  monthIso?: string,
): UnavailableRange[] {
  if (!parsedShifts || typeof parsedShifts !== 'object' || Array.isArray(parsedShifts)) {
    return [];
  }
  const blob = parsedShifts as { unavailable_dates?: unknown };
  const widgetRows = parseWidgetArray(blob.unavailable_dates);
  if (widgetRows.length === 0) return [];
  const monthPrefix = monthIso ? monthIso.slice(0, 7) : null;
  const ranges: UnavailableRange[] = [];
  for (const e of widgetRows) {
    const startIso =
      parseFormDateToIso(e['Start Date']) ?? parseFormDateToIso(e['Date']);
    const endIso =
      parseFormDateToIso(e['End Date']) ?? startIso;
    if (!startIso || !endIso) continue;
    const dates = expandDateRange(startIso, endIso);
    const filtered = monthPrefix ? dates.filter(d => d.startsWith(monthPrefix)) : dates;
    if (filtered.length === 0) continue;
    ranges.push({ startIso, endIso, dates: filtered });
  }
  return ranges;
}

export function useMonthlyPublishView(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'monthly-publish', monthStart],
    queryFn: async (): Promise<ProviderPublishView[]> => {
      const [submissionsRes, providersRes, publishRes] = await Promise.all([
        clinopsSupabase
        .from('schedule_submissions')
        .select(
            'id, provider_id, provider_name, target_month, decision_status, accepted_hours, declined_hours, decision_notes, decision_run_id, parsed_shifts, submitted_at, decided_at, validation_status, validation_warnings, raw_requested_hours, normalized_requested_hours, effective_hours_used_for_forecast, human_review_state, human_review_resolved_at, human_review_resolved_label, human_review_notes',
        )
          .eq('target_month', monthStart)
          .order('submitted_at', { ascending: false }),
        clinopsSupabase
          .from('providers')
          .select(
            'id, name, email, profession, employment_type, employment_status, readiness_status, shift_types, source, scheduling_outreach_exempt, scheduling_outreach_exemption_reason, active',
          ),
        clinopsDb
          .from('publish_status')
          .select('*')
          .eq('target_month', monthStart),
      ]);

      if (submissionsRes.error) throw submissionsRes.error;
      if (providersRes.error) throw providersRes.error;
      if (publishRes.error) throw publishRes.error;

      const submissions = (submissionsRes.data ?? []) as unknown as SubmissionRow[];
      const providers = (providersRes.data ?? []) as unknown as ProviderRow[];
      const publish = (publishRes.data ?? []) as unknown as PublishStatusRow[];

      // Latest submission per provider for the month (rows are submitted_at desc).
      const latestByProvider = new Map<string, SubmissionRow>();
      for (const s of submissions) {
        if (!s.provider_id) continue;
        if (s.decision_status === 'superseded') continue;
        if (!latestByProvider.has(s.provider_id)) latestByProvider.set(s.provider_id, s);
      }

      const publishByProvider = new Map<string, PublishStatusRow>();
      for (const p of publish) publishByProvider.set(p.provider_id, p);

      const rows: ProviderPublishView[] = [];
      for (const p of providers) {
        const submission = latestByProvider.get(p.id) ?? null;
        if (!submission && p.active === false) continue;
        rows.push({
          provider_id: p.id,
          provider_name: p.name,
          provider_email: p.email ?? null,
          profession: p.profession,
          employment_type: p.employment_type,
          readiness_status: p.readiness_status,
          shift_types: p.shift_types,
          provider_source: p.source,
          scheduling_outreach_exempt: p.scheduling_outreach_exempt ?? false,
          scheduling_outreach_exemption_reason: p.scheduling_outreach_exemption_reason ?? null,
          submission,
          publish: publishByProvider.get(p.id) ?? null,
        });
      }

      // Submitters first (most recent), then non-submitters by name.
      rows.sort((a, b) => {
        const aHas = a.submission ? 1 : 0;
        const bHas = b.submission ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        if (a.submission && b.submission) {
          return b.submission.submitted_at.localeCompare(a.submission.submitted_at);
        }
        return a.provider_name.localeCompare(b.provider_name);
      });

      return rows;
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useProviderOutreachLog(month: string | null) {
  const monthStart = month ? monthIso(month) : null;
  return useQuery({
    queryKey: ['workbench', 'provider-outreach-log', monthStart],
    queryFn: async (): Promise<ProviderOutreachLog[]> => {
      if (!monthStart) return [];
      const { data, error } = await clinopsDb
        .from('provider_outreach_log')
        .select(
          'id, provider_id, provider_name, provider_email, target_month, outreach_type, status, channel, subject, body, batch_id, sent_at, sent_by, sent_by_label, notes, created_at',
        )
        .eq('target_month', monthStart)
        .eq('outreach_type', 'missing_availability')
        .order('sent_at', { ascending: false })
        .range(0, 49999);
      if (error) throw error;
      return (data ?? []) as ProviderOutreachLog[];
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useMarkProviderOutreachSent() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      month: string;
      providers: Pick<ProviderPublishView, 'provider_id' | 'provider_name' | 'provider_email'>[];
      subject: string;
      body: string;
      notes?: string | null;
    }) => {
      const monthStart = monthIso(args.month);
      const providers = args.providers.filter(p => p.provider_id);
      if (providers.length === 0) return;

      const nowIso = new Date().toISOString();
      const batchId = crypto.randomUUID();
      const actor = (
        (profile as unknown as { full_name?: string | null; email?: string | null } | null)?.full_name ||
        (profile as unknown as { full_name?: string | null; email?: string | null } | null)?.email ||
        user?.email ||
        'Scheduling team'
      );
      const rows = providers.map(provider => ({
        provider_id: provider.provider_id,
        provider_name: provider.provider_name,
        provider_email: provider.provider_email ?? null,
        target_month: monthStart,
        outreach_type: 'missing_availability',
        status: 'sent',
        channel: 'email',
        subject: args.subject,
        body: args.body,
        batch_id: batchId,
        sent_at: nowIso,
        sent_by: user?.id ?? null,
        sent_by_label: actor,
        notes: args.notes ?? null,
      }));

      const { error } = await clinopsDb
        .from('provider_outreach_log')
        .insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'provider-outreach-log'] });
    },
  });
}

export function useProviderSchedulingExceptions() {
  return useQuery({
    queryKey: ['workbench', 'provider-scheduling-exceptions'],
    queryFn: async (): Promise<ProviderSchedulingExceptionRow[]> => {
      const { data, error } = await clinopsDb
        .from('providers')
        .select(
          'id, name, email, profession, employment_type, employment_status, scheduling_outreach_exempt, scheduling_outreach_exemption_reason, active',
        )
        .eq('scheduling_outreach_exempt', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<{
        id: string;
        name: string;
        email: string | null;
        profession: string | null;
        employment_type: string | null;
        employment_status: string | null;
        scheduling_outreach_exempt: boolean | null;
        scheduling_outreach_exemption_reason: string | null;
        active: boolean | null;
      }>).map((p) => ({
        provider_id: p.id,
        provider_name: p.name,
        provider_email: p.email ?? null,
        profession: p.profession ?? null,
        employment_type: p.employment_type ?? null,
        employment_status: p.employment_status ?? null,
        scheduling_outreach_exempt: p.scheduling_outreach_exempt ?? false,
        scheduling_outreach_exemption_reason: p.scheduling_outreach_exemption_reason ?? null,
        active: p.active ?? null,
      }));
    },
    staleTime: 30_000,
  });
}

const schedulingExceptionSlug = (name: string) => {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return `${base || 'scheduling-exception'}-${crypto.randomUUID().slice(0, 8)}`;
};

export function useSchedulingExceptions() {
  return useQuery({
    queryKey: ['workbench', 'scheduling-exceptions'],
    queryFn: async (): Promise<SchedulingExceptionRow[]> => {
      const { data, error } = await clinopsDb
        .from('scheduling_exceptions')
        .select('id, slug, name, exception_type, rule, scheduling_action, active, created_at, updated_at')
        .eq('active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as SchedulingExceptionRow[];
    },
    staleTime: 30_000,
  });
}

export function useUpsertSchedulingException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id?: string | null;
      name: string;
      exceptionType?: string | null;
      rule: string;
      schedulingAction: string;
    }) => {
      const name = args.name.trim();
      const rule = args.rule.trim();
      const schedulingAction = args.schedulingAction.trim();
      const exceptionType = args.exceptionType?.trim() || null;
      if (!name) throw new Error('Add a provider or case name.');
      if (!rule) throw new Error('Add the scheduling rule.');
      if (!schedulingAction) throw new Error('Add the scheduling action.');

      const payload = {
        name,
        exception_type: exceptionType,
        rule,
        scheduling_action: schedulingAction,
        active: true,
        updated_at: new Date().toISOString(),
      };

      if (args.id) {
        const { error } = await clinopsDb
          .from('scheduling_exceptions')
          .update(payload)
          .eq('id', args.id);
        if (error) throw error;
        return;
      }

      const { error } = await clinopsDb
        .from('scheduling_exceptions')
        .insert({
          ...payload,
          slug: schedulingExceptionSlug(name),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'scheduling-exceptions'] });
    },
  });
}

export function useDeleteSchedulingException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await clinopsDb
        .from('scheduling_exceptions')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'scheduling-exceptions'] });
    },
  });
}

export function useProviderStateEligibility() {
  return useQuery({
    queryKey: ['workbench', 'provider-state-eligibility'],
    queryFn: async (): Promise<ProviderStateEligibilityRow[]> => {
      const { data, error } = await clinopsSupabase
        .from('v_provider_state_eligibility')
        .select('provider_id, state, allocation_eligible, eligibility_status, license_sources, metabase_active')
        .eq('allocation_eligible', true)
        .range(0, 49999);
      if (error) throw error;
      return (data ?? []) as ProviderStateEligibilityRow[];
    },
    staleTime: 30_000,
  });
}

export function useProviderPayRates(month: string) {
  const monthStart = monthIso(month);
  const monthEnd = monthEndIso(month);
  return useQuery({
    queryKey: ['workbench', 'provider-pay-rates', monthStart],
    queryFn: async (): Promise<ProviderPayRateRow[]> => {
      const { data, error } = await clinopsDb
        .from('provider_pay_rates')
        .select('id, provider_id, hourly_rate, role, effective_from, effective_to, source, created_at')
        .lte('effective_from', monthEnd)
        .or(`effective_to.is.null,effective_to.gte.${monthStart}`)
        .order('effective_from', { ascending: false })
        .range(0, 49999);
      if (error) throw error;
      return (data ?? []) as ProviderPayRateRow[];
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useUpsertProviderPayRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      providerId: string;
      hourlyRate: number;
      effectiveFrom: string;
      role?: string | null;
      source?: string | null;
    }) => {
      const hourlyRate = Number(args.hourlyRate);
      if (!args.providerId) throw new Error('Missing provider.');
      if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
        throw new Error('Enter a valid hourly rate.');
      }
      const { error } = await clinopsDb.rpc('upsert_provider_pay_rate', {
        p_provider_id: args.providerId,
        p_hourly_rate: hourlyRate,
        p_effective_from: monthIso(args.effectiveFrom),
        p_role: args.role ?? null,
        p_source: args.source ?? 'manual_workbench',
      });
      if (error) throw new Error(error.message || 'Unable to save provider rate');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'provider-pay-rates'] });
      queryClient.invalidateQueries({ queryKey: ['scheduling-source-audit'] });
    },
  });
}

export function useMonthlyAvailabilitySubmissions(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'availability-submissions', monthStart],
    queryFn: async (): Promise<AvailabilitySubmissionRow[]> => {
      const [submissionsRes, providersRes] = await Promise.all([
        clinopsSupabase
        .from('schedule_submissions')
        .select(
            'id, jotform_submission_id, provider_id, provider_name, target_month, decision_status, accepted_hours, declined_hours, decision_notes, decision_run_id, parsed_shifts, raw_answers, submitted_at, validation_status, validation_warnings, raw_requested_hours, normalized_requested_hours, effective_hours_used_for_forecast, human_review_state, human_review_resolved_at, human_review_resolved_label, human_review_notes',
        )
          .eq('target_month', monthStart)
          .order('submitted_at', { ascending: false })
          .range(0, 49999),
        clinopsSupabase
          .from('providers')
          .select('id, email, profession')
          .range(0, 49999),
      ]);
      if (submissionsRes.error) throw submissionsRes.error;
      if (providersRes.error) throw providersRes.error;

      const providerById = new Map(
        (providersRes.data ?? []).map(p => [
          p.id,
          { email: p.email ?? null, profession: p.profession ?? null },
        ]),
      );

      return ((submissionsRes.data ?? []) as AvailabilitySubmissionRecord[]).map(s => {
        const provider = s.provider_id ? providerById.get(s.provider_id) : null;
        const parsed = (s.parsed_shifts ?? null) as Record<string, unknown> | null;
        const parsedEmail =
          parsed && typeof parsed.email === 'string' && parsed.email.trim()
            ? parsed.email.trim()
            : null;
        return {
          ...(s as unknown as Omit<AvailabilitySubmissionRow, 'provider_email' | 'provider_profession'>),
          provider_email: provider?.email ?? parsedEmail,
          provider_profession: provider?.profession ?? null,
        };
      });
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useTogglePublishStep() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      provider_id: string;
      target_month: string;
      step: 'homebase' | 'ehr';
      done: boolean;
    }) => {
      const monthStart = monthIso(args.target_month);
      const nowIso = new Date().toISOString();
      const actorId = user?.id ?? null;
      const patch: Record<string, unknown> = {
        provider_id: args.provider_id,
        target_month: monthStart,
      };
      if (args.step === 'homebase') {
        patch.homebase_posted_at = args.done ? nowIso : null;
        patch.homebase_posted_by = args.done ? actorId : null;
      } else {
        patch.ehr_posted_at = args.done ? nowIso : null;
        patch.ehr_posted_by = args.done ? actorId : null;
      }
      const { error } = await clinopsDb
        .from('publish_status')
        .upsert(patch, { onConflict: 'provider_id,target_month' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
    },
  });
}

export function useBulkMarkPublishStep() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      provider_ids: string[];
      target_month: string;
      step: 'homebase' | 'ehr';
      done: boolean;
    }) => {
      const monthStart = monthIso(args.target_month);
      const nowIso = new Date().toISOString();
      const actorId = user?.id ?? null;
      const rows = args.provider_ids.map(pid => {
        const base: Record<string, unknown> = {
          provider_id: pid,
          target_month: monthStart,
        };
        if (args.step === 'homebase') {
          base.homebase_posted_at = args.done ? nowIso : null;
          base.homebase_posted_by = args.done ? actorId : null;
        } else {
          base.ehr_posted_at = args.done ? nowIso : null;
          base.ehr_posted_by = args.done ? actorId : null;
        }
        return base;
      });
      if (rows.length === 0) return;
      const { error } = await clinopsDb
        .from('publish_status')
        .upsert(rows, { onConflict: 'provider_id,target_month' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
    },
  });
}

export function useUpdatePublishNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      provider_id: string;
      target_month: string;
      notes: string | null;
    }) => {
      const monthStart = monthIso(args.target_month);
      const { error } = await clinopsDb
        .from('publish_status')
        .upsert(
          {
            provider_id: args.provider_id,
            target_month: monthStart,
            notes: args.notes,
          },
          { onConflict: 'provider_id,target_month' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
    },
  });
}

export function useOverrideDecision() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      submission_id: string;
      decision: 'accepted' | 'declined';
      hours_basis: number | null;
      actor_label: string;
      existing_notes: string | null;
    }) => {
      const nowIso = new Date().toISOString();
      const actor = args.actor_label || profile?.full_name || profile?.email || 'ClinOps';
      const auditLine = `Manual override: ${args.decision} by ${actor} at ${nowIso}`;
      const newNotes = args.existing_notes
        ? `${args.existing_notes}\n${auditLine}`
        : auditLine;
      const hours = args.hours_basis ?? 0;
      const patch: Record<string, unknown> = {
        decision_status: args.decision,
        accepted_hours: args.decision === 'accepted' ? hours : 0,
        declined_hours: args.decision === 'declined' ? hours : 0,
        decided_at: nowIso,
        decision_notes: newNotes,
      };
      const { error } = await clinopsSupabase
        .from('schedule_submissions')
        .update(patch)
        .eq('id', args.submission_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'state-coverage'] });
    },
  });
}

// ── Per-shift publishing ──────────────────────────────────────────────────
// Backed by `shift_recommendations`, the canonical post-evaluation per-shift
// table the evaluator already populates with shift_date / start_min / end_min /
// hours / assigned_state / recommendation. We filter to recommendation='publish'
// so Sarabjeet sees exactly the shifts that need to land in Homebase + EHR.
//
// Linear status flow per shift, tracked on the same row:
//   publish_status='pending'                → not started
//   publish_status='published_to_homebase'  → Homebase done, EHR pending
//   publish_status='confirmed'              → Homebase + EHR both done
// EHR timestamps go in ehr_posted_at / ehr_posted_by (added in the
// 20260506200000 migration).

export type ShiftRow = {
  id: string;
  submission_id: string;
  provider_id: string | null;
  provider_name: string;
  provider_time_zone?: string | null;
  target_month: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  hours: number;
  shift_type: string;
  assigned_state: string | null;
  recommendation: string;
  recommendation_reason: string | null;
  decision_run_id: string | null;
  publish_status: string;
  published_at: string | null;
  published_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
};

export type ShiftPublishStep = 'homebase' | 'ehr';

export type SchedulingPipelineStage =
  | 'intake'
  | 'allocated'
  | 'review'
  | 'locked'
  | 'published'
  | 'amend';

export type ScheduleBuildStatus =
  | 'draft'
  | 'review'
  | 'locked'
  | 'published'
  | 'superseded';

export type ScheduleBuild = {
  id: string;
  target_month: string;
  version_number: number;
  status: ScheduleBuildStatus;
  source_decision_run_id: string | null;
  source: string;
  created_by: string | null;
  created_by_label: string | null;
  notes: string | null;
  locked_at: string | null;
  locked_by: string | null;
  locked_by_label: string | null;
  published_at: string | null;
  published_by: string | null;
  published_by_label: string | null;
  created_at: string;
  updated_at: string;
};

export type SchedulingMonthWorkflow = {
  id: string;
  target_month: string;
  current_stage: SchedulingPipelineStage;
  active_build_id: string | null;
  locked_build_id: string | null;
  intake_started_at: string;
  review_started_at: string | null;
  locked_at: string | null;
  published_at: string | null;
  amendment_started_at: string | null;
  updated_by: string | null;
  updated_by_label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleAmendmentRequest = {
  id: string;
  target_month: string;
  build_id: string | null;
  submission_id: string | null;
  provider_id: string | null;
  provider_name: string;
  request_type: 'resubmission' | 'manual_review' | 'post_publish_change';
  status: 'requested' | 'approved' | 'parked' | 'applied' | 'rejected';
  summary: string | null;
  notes: string | null;
  requested_by: string | null;
  requested_by_label: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_label: string | null;
  created_at: string;
  updated_at: string;
};

export type SchedulingPipelineState = {
  workflow: SchedulingMonthWorkflow | null;
  builds: ScheduleBuild[];
  activeBuild: ScheduleBuild | null;
  amendments: ScheduleAmendmentRequest[];
};

type ShiftRecommendationSnapshotRow = ShiftRow & {
  source_shift_recommendation_id?: string | null;
};

const pipelineQueryKey = (monthStart: string) => ['workbench', 'scheduling-pipeline', monthStart];

type ProviderSchedulingPreferenceRow = {
  provider_id: string | null;
  time_zone: string | null;
};

const attachProviderSchedulingPreferences = async (shifts: ShiftRow[]): Promise<ShiftRow[]> => {
  const providerIds = Array.from(new Set(
    shifts.map(s => s.provider_id).filter((id): id is string => Boolean(id)),
  ));
  if (providerIds.length === 0) return shifts;
  const { data, error } = await clinopsDb
    .from('provider_scheduling_preferences')
    .select('provider_id, time_zone')
    .in('provider_id', providerIds)
    .range(0, 9999);
  if (error) {
    console.warn('provider_scheduling_preferences read failed:', error.message);
    return shifts;
  }
  const timeZoneByProvider = new Map(
    ((data ?? []) as ProviderSchedulingPreferenceRow[])
      .filter(row => row.provider_id)
      .map(row => [row.provider_id!, row.time_zone]),
  );
  return shifts.map(shift => ({
    ...shift,
    provider_time_zone: shift.provider_id ? timeZoneByProvider.get(shift.provider_id) ?? null : null,
  }));
};

const padMin = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const formatShiftTime = (mins: number) => padMin(mins);

export const isHomebaseDone = (row: { publish_status: string }) =>
  row.publish_status === 'published_to_homebase' || row.publish_status === 'confirmed';

export const isEhrDone = (row: { publish_status: string; ehr_posted_at?: string | null }) =>
  row.publish_status === 'confirmed' || !!row.ehr_posted_at;

/**
 * Cross-month shift_recommendations for the inbox's published-shift
 * collision check. Same window as useResubmissionInbox so the signals
 * line up with the cards.
 */
export function useShiftRecommendationsInboxWindow(anchorMonth: string) {
  const { fromMonth, toMonth } = inboxWindowBounds(anchorMonth);
  return useQuery({
    queryKey: ['workbench', 'shift-recommendations-inbox', fromMonth, toMonth],
    queryFn: async (): Promise<ShiftRow[]> => {
      const [shiftsRes, submissionsRes] = await Promise.all([
        clinopsDb
          .from('shift_recommendations')
          .select(
            'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, hours, shift_type, assigned_state, recommendation, recommendation_reason, decision_run_id, publish_status, published_at, published_by, ehr_posted_at, ehr_posted_by',
          )
          .gte('target_month', fromMonth)
          .lte('target_month', toMonth)
          .eq('recommendation', 'publish')
          .order('shift_date', { ascending: true })
          .range(0, 19999),
        clinopsDb
          .from('schedule_submissions')
          .select('id, provider_id, target_month, decision_status, submitted_at')
          .gte('target_month', fromMonth)
          .lte('target_month', toMonth)
          .range(0, 19999),
      ]);
      if (shiftsRes.error) throw shiftsRes.error;
      if (submissionsRes.error) throw submissionsRes.error;
      const rawRows = (shiftsRes.data ?? []) as ShiftRow[];
      const submissions = (submissionsRes.data ?? []) as LatestSchedulingSubmission[];
      const scopedRows = dedupeShiftRecommendationRows(
        filterRowsToLatestAcceptedSubmissions(rawRows, submissions),
      );
      return attachProviderSchedulingPreferences(scopedRows);
    },
    staleTime: 30_000,
  });
}

export function useShiftRecommendationsForMonth(
  month: string,
  recommendation: 'publish' | 'cut' | 'all' = 'publish',
) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'shift-recommendations', monthStart, recommendation],
    queryFn: async (): Promise<ShiftRow[]> => {
      let query = clinopsDb
        .from('shift_recommendations')
        .select(
          'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, hours, shift_type, assigned_state, recommendation, recommendation_reason, decision_run_id, publish_status, published_at, published_by, ehr_posted_at, ehr_posted_by',
        )
        .eq('target_month', monthStart);
      if (recommendation !== 'all') query = query.eq('recommendation', recommendation);
      const [shiftsRes, submissionsRes] = await Promise.all([
        query
          .order('shift_date', { ascending: true })
          .order('start_min', { ascending: true })
          .range(0, 9999),
        clinopsDb
          .from('schedule_submissions')
          .select('id, provider_id, target_month, decision_status, submitted_at')
          .eq('target_month', monthStart)
          .range(0, 9999),
      ]);
      if (shiftsRes.error) throw shiftsRes.error;
      if (submissionsRes.error) throw submissionsRes.error;
      const rawRows = (shiftsRes.data ?? []) as ShiftRow[];
      const submissions = (submissionsRes.data ?? []) as LatestSchedulingSubmission[];
      const scopedRows =
        recommendation === 'publish'
          ? filterRowsToLatestAcceptedSubmissions(rawRows, submissions)
          : filterRowsToLatestSubmissions(rawRows, submissions);
      const dedupedRows = dedupeShiftRecommendationRows(scopedRows);
      return attachProviderSchedulingPreferences(dedupedRows);
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useSchedulingPipeline(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: pipelineQueryKey(monthStart),
    queryFn: async (): Promise<SchedulingPipelineState> => {
      const [workflowRes, buildsRes, amendmentsRes] = await Promise.all([
        clinopsDb
          .from('scheduling_month_workflows')
          .select(
            'id, target_month, current_stage, active_build_id, locked_build_id, intake_started_at, review_started_at, locked_at, published_at, amendment_started_at, updated_by, updated_by_label, notes, created_at, updated_at',
          )
          .eq('target_month', monthStart)
          .range(0, 0),
        clinopsDb
          .from('schedule_builds')
          .select(
            'id, target_month, version_number, status, source_decision_run_id, source, created_by, created_by_label, notes, locked_at, locked_by, locked_by_label, published_at, published_by, published_by_label, created_at, updated_at',
          )
          .eq('target_month', monthStart)
          .order('version_number', { ascending: false })
          .range(0, 49),
        clinopsDb
          .from('schedule_amendment_requests')
          .select(
            'id, target_month, build_id, submission_id, provider_id, provider_name, request_type, status, summary, notes, requested_by, requested_by_label, resolved_at, resolved_by, resolved_by_label, created_at, updated_at',
          )
          .eq('target_month', monthStart)
          .order('created_at', { ascending: false })
          .range(0, 199),
      ]);
      if (workflowRes.error) throw workflowRes.error;
      if (buildsRes.error) throw buildsRes.error;
      if (amendmentsRes.error) throw amendmentsRes.error;
      const workflow = ((workflowRes.data ?? []) as SchedulingMonthWorkflow[])[0] ?? null;
      const builds = (buildsRes.data ?? []) as ScheduleBuild[];
      const activeBuild =
        (workflow?.active_build_id
          ? builds.find(build => build.id === workflow.active_build_id)
          : null) ??
        builds.find(build => ['review', 'locked', 'published'].includes(build.status)) ??
        null;
      return {
        workflow,
        builds,
        activeBuild,
        amendments: (amendmentsRes.data ?? []) as ScheduleAmendmentRequest[],
      };
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useCreateScheduleDraft() {
  const queryClient = useQueryClient();
  const { actorId, actorLabel } = useActorLabel();
  return useMutation({
    mutationFn: async (args: { month: string; notes?: string }) => {
      const monthStart = monthIso(args.month);
      const nowIso = new Date().toISOString();
      const [existingBuildsRes, shiftsRes] = await Promise.all([
        clinopsDb
          .from('schedule_builds')
          .select('version_number')
          .eq('target_month', monthStart)
          .order('version_number', { ascending: false })
          .range(0, 0),
        clinopsDb
          .from('shift_recommendations')
          .select(
            'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, hours, shift_type, assigned_state, recommendation, recommendation_reason, decision_run_id, publish_status, published_at, ehr_posted_at',
          )
          .eq('target_month', monthStart)
          .order('shift_date', { ascending: true })
          .order('start_min', { ascending: true })
          .range(0, 49999),
      ]);
      if (existingBuildsRes.error) throw existingBuildsRes.error;
      if (shiftsRes.error) throw shiftsRes.error;

      const shifts = (shiftsRes.data ?? []) as ShiftRecommendationSnapshotRow[];
      if (shifts.length === 0) {
        throw new Error('No shift recommendation rows exist yet. Run allocation before creating Draft v1.');
      }

      const latestVersion = Number(
        ((existingBuildsRes.data ?? []) as Array<{ version_number?: number | string }>)[0]?.version_number ?? 0,
      );
      const versionNumber = Number.isFinite(latestVersion) ? latestVersion + 1 : 1;

      const { error: supersedeError } = await clinopsDb
        .from('schedule_builds')
        .update({ status: 'superseded', updated_at: nowIso })
        .eq('target_month', monthStart)
        .in('status', ['draft', 'review']);
      if (supersedeError) throw supersedeError;

      const sourceDecisionRunId =
        shifts.find(shift => shift.decision_run_id)?.decision_run_id ?? null;
      const buildRes = await clinopsDb
        .from('schedule_builds')
        .insert({
          target_month: monthStart,
          version_number: versionNumber,
          status: 'review',
          source_decision_run_id: sourceDecisionRunId,
          created_by: actorId,
          created_by_label: actorLabel,
          notes: args.notes ?? null,
          updated_at: nowIso,
        })
        .select(
          'id, target_month, version_number, status, source_decision_run_id, source, created_by, created_by_label, notes, locked_at, locked_by, locked_by_label, published_at, published_by, published_by_label, created_at, updated_at',
        )
        .range(0, 0);
      if (buildRes.error) throw buildRes.error;
      const build = ((buildRes.data ?? []) as ScheduleBuild[])[0];
      if (!build) throw new Error('Draft build was not returned after insert.');

      const rows = shifts.map(shift => ({
        build_id: build.id,
        source_shift_recommendation_id: shift.id,
        submission_id: shift.submission_id,
        provider_id: shift.provider_id,
        provider_name: shift.provider_name,
        target_month: monthStart,
        shift_date: shift.shift_date,
        start_min: shift.start_min,
        end_min: shift.end_min,
        hours: shift.hours,
        shift_type: shift.shift_type,
        assigned_state: shift.assigned_state,
        recommendation: shift.recommendation,
        recommendation_reason: shift.recommendation_reason,
        decision_run_id: shift.decision_run_id,
        source_publish_status: shift.publish_status,
        source_published_at: shift.published_at,
        source_ehr_posted_at: shift.ehr_posted_at,
      }));

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await clinopsDb
          .from('schedule_build_rows')
          .insert(rows.slice(i, i + CHUNK));
        if (error) throw error;
      }

      const { error: workflowError } = await clinopsDb
        .from('scheduling_month_workflows')
        .upsert({
          target_month: monthStart,
          current_stage: 'review',
          active_build_id: build.id,
          review_started_at: nowIso,
          updated_by: actorId,
          updated_by_label: actorLabel,
          notes: args.notes ?? null,
          updated_at: nowIso,
        }, { onConflict: 'target_month' });
      if (workflowError) throw workflowError;

      return build;
    },
    onSuccess: (_build, args) => {
      const monthStart = monthIso(args.month);
      queryClient.invalidateQueries({ queryKey: pipelineQueryKey(monthStart) });
    },
  });
}

export function useAdvanceSchedulingPipeline() {
  const queryClient = useQueryClient();
  const { actorId, actorLabel } = useActorLabel();
  return useMutation({
    mutationFn: async (args: {
      month: string;
      stage: SchedulingPipelineStage;
      buildId?: string | null;
      notes?: string;
    }) => {
      const monthStart = monthIso(args.month);
      const nowIso = new Date().toISOString();
      const workflowPatch: Record<string, unknown> = {
        target_month: monthStart,
        current_stage: args.stage,
        updated_by: actorId,
        updated_by_label: actorLabel,
        notes: args.notes ?? null,
        updated_at: nowIso,
      };
      if (args.buildId) workflowPatch.active_build_id = args.buildId;
      if (args.stage === 'review') workflowPatch.review_started_at = nowIso;
      if (args.stage === 'locked') {
        workflowPatch.locked_at = nowIso;
        workflowPatch.locked_build_id = args.buildId ?? null;
      }
      if (args.stage === 'published') workflowPatch.published_at = nowIso;
      if (args.stage === 'amend') workflowPatch.amendment_started_at = nowIso;

      if (args.buildId && ['locked', 'published'].includes(args.stage)) {
        const buildPatch: Record<string, unknown> = {
          status: args.stage,
          updated_at: nowIso,
        };
        if (args.stage === 'locked') {
          buildPatch.locked_at = nowIso;
          buildPatch.locked_by = actorId;
          buildPatch.locked_by_label = actorLabel;
        }
        if (args.stage === 'published') {
          buildPatch.published_at = nowIso;
          buildPatch.published_by = actorId;
          buildPatch.published_by_label = actorLabel;
        }
        const { error: buildError } = await clinopsDb
          .from('schedule_builds')
          .update(buildPatch)
          .eq('id', args.buildId);
        if (buildError) throw buildError;
      }

      const { error } = await clinopsDb
        .from('scheduling_month_workflows')
        .upsert(workflowPatch, { onConflict: 'target_month' });
      if (error) throw error;
    },
    onSuccess: (_data, args) => {
      const monthStart = monthIso(args.month);
      queryClient.invalidateQueries({ queryKey: pipelineQueryKey(monthStart) });
    },
  });
}

export function useCreateScheduleAmendmentRequest() {
  const queryClient = useQueryClient();
  const { actorId, actorLabel } = useActorLabel();
  return useMutation({
    mutationFn: async (args: {
      month: string;
      buildId?: string | null;
      submissionId?: string | null;
      providerId?: string | null;
      providerName: string;
      requestType: ScheduleAmendmentRequest['request_type'];
      summary?: string | null;
      notes?: string | null;
    }) => {
      const monthStart = monthIso(args.month);
      const nowIso = new Date().toISOString();
      const { error } = await clinopsDb
        .from('schedule_amendment_requests')
        .insert({
          target_month: monthStart,
          build_id: args.buildId ?? null,
          submission_id: args.submissionId ?? null,
          provider_id: args.providerId ?? null,
          provider_name: args.providerName,
          request_type: args.requestType,
          status: 'requested',
          summary: args.summary ?? null,
          notes: args.notes ?? null,
          requested_by: actorId,
          requested_by_label: actorLabel,
          updated_at: nowIso,
        });
      if (error) throw error;
    },
    onSuccess: (_data, args) => {
      const monthStart = monthIso(args.month);
      queryClient.invalidateQueries({ queryKey: pipelineQueryKey(monthStart) });
    },
  });
}

const homebasePatch = (done: boolean, actorId: string | null, nowIso: string) =>
  done
    ? {
        publish_status: 'published_to_homebase',
        published_at: nowIso,
        published_by: actorId,
      }
    : {
        publish_status: 'pending',
        published_at: null,
        published_by: null,
        ehr_posted_at: null,
        ehr_posted_by: null,
      };

const ehrPatch = (done: boolean, actorId: string | null, nowIso: string) =>
  done
    ? {
        publish_status: 'confirmed',
        ehr_posted_at: nowIso,
        ehr_posted_by: actorId,
      }
    : {
        publish_status: 'published_to_homebase',
        ehr_posted_at: null,
        ehr_posted_by: null,
      };

type AuditableShift = Pick<
  ShiftRow,
  | 'id'
  | 'submission_id'
  | 'provider_id'
  | 'provider_name'
  | 'target_month'
  | 'shift_date'
  | 'start_min'
  | 'end_min'
  | 'shift_type'
>;

const buildAuditEntries = (
  shifts: AuditableShift[],
  step: ShiftPublishStep,
  done: boolean,
  actorId: string | null,
  actorLabel: string | null,
): Record<string, unknown>[] =>
  shifts.map(s => ({
    shift_recommendation_id: s.id,
    submission_id: s.submission_id,
    provider_id: s.provider_id,
    provider_name: s.provider_name,
    target_month: s.target_month,
    shift_date: s.shift_date,
    start_min: s.start_min,
    end_min: s.end_min,
    shift_type: s.shift_type,
    step,
    action: done ? 'marked' : 'reverted',
    actor_id: actorId,
    actor_label: actorLabel,
  }));

const writeAuditLog = async (entries: Record<string, unknown>[]) => {
  if (entries.length === 0) return;
  const { error } = await clinopsDb
    .from('publish_audit_log')
    .insert(entries);
  if (error) {
    // Audit failure is logged but doesn't block the user-facing toggle. The
    // shift_recommendations row already records the latest state via
    // published_by / published_at; the audit log is the richer trail.
    console.warn('publish_audit_log insert failed:', error.message);
  }
};

const useActorLabel = () => {
  const { user, profile } = useAuth();
  return {
    actorId: user?.id ?? null,
    actorLabel: profile?.full_name || profile?.email || user?.email || null,
  };
};

export function useTogglePublishShift() {
  const queryClient = useQueryClient();
  const { actorId, actorLabel } = useActorLabel();
  return useMutation({
    mutationFn: async (args: {
      shift: AuditableShift;
      step: ShiftPublishStep;
      done: boolean;
    }) => {
      const nowIso = new Date().toISOString();
      const patch =
        args.step === 'homebase'
          ? homebasePatch(args.done, actorId, nowIso)
          : ehrPatch(args.done, actorId, nowIso);
      const { error } = await clinopsDb
        .from('shift_recommendations')
        .update(patch)
        .eq('id', args.shift.id);
      if (error) throw error;
      await writeAuditLog(
        buildAuditEntries([args.shift], args.step, args.done, actorId, actorLabel),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'shift-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'publish-audit-log'] });
      queryClient.invalidateQueries({ queryKey: ['clinops', 'shift_recommendations'] });
    },
  });
}

export function useBulkMarkPublishShifts() {
  const queryClient = useQueryClient();
  const { actorId, actorLabel } = useActorLabel();
  return useMutation({
    mutationFn: async (args: {
      shifts: AuditableShift[];
      step: ShiftPublishStep;
      done: boolean;
    }) => {
      if (args.shifts.length === 0) return;
      const nowIso = new Date().toISOString();
      const patch =
        args.step === 'homebase'
          ? homebasePatch(args.done, actorId, nowIso)
          : ehrPatch(args.done, actorId, nowIso);
      const { error } = await clinopsDb
        .from('shift_recommendations')
        .update(patch)
        .in('id', args.shifts.map(s => s.id));
      if (error) throw error;
      await writeAuditLog(
        buildAuditEntries(args.shifts, args.step, args.done, actorId, actorLabel),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'shift-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'publish-audit-log'] });
      queryClient.invalidateQueries({ queryKey: ['clinops', 'shift_recommendations'] });
    },
  });
}

// ── Audit log read API ────────────────────────────────────────────────────
// Reverse-chronological log of every publish/revert/preserve action for a
// given month. Used by the inline "by X · 2h ago" tooltip and the History
// page so Sarabjeet (and anyone else) can see who did what.

export type PublishAuditEntry = {
  id: string;
  shift_recommendation_id: string | null;
  submission_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  target_month: string | null;
  shift_date: string | null;
  start_min: number | null;
  end_min: number | null;
  shift_type: string | null;
  step: 'homebase' | 'ehr';
  action: 'marked' | 'reverted' | 'preserved';
  actor_id: string | null;
  actor_label: string | null;
  notes: string | null;
  created_at: string;
};

export function usePublishAuditLog(month: string | null) {
  const monthStart = month ? monthIso(month) : null;
  return useQuery({
    queryKey: ['workbench', 'publish-audit-log', monthStart ?? 'all'],
    queryFn: async (): Promise<PublishAuditEntry[]> => {
      let q = clinopsDb
        .from('publish_audit_log')
        .select(
          'id, shift_recommendation_id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, shift_type, step, action, actor_id, actor_label, notes, created_at',
        )
        .order('created_at', { ascending: false })
        .range(0, 999);
      if (monthStart) q = q.eq('target_month', monthStart);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PublishAuditEntry[];
    },
    staleTime: 30_000,
  });
}

// ── Manual override audit log ─────────────────────────────────────────────
// Used when a scheduler resolves a needs_review submission. The actor is
// always recorded so it's clear who approved the override even though any
// scheduling/admin user can do it.

export function useResolveNeedsReview() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  return useMutation({
    mutationFn: async (args: {
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
      skip_evaluate?: boolean;
    }) => {
      const nowIso = new Date().toISOString();
      const actor = profile?.full_name || profile?.email || user?.email || 'ClinOps';
      const auditDecision =
        args.decision === 'accepted' ? 'accepted_for_use' : 'declined_greyed_out';
      const correctionPart = args.correction_summary
        ? `; correction=${args.correction_summary}`
        : '';
      const originalPart =
        typeof args.original_hours_basis === 'number' &&
        args.original_hours_basis !== args.hours_basis
          ? `; original_hours=${args.original_hours_basis}h`
          : '';
      const priorStatusLabel = args.prior_status || 'submission';
      const auditLine = `Resolved ${priorStatusLabel} → ${auditDecision} by ${actor} at ${nowIso}: ${args.reason}${originalPart}${correctionPart}`;
      const newNotes = args.existing_notes
        ? `${args.existing_notes}\n${auditLine}`
        : auditLine;
      const hours = args.hours_basis ?? 0;
      const patch: Record<string, unknown> = {
        decision_status: args.decision,
        accepted_hours: args.decision === 'accepted' ? hours : 0,
        declined_hours: args.decision === 'declined' ? hours : 0,
        decided_at: nowIso,
        decision_notes: newNotes,
        human_review_state: 'approved',
        human_review_resolved_at: nowIso,
        human_review_resolved_by: user?.id ?? null,
        human_review_resolved_label: actor,
        human_review_notes: args.reason,
      };
      if (args.corrected_parsed_shifts !== undefined) {
        patch.parsed_shifts = args.corrected_parsed_shifts;
        patch.normalized_requested_hours = hours;
        patch.effective_hours_used_for_forecast = hours;
        patch.validation_status = 'clinops_corrected';
        patch.validation_warnings = [];
      }
      const { error: subErr } = await clinopsSupabase
        .from('schedule_submissions')
        .update(patch)
        .eq('id', args.submission_id);
      if (subErr) throw subErr;

      const { error: logErr } = await clinopsDb
        .from('submission_override_log')
        .insert({
          submission_id: args.submission_id,
          prior_status: args.prior_status,
          new_status: args.decision,
          hours_basis: hours,
          reason: args.correction_summary
            ? `${args.reason} Correction: ${args.correction_summary}`
            : args.reason,
          actor_id: user?.id ?? null,
          actor_label: actor,
        });
      if (logErr) throw logErr;

      // Accepted reviews need the allocator, not just the emitter: the
      // evaluator supersedes prior submissions, writes state allocations, and
      // rebuilds publish rows from the canonical schedule path. Keep this
      // best-effort because the review decision and audit log have already
      // landed; a later full/monthly recalculation can recover if needed.
      if (
        !args.skip_evaluate &&
        args.provider_id &&
        args.target_month &&
        args.decision === 'accepted'
      ) {
        const monthStart = monthIso(args.target_month);
        const providerParam = encodeURIComponent(args.provider_id);
        const monthParam = encodeURIComponent(monthStart);
        const { error: evalErr } = await clinopsSupabase.functions.invoke(
          `evaluate-schedule-submissions?provider_id=${providerParam}&target_month=${monthParam}`,
          { body: {} },
        );
        if (evalErr) {
          console.warn(`Per-group re-evaluate failed: ${evalErr.message}`);
        }
      } else if (!args.skip_evaluate && args.provider_id && args.target_month) {
        const monthStart = monthIso(args.target_month);
        const providerParam = encodeURIComponent(args.provider_id);
        const monthParam = encodeURIComponent(monthStart);
        const { error: emitErr } = await clinopsSupabase.functions.invoke(
          `emit-shift-recommendations?provider_id=${providerParam}&target_month=${monthParam}`,
          { body: {} },
        );
        if (emitErr) {
          console.warn(`Per-group publish-row rebuild failed: ${emitErr.message}`);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'shift-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'state-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'provider-search'] });
    },
  });
}

export type ScheduleRecalculationResult = {
  ok?: boolean;
  decision_run_id?: string;
  pending?: number;
  accepted?: number;
  partial?: number;
  declined?: number;
  needs_review?: number;
  superseded?: number;
  errors?: number;
  decisions?: Array<{
    group?: string;
    provider?: string;
    target_month?: string;
    status?: string;
    reason?: string;
    accepted_hours?: number;
    declined_hours?: number;
    superseded?: number;
    error?: string;
  }>;
};

export type SchedulingRecalculationChange = {
  id: string;
  run_id: string;
  decision_run_id: string;
  target_month: string;
  provider_id: string | null;
  provider_name: string;
  before_status: string | null;
  after_status: string | null;
  decision_accepted_before: number;
  decision_accepted_after: number;
  decision_accepted_delta: number;
  decision_declined_before: number;
  decision_declined_after: number;
  decision_declined_delta: number;
  publishable_hours_before: number;
  publishable_hours_after: number;
  publishable_hours_delta: number;
  cut_hours_before: number;
  cut_hours_after: number;
  cut_hours_delta: number;
  publishable_shifts_before: number;
  publishable_shifts_after: number;
  cut_shifts_before: number;
  cut_shifts_after: number;
  before_allocations: unknown;
  after_allocations: unknown;
  reason: string | null;
  created_at: string;
};

export type SchedulingRecalculationRun = {
  id: string;
  decision_run_id: string;
  target_month: string;
  trigger_source: string;
  groups_count: number;
  changed_provider_count: number;
  decision_accepted_delta_hours: number;
  decision_declined_delta_hours: number;
  publishable_delta_hours: number;
  cut_delta_hours: number;
  result_summary: unknown;
  created_at: string;
  changes: SchedulingRecalculationChange[];
};

export function useSchedulingRecalculationHistory(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'scheduling-recalculation-history', monthStart],
    queryFn: async (): Promise<SchedulingRecalculationRun[]> => {
      const { data: runsData, error: runsError } = await clinopsDb
        .from('scheduling_recalculation_runs')
        .select(
          'id, decision_run_id, target_month, trigger_source, groups_count, changed_provider_count, decision_accepted_delta_hours, decision_declined_delta_hours, publishable_delta_hours, cut_delta_hours, result_summary, created_at',
        )
        .eq('target_month', monthStart)
        .order('created_at', { ascending: false })
        .range(0, 24);
      if (runsError) throw runsError;

      const runs = (runsData ?? []) as Omit<SchedulingRecalculationRun, 'changes'>[];
      if (runs.length === 0) return [];
      const runIds = runs.map(run => run.id);
      const { data: changesData, error: changesError } = await clinopsDb
        .from('scheduling_recalculation_changes')
        .select(
          'id, run_id, decision_run_id, target_month, provider_id, provider_name, before_status, after_status, decision_accepted_before, decision_accepted_after, decision_accepted_delta, decision_declined_before, decision_declined_after, decision_declined_delta, publishable_hours_before, publishable_hours_after, publishable_hours_delta, cut_hours_before, cut_hours_after, cut_hours_delta, publishable_shifts_before, publishable_shifts_after, cut_shifts_before, cut_shifts_after, before_allocations, after_allocations, reason, created_at',
        )
        .in('run_id', runIds)
        .order('created_at', { ascending: false })
        .range(0, 999);
      if (changesError) throw changesError;

      const changesByRun = new Map<string, SchedulingRecalculationChange[]>();
      for (const change of (changesData ?? []) as SchedulingRecalculationChange[]) {
        const list = changesByRun.get(change.run_id) ?? [];
        list.push(change);
        changesByRun.set(change.run_id, list);
      }

      return runs.map(run => ({
        ...run,
        changes: (changesByRun.get(run.id) ?? []).sort((a, b) =>
          Math.abs(b.publishable_hours_delta) - Math.abs(a.publishable_hours_delta) ||
          Math.abs(b.decision_accepted_delta) - Math.abs(a.decision_accepted_delta) ||
          a.provider_name.localeCompare(b.provider_name),
        ),
      }));
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

export function useReevaluateMonth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (month: string) => {
      const monthStart = monthIso(month);
      const { data, error } = await clinopsSupabase.functions.invoke(
        `evaluate-schedule-submissions?target_month=${monthStart}`,
        { body: {} },
      );
      if (error) throw error;
      return data as ScheduleRecalculationResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'availability-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'shift-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'state-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'provider-search'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'scheduling-recalculation-history'] });
    },
  });
}

// ── Resubmission Inbox ────────────────────────────────────────────────────
// Surfaces (provider, target_month) groups with multiple non-superseded
// submissions where the latest differs from the prior decided one, so
// ClinOps can Approve or Park each change rather than have the evaluator
// silently overwrite a published schedule.

export type HumanReviewState = 'pending' | 'approved' | 'parked';

export type SubmissionForInbox = {
  id: string;
  provider_id: string | null;
  provider_name: string;
  target_month: string;
  decision_status: DecisionStatus | 'superseded' | null;
  accepted_hours: number | null;
  declined_hours: number | null;
  decision_notes: string | null;
  parsed_shifts: unknown;
  submitted_at: string;
  decided_at: string | null;
  raw_requested_hours: number | null;
  normalized_requested_hours: number | null;
  effective_hours_used_for_forecast: number | null;
  human_review_state: HumanReviewState | null;
  human_review_resolved_at: string | null;
  human_review_resolved_label: string | null;
  human_review_notes: string | null;
};

export type ResubmissionGroup = {
  provider_id: string;
  provider_name: string;
  target_month: string;
  latest: SubmissionForInbox;
  prior: SubmissionForInbox;
  others: SubmissionForInbox[];
};

/**
 * Inbox spans multiple months: providers can resubmit hours for May while
 * we're scheduling June. We pull a rolling window — prior month, current
 * month, and the next ~6 — so intra-month additions and forward planning
 * both surface. Bounded so the query stays cheap.
 */
const INBOX_LOOKBACK_MONTHS = 1;
const INBOX_LOOKAHEAD_MONTHS = 6;

const shiftMonth = (monthStart: string, delta: number): string => {
  const [y, m] = monthStart.split('-').map(Number);
  if (!y || !m) return monthStart;
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const inboxWindowBounds = (anchorMonth: string) => {
  const anchor = monthIso(anchorMonth);
  return {
    fromMonth: shiftMonth(anchor, -INBOX_LOOKBACK_MONTHS),
    toMonth: shiftMonth(anchor, INBOX_LOOKAHEAD_MONTHS),
  };
};

export function useResubmissionInbox(anchorMonth: string) {
  const targetMonth = monthIso(anchorMonth);
  const { fromMonth, toMonth } = inboxWindowBounds(targetMonth);
  return useQuery({
    queryKey: ['workbench', 'resubmission-inbox', fromMonth, toMonth],
    queryFn: async (): Promise<SubmissionForInbox[]> => {
      const { data, error } = await clinopsDb
        .from('schedule_submissions')
        .select(
          'id, provider_id, provider_name, target_month, decision_status, accepted_hours, declined_hours, decision_notes, parsed_shifts, submitted_at, decided_at, raw_requested_hours, normalized_requested_hours, effective_hours_used_for_forecast, human_review_state, human_review_resolved_at, human_review_resolved_label, human_review_notes',
        )
        .gte('target_month', fromMonth)
        .lte('target_month', toMonth)
        .order('submitted_at', { ascending: true })
        .range(0, 9999);
      if (error) throw error;
      return (data ?? []) as SubmissionForInbox[];
    },
    staleTime: 30_000,
  });
}

/**
 * Group submissions into (provider, target_month) buckets sorted by
 * submitted_at ascending. Parked and approved rows stay in the groups so the
 * inbox can show the recorded review decision instead of hiding the handoff.
 * The caller filters by hasChanges (from diffParsedShifts) to surface rows.
 *
 * Same provider with submissions for May AND June produces TWO groups —
 * each month is reviewed independently.
 */
export function groupSubmissionsForInbox(
  rows: SubmissionForInbox[],
): ResubmissionGroup[] {
  const byKey = new Map<string, SubmissionForInbox[]>();
  for (const r of rows) {
    if (!r.provider_id) continue;
    const key = `${r.provider_id}|${r.target_month}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  const out: ResubmissionGroup[] = [];
  for (const [, subs] of byKey) {
    if (subs.length < 2) continue;
    const sorted = [...subs].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    const latest = sorted[sorted.length - 1];
    const prior = sorted[sorted.length - 2];
    out.push({
      provider_id: latest.provider_id!,
      provider_name: latest.provider_name,
      target_month: latest.target_month,
      latest,
      prior,
      others: sorted.slice(0, -2),
    });
  }
  // Most-recent submitted_at first across all months — that's the natural
  // "new stuff to deal with" ordering for the inbox.
  out.sort((a, b) => b.latest.submitted_at.localeCompare(a.latest.submitted_at));
  return out;
}

// ── Unmatched submissions ─────────────────────────────────────────────────
// schedule_submissions rows where the sync couldn't resolve a provider via
// email or fuzzy name match. The submission lives in the DB but is invisible
// to the evaluator and Workbench. Surfacing them lets ClinOps either link
// to an existing provider (and re-run the evaluator) or dismiss the row.

export type UnmatchedSubmission = {
  id: string;
  provider_name: string;
  target_month: string;
  submitted_at: string;
  parsed_shifts: unknown;
  raw_answers: unknown;
  decision_status: string | null;
  decision_notes: string | null;
};

export function useUnmatchedSubmissions() {
  return useQuery({
    queryKey: ['workbench', 'unmatched-submissions'],
    queryFn: async (): Promise<UnmatchedSubmission[]> => {
      const { data, error } = await clinopsSupabase
        .from('schedule_submissions')
        .select(
          'id, provider_name, target_month, submitted_at, parsed_shifts, raw_answers, decision_status, decision_notes',
        )
        .is('provider_id', null)
        .or('decision_status.is.null,decision_status.neq.superseded')
        .order('submitted_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as UnmatchedSubmission[];
    },
    staleTime: 30_000,
  });
}

export function useLinkUnmatchedSubmission() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      submission_id: string;
      provider_id: string;
      provider_name: string;
      target_month: string;
    }) => {
      const nowIso = new Date().toISOString();
      const actor =
        profile?.full_name || profile?.email || user?.email || 'ClinOps';
      const { error } = await clinopsSupabase
        .from('schedule_submissions')
        .update({
          provider_id: args.provider_id,
          provider_name: args.provider_name,
          decision_status: 'pending',
          decision_notes: `Manually linked to provider by ${actor} at ${nowIso}`,
        })
        .eq('id', args.submission_id);
      if (error) throw error;
      // Evaluate immediately so the submission lands in the workbench.
      const monthStart = monthIso(args.target_month);
      const { error: evalErr } = await clinopsSupabase.functions.invoke(
        `evaluate-schedule-submissions?provider_id=${args.provider_id}&target_month=${monthStart}`,
        { body: {} },
      );
      if (evalErr) console.warn(`Per-group evaluate failed: ${evalErr.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'unmatched-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'resubmission-inbox'] });
    },
  });
}

export function useDismissUnmatchedSubmission() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  return useMutation({
    mutationFn: async (args: { submission_id: string; reason?: string }) => {
      const nowIso = new Date().toISOString();
      const actor =
        profile?.full_name || profile?.email || user?.email || 'ClinOps';
      const note = `Dismissed as unmatched by ${actor} at ${nowIso}${
        args.reason ? `: ${args.reason}` : ''
      }`;
      const { error } = await clinopsSupabase
        .from('schedule_submissions')
        .update({
          decision_status: 'superseded',
          decided_at: nowIso,
          decision_notes: note,
        })
        .eq('id', args.submission_id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'unmatched-submissions'] });
    },
  });
}

// ── Onboarding readiness ──────────────────────────────────────────────────
// For each provider added recently, check the prerequisites that have to be
// true for their first Jotform to flow through the pipeline. Surfaces gaps
// before a provider's first submission shows up as "missing" or unmatched.

const MENTAL_HEALTH_PROFESSIONS = new Set([
  'mental_health_coach',
  'mh_coach',
  'lpc',
  'therapist',
  'health_coach',
]);

const isMentalHealth = (p: string | null): boolean =>
  !!p && MENTAL_HEALTH_PROFESSIONS.has(p.toLowerCase().replace(/\s+/g, '_'));

export type ProviderReadiness = {
  provider_id: string;
  provider_name: string;
  email: string | null;
  profession: string | null;
  employment_type: string | null;
  employment_status: string | null;
  active: boolean | null;
  created_at: string;
  license_count: number;
  // Per-prerequisite flags
  hasEmail: boolean;
  isActive: boolean;
  hasProfession: boolean;
  hasLicensesIfNeeded: boolean;
  isMentalHealth: boolean;
  // Roll-up
  readyForSubmissions: boolean;
  issues: string[];
};

export function useOnboardingReadiness(lookbackDays: number = 30) {
  return useQuery({
    queryKey: ['workbench', 'onboarding-readiness', lookbackDays],
    queryFn: async (): Promise<ProviderReadiness[]> => {
      const cutoff = new Date(
        Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const [provRes, licRes] = await Promise.all([
        clinopsSupabase
          .from('providers')
          .select('id, name, email, profession, employment_type, employment_status, active, created_at')
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(200),
        clinopsSupabase
          .from('provider_licenses')
          .select('provider_id, status'),
      ]);
      if (provRes.error) throw provRes.error;
      if (licRes.error) throw licRes.error;
      const validStatuses = new Set(['active', 'verified', 'pending_renewal']);
      const licCount = new Map<string, number>();
      for (const l of licRes.data ?? []) {
        if (!l.provider_id) continue;
        if (l.status && !validStatuses.has(l.status)) continue;
        licCount.set(l.provider_id, (licCount.get(l.provider_id) ?? 0) + 1);
      }
      const out: ProviderReadiness[] = [];
      for (const p of provRes.data ?? []) {
        const email = p.email?.trim() || null;
        const hasEmail = !!email && email.includes('@');
        const isActive = p.active === true;
        const hasProfession = !!p.profession && p.profession.trim().length > 0;
        const isMH = isMentalHealth(p.profession);
        const licenses = licCount.get(p.id) ?? 0;
        const hasLicensesIfNeeded = isMH || licenses > 0;
        const readyForSubmissions =
          hasEmail && isActive && hasProfession && hasLicensesIfNeeded;
        const issues: string[] = [];
        if (!hasEmail) issues.push('No Vitable email on file — Jotform submissions will be unmatched');
        if (!isActive) issues.push('active = false — provider will not appear in workbench');
        if (!hasProfession) issues.push('Profession not set — required for state allocation rules');
        if (!hasLicensesIfNeeded && !isMH)
          issues.push('No active licenses — evaluator will decline every submission');
        out.push({
          provider_id: p.id,
          provider_name: p.name,
          email,
          profession: p.profession ?? null,
          employment_type: p.employment_type ?? null,
          employment_status: p.employment_status ?? null,
          active: p.active ?? null,
          created_at: p.created_at,
          license_count: licenses,
          hasEmail,
          isActive,
          hasProfession,
          hasLicensesIfNeeded,
          isMentalHealth: isMH,
          readyForSubmissions,
          issues,
        });
      }
      return out;
    },
    staleTime: 60_000,
  });
}

// ── Provider search for the unmatched-submission Link action ──────────────
// Lightweight name+email contains-search used by the combobox. Returns up
// to 20 matches; the unmatched-submission card supplies the search query.

export type ProviderSearchHit = {
  id: string;
  name: string;
  email: string | null;
  profession: string | null;
};

export function useProviderSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['workbench', 'provider-search', trimmed.toLowerCase()],
    queryFn: async (): Promise<ProviderSearchHit[]> => {
      if (trimmed.length < 2) return [];
      const q = trimmed.replace(/[%,()*]/g, '');
      const { data, error } = await clinopsSupabase
        .from('providers')
        .select('id, name, email, profession')
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
        .order('name', { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ProviderSearchHit[];
    },
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}

export function useUpdateProviderSchedulingException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      providerId: string;
      exempt: boolean;
      reason?: string | null;
    }) => {
      const reason = args.reason?.trim() || null;
      const { error } = await clinopsDb.rpc('set_provider_scheduling_exception', {
        p_provider_id: args.providerId,
        p_scheduling_outreach_exempt: args.exempt,
        p_scheduling_outreach_exemption_reason: args.exempt ? reason : null,
      });
      if (error) throw new Error(error.message || 'Unable to update provider exception');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'provider-search'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'provider-scheduling-exceptions'] });
    },
  });
}

export function useResolveResubmission() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      submission_id: string;
      action: 'approved' | 'parked' | 'pending';
      notes?: string;
      // Required when action === 'approved' so we can re-evaluate the
      // specific (provider, target_month) group immediately. Without these
      // the user would have to switch the workbench month selector and hit
      // Re-run, which defeats the purpose of a cross-month inbox.
      provider_id?: string | null;
      target_month?: string;
      skip_evaluate?: boolean;
    }) => {
      const nowIso = new Date().toISOString();
      const actor =
        profile?.full_name || profile?.email || user?.email || 'ClinOps';
      const patch: Record<string, unknown> = {
        human_review_state: args.action,
        human_review_resolved_at: nowIso,
        human_review_resolved_by: user?.id ?? null,
        human_review_resolved_label: actor,
      };
      if (args.notes !== undefined) patch.human_review_notes = args.notes;
      // Parked submissions get demoted to 'superseded' so the evaluator
      // (which already excludes superseded rows from "latest") stops
      // considering them.
      if (args.action === 'parked') {
        patch.decision_status = 'superseded';
        patch.decided_at = nowIso;
      }
      const { error } = await clinopsSupabase
        .from('schedule_submissions')
        .update(patch)
        .eq('id', args.submission_id);
      if (error) throw error;

      // On Approve, run the evaluator scoped to this provider+month so the
      // change applies right away (publish_status is preserved across
      // re-runs by the writeShiftRecommendations preservation logic). The
      // user doesn't need to leave the inbox.
      if (
        !args.skip_evaluate &&
        args.action === 'approved' &&
        args.provider_id &&
        args.target_month
      ) {
        const monthStart = monthIso(args.target_month);
        const { error: evalErr } = await clinopsSupabase.functions.invoke(
          `evaluate-schedule-submissions?provider_id=${args.provider_id}&target_month=${monthStart}`,
          { body: {} },
        );
        if (evalErr) {
          // Best-effort — the human_review_state update already landed, so
          // the next scheduled or manual evaluator run will pick it up.
          console.warn(`Per-group re-evaluate failed: ${evalErr.message}`);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'resubmission-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'shift-recommendations'] });
    },
  });
}
