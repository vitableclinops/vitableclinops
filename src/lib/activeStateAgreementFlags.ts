import { getCollabRequirementType } from '@/constants/stateRestrictions';
import { isIndependentPhysician, normalizeRole } from '@/lib/clinicianRoles';
import { parseLocalDate } from '@/lib/utils';
import { INDEPENDENT_ALTERNATIVE_STATES, RX_AUTHORITY_REQUIRED_STATES, hasVerifiedIndependentPractice, hasVerifiedRxAuthority, hasVerifiedNcbonRegistration, type CollabDecision } from '@/lib/nyIndependentPractice';
import { hasPrescriptiveAuthority, type PrescriptiveAuthorityEvidence } from '@/lib/prescriptiveAuthorityEvidence';
import { SHEET_REQUIREMENTS, REQUIREMENT_LABELS, missingSheetRequirements, type RequirementProof, type SheetLicense } from '@/lib/stateSheetRequirements';

export interface StateAgreement {
  profileId: string | null;
  state: string;
  status: string | null;
  document: string | null;
  start?: string | null;
  end?: string | null;
  /** Led by a DirectShifts physician: no document link required. */
  documentExempt?: boolean;
  /** Local agreement record ID, used to open the agreement page. */
  agreementId?: string;
}
export interface AgreementReview { state: string; reason: string; howToFix: string; authorityReview?: boolean; independentAlternative?: boolean; registrationReview?: boolean; sheetReview?: boolean; newlyActive?: boolean }
export interface CollaborationRule { state_abbreviation: string; collab_requirement_type: string | null; ca_required: boolean }

/** Audit only identity-resolved EHR states; license lists never imply activation. */
export function activeStateAgreementFlags(
  provider: { id: string; profession?: string | null; credentials?: string | null },
  states: string[], rules: CollaborationRule[], agreements: StateAgreement[],
  decisions: CollabDecision[],
  today = new Date(),
  authorityEvidence: PrescriptiveAuthorityEvidence[] = [],
  newlyActiveStates: string[] = [],
  requirementProofs: RequirementProof[] = [],
  sheetLicenses: SheetLicense[] = [],
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
    if (SHEET_REQUIREMENTS[state]) {
      const agreement = agreements.some(a => a.profileId === provider.id && a.state === state
        && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase()) && (!!a.document?.trim() || a.documentExempt)
        && (!a.start || parseLocalDate(a.start.slice(0,10)) <= day) && (!a.end || parseLocalDate(a.end.slice(0,10)) >= day));
      const missing = missingSheetRequirements(provider.id, state, agreement, requirementProofs, sheetLicenses, day);
      return missing.length ? [{ state, sheetReview: missing.some(k => k !== 'collab_agreement'), newlyActive: newlyActiveStates.includes(state),
        reason: `${state} requirements need verification: ${missing.map(k => REQUIREMENT_LABELS[k] ?? 'Signed Collab Agreement').join(SHEET_REQUIREMENTS[state].alternative ? ' OR ' : ' + ')}.`,
        howToFix: `${SHEET_REQUIREMENTS[state].label}. Save verification source, date and a proof file or link for each designation or registration; add/link the signed agreement when required. DirectShifts exempts agreement-document uploads only.` }] : [];
    }
    // Alternative states require a documented agreement or source-and-date independent verification.
    const authorityAlternative = INDEPENDENT_ALTERNATIVE_STATES.has(state) && rule?.collab_requirement_type === 'conditional';
    if (!rule || (!rule.ca_required && !authorityAlternative) || rule.collab_requirement_type === 'never' || rule.collab_requirement_type === 'md_only') return [];
    if (authorityAlternative && hasVerifiedIndependentPractice(provider.id, state, decisions)) return [];
    const matching = agreements.filter(a => a.profileId === provider.id && a.state === state
      && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase())
      && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day)
      && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day));
    const agreementOnFile = matching.some(a => a.document?.trim() || a.documentExempt);
    if (state === 'NC') {
      const registered = hasVerifiedNcbonRegistration(provider.id, decisions);
      if (agreementOnFile && registered) return [];
      return [{ state, registrationReview: !registered, newlyActive: newlyActiveStates.includes(state),
        reason: !agreementOnFile && !registered ? 'NC signed Collab Agreement and verified NCBON registration are missing.'
          : !agreementOnFile ? 'Missing active linked NC Collab Agreement with its signed document.'
          : 'NC Collab Agreement is on file, but NCBON registration has not been verified.',
        howToFix: `${!agreementOnFile ? 'Add or link the signed NC Collab Agreement. ' : ''}${!registered ? 'Verify registration with NCBON and save where and when it was verified, with a screenshot, document or verification link. ' : ''}NC requires both; independent practice is not an alternative.` }];
    }
    if (state === 'PA') {
      const rxVerified = hasVerifiedRxAuthority(provider.id, state, decisions);
      if (agreementOnFile && rxVerified) return [];
      return [{ state, authorityReview: !rxVerified, independentAlternative: !rxVerified, newlyActive: newlyActiveStates.includes(state),
        reason: !agreementOnFile && !rxVerified
          ? 'PA Collab Agreement and verified Rx Authority license designation with an uploaded verification file are missing.'
          : !agreementOnFile ? 'Missing active linked PA Collab Agreement with its document.'
          : 'PA Collab Agreement is on file, but the Rx Authority license designation needs an uploaded verification file.',
        howToFix: !agreementOnFile && rxVerified
          ? 'Add or link the signed PA Collab Agreement (completed-process option, no emails).'
          : `${!agreementOnFile ? 'Add or link the signed PA Collab Agreement, then verify' : 'Verify'} the Rx Authority license designation with where and when it was verified and an uploaded screenshot or document. PA requires both; autonomous practice is not an alternative.` }];
    }
    if (agreementOnFile && RX_AUTHORITY_REQUIRED_STATES.has(state)
      && !hasVerifiedRxAuthority(provider.id, state, decisions) && !hasPrescriptiveAuthority(provider.id, state, authorityEvidence, day)) {
      return [{ state, authorityReview: true, independentAlternative: true, newlyActive: newlyActiveStates.includes(state),
        reason: `${state} collaborative agreement is on file, but the prescriptive authority designation on the license has not been confirmed.`,
        howToFix: `Verify the ${state} license shows prescriptive authority and note where and when it was verified.` }];
    }
    if (agreementOnFile) return [];
    if (authorityAlternative && RX_AUTHORITY_REQUIRED_STATES.has(state)) return [{ state, authorityReview: true, independentAlternative: true, newlyActive: newlyActiveStates.includes(state),
      reason: `No ${state} collaborative agreement link is on file and autonomous practice has not been verified.`,
      howToFix: `${state} needs either a collaborative agreement plus prescriptive authority on the license, or prescriptive authority plus an autonomous practice designation. Upload the agreement and verify Rx authority, or verify both designations and note where and when.` }];
    if (authorityAlternative) return [{ state, authorityReview: true, independentAlternative: true, newlyActive: newlyActiveStates.includes(state),
      reason: `No ${state} collaborative agreement link is on file and independent practice status has not been verified.`,
      howToFix: `Either upload or link the signed ${state} collaborative agreement (completed-process option, no emails), or verify independent practice status and note where and when it was verified.` }];
    return [{ state, newlyActive: newlyActiveStates.includes(state), reason: matching.length ? 'Active agreement has no attached document.' : 'Missing active linked collaborative agreement.', howToFix: matching.length
      ? 'Open Agreements and attach the signed document or its link to the existing agreement.'
      : 'Open Agreements and link the existing signed agreement to this provider and state. Use the completed-process option to avoid repeat notifications; do not mark it active without verified evidence.' }];
  });
}