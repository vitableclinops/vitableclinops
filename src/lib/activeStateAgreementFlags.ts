import { getCollabRequirementType } from '@/constants/stateRestrictions';
import { normalizeRole } from '@/lib/clinicianRoles';
import { parseLocalDate } from '@/lib/utils';

export interface StateAgreement {
  profileId: string | null;
  state: string;
  status: string | null;
  document: string | null;
  start?: string | null;
  end?: string | null;
}
export interface AgreementReview { state: string; reason: string; howToFix: string }
export interface CollaborationRule { state_abbreviation: string; collab_requirement_type: string | null; ca_required: boolean }

/** Audit only identity-resolved EHR states; license lists never imply activation. */
export function activeStateAgreementFlags(
  provider: { id: string; profession?: string | null; credentials?: string | null },
  states: string[], rules: CollaborationRule[], agreements: StateAgreement[],
  decisions: { profile_id: string; state_abbreviation: string; decision: string }[],
  today = new Date(),
): AgreementReview[] {
  const role = normalizeRole(provider.profession);
  const np = ['np', 'apn', 'aprn', 'npp', 'nurse practitioner', 'nurse practitioner, certified'].includes(role)
    || (!role && /\b(np|aprn|fnp|agpcnp)\b/i.test(provider.credentials ?? ''));
  if (!np) return [];
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return [...new Set(states)].sort().flatMap(state => {
    if (getCollabRequirementType(state) === 'md_only') return [];
    const rule = rules.find(r => r.state_abbreviation === state);
    const type = rule?.collab_requirement_type ?? (rule ? (rule.ca_required ? 'always' : 'never') : getCollabRequirementType(state));
    if (type === 'never' || type === 'md_only') return [];
    const decision = decisions.find(d => d.profile_id === provider.id && d.state_abbreviation === state)?.decision;
    const matching = agreements.filter(a => a.profileId === provider.id && a.state === state
      && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase())
      && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day)
      && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day));
    if (matching.some(a => a.document?.trim())) return [];
    if (type !== 'always' && !rule?.ca_required && decision !== 'required') {
      return [{ state, reason: 'Collaboration requirement needs provider-specific verification.', howToFix: 'Review this state’s current rules and the provider’s autonomous-practice eligibility before deciding whether an agreement is needed.' }];
    }
    return [{ state, reason: matching.length ? 'Active agreement has no attached document.' : 'Missing active linked collaborative agreement.', howToFix: matching.length
      ? 'Open Agreements and attach the signed document or its link to the existing agreement.'
      : 'Open Agreements and link the existing signed agreement to this provider and state. Use the completed-process option to avoid repeat notifications; do not mark it active without verified evidence.' }];
  });
}