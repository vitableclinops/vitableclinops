import { getCollabRequirementType } from '@/constants/stateRestrictions';
import { isIndependentPhysician, normalizeRole } from '@/lib/clinicianRoles';
import { parseLocalDate } from '@/lib/utils';
import { hasPrescriptiveAuthority, type PrescriptiveAuthorityEvidence } from '@/lib/prescriptiveAuthorityEvidence';

export interface StateAgreement {
  profileId: string | null;
  state: string;
  status: string | null;
  document: string | null;
  start?: string | null;
  end?: string | null;
  /** Led by a DirectShifts physician: no document link required. */
  documentExempt?: boolean;
}
export interface AgreementReview { state: string; reason: string; howToFix: string; authorityReview?: boolean; newlyActive?: boolean }
export interface CollaborationRule { state_abbreviation: string; collab_requirement_type: string | null; ca_required: boolean }

/** Audit only identity-resolved EHR states; license lists never imply activation. */
export function activeStateAgreementFlags(
  provider: { id: string; profession?: string | null; credentials?: string | null },
  states: string[], rules: CollaborationRule[], agreements: StateAgreement[],
  _decisions: { profile_id: string; state_abbreviation: string; decision: string }[],
  today = new Date(),
  authorityEvidence: PrescriptiveAuthorityEvidence[] = [],
  newlyActiveStates: string[] = [],
): AgreementReview[] {
  if (isIndependentPhysician(provider)) return [];
  const role = normalizeRole(provider.profession);
  const np = ['np', 'apn', 'aprn', 'npp', 'nurse practitioner', 'nurse practitioner, certified'].includes(role)
    || (!role && /\b(np|aprn|fnp|agpcnp)\b/i.test(provider.credentials ?? ''));
  if (!np) return [];
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return [...new Set(states)].sort().flatMap(state => {
    if (getCollabRequirementType(state) === 'md_only') return [];
    const rule = rules.find(r => r.state_abbreviation === state);
    // NY's saved conditional rule allows explicit prescribing authority as an alternative.
    const authorityAlternative = state === 'NY' && rule?.collab_requirement_type === 'conditional';
    if (!rule || (!rule.ca_required && !authorityAlternative) || rule.collab_requirement_type === 'never' || rule.collab_requirement_type === 'md_only') return [];
    if (authorityAlternative && hasPrescriptiveAuthority(provider.id, state, authorityEvidence, day)) return [];
    const matching = agreements.filter(a => a.profileId === provider.id && a.state === state
      && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase())
      && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day)
      && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day));
    if (matching.some(a => a.document?.trim() || a.documentExempt)) return [];
    if (authorityAlternative) return [{ state, authorityReview: true, newlyActive: newlyActiveStates.includes(state),
      reason: 'Prescriptive authority is not verified and no current documented collaborative agreement is linked.',
      howToFix: 'Verify New York prescriptive authority in the provider’s linked license records. If the provider does not have it, add or link the signed New York collaborative agreement using the completed-process option. Missing authority records do not prove the provider lacks authority.' }];
    return [{ state, newlyActive: newlyActiveStates.includes(state), reason: matching.length ? 'Active agreement has no attached document.' : 'Missing active linked collaborative agreement.', howToFix: matching.length
      ? 'Open Agreements and attach the signed document or its link to the existing agreement.'
      : 'Open Agreements and link the existing signed agreement to this provider and state. Use the completed-process option to avoid repeat notifications; do not mark it active without verified evidence.' }];
  });
}