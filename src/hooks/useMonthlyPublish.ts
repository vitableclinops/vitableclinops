import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinopsSupabase } from '@/integrations/supabase/clinopsClient';
import { useAuth } from '@/hooks/useAuth';

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
  parsed_shifts: ParsedShift[] | null;
  submitted_at: string;
  decided_at: string | null;
  validation_status: string | null;
  validation_warnings: unknown;
  raw_requested_hours: number | null;
  normalized_requested_hours: number | null;
};

export type ProviderRow = {
  id: string;
  name: string;
  email: string | null;
  profession: string | null;
  employment_type: string | null;
  employment_status: string | null;
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
  submission: SubmissionRow | null;
  publish: PublishStatusRow | null;
};

const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m);

const pad2 = (n: number) => String(n).padStart(2, '0');

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
            'id, provider_id, provider_name, target_month, decision_status, accepted_hours, declined_hours, decision_notes, parsed_shifts, submitted_at, decided_at, validation_status, validation_warnings, raw_requested_hours, normalized_requested_hours',
          )
          .eq('target_month', monthStart)
          .order('submitted_at', { ascending: false }),
        clinopsSupabase
          .from('providers')
          .select('id, name, email, profession, employment_type, employment_status, active'),
        (clinopsSupabase as unknown as { from: (t: string) => any })
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
      const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
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
      const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
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
      const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
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
  target_month: string;
  shift_date: string;
  start_min: number;
  end_min: number;
  hours: number;
  shift_type: string;
  assigned_state: string | null;
  recommendation: string;
  publish_status: string;
  published_at: string | null;
  published_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
};

export type ShiftPublishStep = 'homebase' | 'ehr';

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

export function useShiftRecommendationsForMonth(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'shift-recommendations', monthStart],
    queryFn: async (): Promise<ShiftRow[]> => {
      const { data, error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
        .from('shift_recommendations')
        .select(
          'id, submission_id, provider_id, provider_name, target_month, shift_date, start_min, end_min, hours, shift_type, assigned_state, recommendation, publish_status, published_at, published_by, ehr_posted_at, ehr_posted_by',
        )
        .eq('target_month', monthStart)
        .eq('recommendation', 'publish')
        .order('shift_date', { ascending: true })
        .order('start_min', { ascending: true })
        .range(0, 9999);
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
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
  const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
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
      const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
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
      const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
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
      let q = (clinopsSupabase as unknown as { from: (t: string) => any })
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
      prior_status: string | null;
      decision: 'accepted' | 'declined';
      hours_basis: number | null;
      reason: string;
      existing_notes: string | null;
    }) => {
      const nowIso = new Date().toISOString();
      const actor = profile?.full_name || profile?.email || user?.email || 'ClinOps';
      const auditLine = `Resolved needs_review → ${args.decision} by ${actor} at ${nowIso}: ${args.reason}`;
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
      const { error: subErr } = await clinopsSupabase
        .from('schedule_submissions')
        .update(patch)
        .eq('id', args.submission_id);
      if (subErr) throw subErr;

      const { error: logErr } = await (clinopsSupabase as unknown as { from: (t: string) => any })
        .from('submission_override_log')
        .insert({
          submission_id: args.submission_id,
          prior_status: args.prior_status,
          new_status: args.decision,
          hours_basis: hours,
          reason: args.reason,
          actor_id: user?.id ?? null,
          actor_label: actor,
        });
      if (logErr) throw logErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
    },
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
      return data as { ok?: boolean; decision_run_id?: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
    },
  });
}
