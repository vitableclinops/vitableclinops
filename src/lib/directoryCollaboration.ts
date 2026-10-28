interface LocalAgreement {
  id: string;
  provider_id: string | null;
  physician_id: string | null;
  workflow_status: string | null;
  terminated_at: string | null;
}
interface Participant { agreement_id: string; provider_id: string | null; is_active: boolean | null }
interface SourceAgreement {
  profile_id: string | null;
  supervisor_profile_id: string | null;
  source_status: string | null;
  local_agreement_id: string | null;
}

/** Presentation-only participation, using saved identity links, never names. */
export function directoryCollaborationCounts(local: LocalAgreement[], participants: Participant[], sources: SourceAgreement[]): Map<string, number> {
  const records = new Map<string, Set<string>>();
  const active = (status: string | null) => ['active', 'fully_executed'].includes((status ?? '').toLowerCase());
  const byId = new Map(local.map(a => [a.id, a]));
  const add = (id: string | null, agreement: string) => {
    if (!id) return;
    const linked = records.get(id) ?? new Set<string>();
    linked.add(agreement); records.set(id, linked);
  };
  for (const a of local) {
    if (!active(a.workflow_status) || a.terminated_at) continue;
    add(a.provider_id, a.id); add(a.physician_id, a.id);
  }
  for (const p of participants) {
    const a = byId.get(p.agreement_id);
    if (p.is_active && a && active(a.workflow_status) && !a.terminated_at) add(p.provider_id, a.id);
  }
  for (const [index, a] of sources.entries()) {
    // A linked local termination must not be undone by an older source record.
    if (a.local_agreement_id && byId.has(a.local_agreement_id)) continue;
    if (!active(a.source_status)) continue;
    add(a.profile_id, `source:${index}`); add(a.supervisor_profile_id, `source:${index}`);
  }
  return new Map([...records].map(([id, linked]) => [id, linked.size]));
}

export function directoryCollaborationIds(local: LocalAgreement[], participants: Participant[], sources: SourceAgreement[]): Set<string> {
  return new Set(directoryCollaborationCounts(local, participants, sources).keys());
}