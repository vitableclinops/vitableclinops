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
  profession: string | null;
  employment_type: string | null;
  submission: SubmissionRow | null;
  publish: PublishStatusRow | null;
};

const monthIso = (m: string) => (m.length === 7 ? `${m}-01` : m);

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
// Sarabjeet's resumable workflow: each shift can be marked Homebase-posted,
// then EHR-posted. We key on (submission_id, shift_date, start_time, end_time)
// so we can match against the parsed_shifts JSON without an explicit index.

export type PublishedShiftRow = {
  id: string;
  submission_id: string;
  provider_id: string;
  target_month: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  hours: number | null;
  state: string | null;
  shift_type: string | null;
  homebase_posted_at: string | null;
  homebase_posted_by: string | null;
  ehr_posted_at: string | null;
  ehr_posted_by: string | null;
  notes: string | null;
};

export type ShiftPublishStep = 'homebase' | 'ehr';

export const shiftKey = (
  submission_id: string,
  shift_date: string,
  start_time: string,
  end_time: string,
) => `${submission_id}|${shift_date}|${start_time}|${end_time}`;

export function usePublishedShifts(month: string) {
  const monthStart = monthIso(month);
  return useQuery({
    queryKey: ['workbench', 'published-shifts', monthStart],
    queryFn: async (): Promise<Map<string, PublishedShiftRow>> => {
      const { data, error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
        .from('published_shifts')
        .select('*')
        .eq('target_month', monthStart);
      if (error) throw error;
      const rows = (data ?? []) as PublishedShiftRow[];
      const byKey = new Map<string, PublishedShiftRow>();
      for (const r of rows) {
        byKey.set(shiftKey(r.submission_id, r.shift_date, r.start_time, r.end_time), r);
      }
      return byKey;
    },
    staleTime: 30_000,
    enabled: Boolean(monthStart),
  });
}

type ShiftIdent = {
  submission_id: string;
  provider_id: string;
  target_month: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  hours?: number | null;
  state?: string | null;
  shift_type?: string | null;
};

const buildShiftPatch = (
  ident: ShiftIdent,
  step: ShiftPublishStep,
  done: boolean,
  actorId: string | null,
  nowIso: string,
) => {
  const monthStart = monthIso(ident.target_month);
  const base: Record<string, unknown> = {
    submission_id: ident.submission_id,
    provider_id: ident.provider_id,
    target_month: monthStart,
    shift_date: ident.shift_date,
    start_time: ident.start_time,
    end_time: ident.end_time,
    hours: ident.hours ?? null,
    state: ident.state ?? null,
    shift_type: ident.shift_type ?? null,
  };
  if (step === 'homebase') {
    base.homebase_posted_at = done ? nowIso : null;
    base.homebase_posted_by = done ? actorId : null;
    if (!done) {
      // Unchecking Homebase also clears EHR — EHR can't precede Homebase.
      base.ehr_posted_at = null;
      base.ehr_posted_by = null;
    }
  } else {
    base.ehr_posted_at = done ? nowIso : null;
    base.ehr_posted_by = done ? actorId : null;
  }
  return base;
};

export function useTogglePublishShift() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: ShiftIdent & { step: ShiftPublishStep; done: boolean }) => {
      const nowIso = new Date().toISOString();
      const patch = buildShiftPatch(args, args.step, args.done, user?.id ?? null, nowIso);
      const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
        .from('published_shifts')
        .upsert(patch, { onConflict: 'submission_id,shift_date,start_time,end_time' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'published-shifts'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
    },
  });
}

export function useBulkMarkPublishShifts() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      shifts: ShiftIdent[];
      step: ShiftPublishStep;
      done: boolean;
    }) => {
      if (args.shifts.length === 0) return;
      const nowIso = new Date().toISOString();
      const rows = args.shifts.map(s =>
        buildShiftPatch(s, args.step, args.done, user?.id ?? null, nowIso),
      );
      const { error } = await (clinopsSupabase as unknown as { from: (t: string) => any })
        .from('published_shifts')
        .upsert(rows, { onConflict: 'submission_id,shift_date,start_time,end_time' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench', 'published-shifts'] });
      queryClient.invalidateQueries({ queryKey: ['workbench', 'monthly-publish'] });
    },
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
