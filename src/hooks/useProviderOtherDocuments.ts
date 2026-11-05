import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AGREEMENT_REFRESH_OPTIONS } from '@/lib/agreementRefresh';

export interface ProviderDoc { id: string; label: string; state: string | null; reference: string }

/** Provider files/links saved elsewhere (agreement links, tasks, licensure, reimbursements, meetings, agency). */
export function useProviderOtherDocuments(profileId: string) {
  return useQuery({
    queryKey: ['directory-collaboration', 'provider-other-docs', profileId],
    ...AGREEMENT_REFRESH_OPTIONS,
    queryFn: async (): Promise<ProviderDoc[]> => {
      const db = supabase as any;
      const [direct, parts, tasks, apps, reimb, meetings, ext] = await Promise.all([
        db.from('collaborative_agreements').select('id, state_abbreviation, physician_name, termination_document_url').eq('provider_id', profileId),
        db.from('agreement_providers').select('id, chart_review_url, collaborative_agreements(id, state_abbreviation, physician_name, termination_document_url)').eq('provider_id', profileId),
        db.from('agreement_tasks').select('id, title, state_abbreviation, external_url, agreement_id').eq('provider_id', profileId).not('external_url', 'is', null),
        db.from('licensure_applications').select('id, state_abbreviation, designation_label, licensure_application_steps(id, title, uploaded_file_url, uploaded_file_name, fee_receipt_url)').eq('provider_id', profileId),
        db.from('reimbursement_requests').select('id, state_abbreviation, application_fee_receipt_url').eq('provider_id', profileId).not('application_fee_receipt_url', 'is', null),
        db.from('meeting_attendees').select('id, chart_link, created_at').eq('provider_id', profileId).not('chart_link', 'is', null),
        db.from('external_providers').select('id, external_agreements(id, supervision_state, document_title, document_reference, supervisor_name)').eq('profile_id', profileId),
      ]);
      const out: ProviderDoc[] = [];
      const push = (id: string, label: string, state: string | null | undefined, reference: string | null | undefined) => {
        if (reference && reference.trim()) out.push({ id, label, state: state ?? null, reference: reference.trim() });
      };
      const agreements = new Map<string, any>();
      for (const a of direct.data ?? []) agreements.set(a.id, a);
      for (const p of parts.data ?? []) {
        const a = p.collaborative_agreements;
        if (a) agreements.set(a.id, a);
        push(`ap-chart:${p.id}`, `Chart review link${a?.physician_name ? ` — ${a.physician_name}` : ''}`, a?.state_abbreviation, p.chart_review_url);
      }
      for (const a of agreements.values()) push(`term:${a.id}`, `Termination document — ${a.physician_name ?? 'Collab Agreement'}`, a.state_abbreviation, a.termination_document_url);
      for (const t of tasks.data ?? []) push(`task:${t.id}`, t.title || 'Task link', t.state_abbreviation ?? agreements.get(t.agreement_id)?.state_abbreviation, t.external_url);
      for (const app of apps.data ?? []) for (const s of app.licensure_application_steps ?? []) {
        push(`step:${s.id}`, `Licensure — ${s.uploaded_file_name || s.title}`, app.state_abbreviation, s.uploaded_file_url);
        push(`fee:${s.id}`, `Licensure fee receipt — ${s.title}`, app.state_abbreviation, s.fee_receipt_url);
      }
      for (const r of reimb.data ?? []) push(`reimb:${r.id}`, 'Reimbursement fee receipt', r.state_abbreviation, r.application_fee_receipt_url);
      for (const m of meetings.data ?? []) push(`meet:${m.id}`, 'Collab meeting chart link', null, m.chart_link);
      for (const e of ext.data ?? []) for (const a of e.external_agreements ?? []) {
        if (/^(https?:\/\/|\/)/i.test(a.document_reference ?? '')) push(`ext:${a.id}`, `Agency Collab Agreement — ${a.document_title || a.supervisor_name || 'document'}`, a.supervision_state, a.document_reference);
      }
      const seen = new Set<string>();
      return out.filter(d => { const k = `${d.state}|${d.reference}`; if (seen.has(k)) return false; seen.add(k); return true; });
    },
  });
}
