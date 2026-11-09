import { activeStateAgreementFlags, type CollaborationRule, type StateAgreement } from '@/lib/activeStateAgreementFlags';
import { isIndependentPhysician, isNonNpBehavioralRole, normalizeRole } from '@/lib/clinicianRoles';
import { licensedNotActiveStates } from '@/lib/licensedNotActiveStates';
import { hasVerifiedIndependentPractice, hasVerifiedNcbonRegistration, hasVerifiedRxAuthority, type CollabDecision } from '@/lib/nyIndependentPractice';
import { hasPrescriptiveAuthority, type PrescriptiveAuthorityEvidence } from '@/lib/prescriptiveAuthorityEvidence';
import { REQUIREMENT_LABELS, SHEET_REQUIREMENTS, sheetLicenseStatus, validRequirementProof, type RequirementProof, type SheetLicense } from '@/lib/stateSheetRequirements';
import { stateRequirementSummary } from '@/lib/stateRequirementSummary';
import { parseLocalDate } from '@/lib/utils';

export interface ProviderStateExportEvidence {
  agreements: StateAgreement[];
  rules: CollaborationRule[];
  decisions: CollabDecision[];
  authorityEvidence: PrescriptiveAuthorityEvidence[];
  requirementProofs: RequirementProof[];
  sheetLicenses: SheetLicense[];
}

/** Export saved evidence, not an inference that EHR activation proves requirements. */
export function providerStateExportRows(
  provider: { id: string; full_name?: string | null; profession?: string | null; credentials?: string | null },
  licensed: string[], active: string[], coverageKnown: boolean,
  evidence: ProviderStateExportEvidence, today = new Date(),
) {
  const role = normalizeRole(provider.profession);
  const np = !isIndependentPhysician(provider) && !isNonNpBehavioralRole(provider)
    && (['np', 'apn', 'aprn', 'npp', 'nurse practitioner', 'nurse practitioner, certified'].includes(role)
      || (!role && /\b(np|aprn|fnp|agpcnp)\b/i.test(provider.credentials ?? '')));
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const states = [...new Set([...active, ...(coverageKnown ? licensedNotActiveStates(licensed, active) : licensed)])].sort();
  const reviews = activeStateAgreementFlags(provider, states, evidence.rules, evidence.agreements, evidence.decisions,
    day, evidence.authorityEvidence, [], evidence.requirementProofs, evidence.sheetLicenses);
  return states.map(state => {
    const rule = evidence.rules.find(r => r.state_abbreviation === state);
    const fulfilled: string[] = [];
    const licenseStatus = sheetLicenseStatus(provider.id, state, evidence.sheetLicenses, evidence.requirementProofs, day);
    if (licenseStatus === 'valid') fulfilled.push('Active license status');
    if (np) {
      const config = SHEET_REQUIREMENTS[state];
      const agreement = evidence.agreements.find(a => a.profileId === provider.id && a.state === state
        && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase()) && (!!a.document?.trim() || a.documentExempt)
        && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day) && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day));
      if (agreement) fulfilled.push(agreement.documentExempt ? 'Collab Agreement (DirectShifts physician — document exempt)' : 'Signed Collab Agreement');
      const keys = config?.keys ?? (state === 'PA' ? ['pals_collab_registration'] : []);
      for (const key of keys) {
        if (evidence.requirementProofs.some(p => p.profile_id === provider.id && p.state_abbreviation === state
          && p.requirement_key === key && validRequirementProof(p, day))) fulfilled.push(REQUIREMENT_LABELS[key] ?? key);
      }
      if (hasVerifiedIndependentPractice(provider.id, state, evidence.decisions)) fulfilled.push('Verified independent practice');
      if (state === 'NC' && hasVerifiedNcbonRegistration(provider.id, evidence.decisions)) fulfilled.push('Verified NCBON registration');
      if (['PA', 'VA'].includes(state) && (hasVerifiedRxAuthority(provider.id, state, evidence.decisions)
        || (state !== 'PA' && hasPrescriptiveAuthority(provider.id, state, evidence.authorityEvidence, day)))) fulfilled.push('Prescriptive authority');
    }
    const outstanding = reviews.find(r => r.state === state)?.reason;
    return {
      Provider: provider.full_name ?? '',
      State: state,
      'EHR status': active.includes(state) ? 'Active states in EHR' : coverageKnown ? 'Licensed but not active in EHR' : 'EHR status unavailable',
      'State requirements': np ? stateRequirementSummary(state, rule?.collab_requirement_type, rule?.ca_required) : 'NP requirements not applicable; active license required for licensed professions',
      'Requirements fulfilled': [...new Set(fulfilled)].join('; ') || 'No fulfilled requirements confirmed on record',
      'Outstanding requirements': [licenseStatus === 'unknown' ? 'License status unconfirmed' : licenseStatus === 'invalid' ? 'Active license required' : '', outstanding ?? ''].filter(Boolean).join('; ') || 'None',
    };
  });
}

/** States where NP practice is prohibited; physicians practice independently there. */
const MD_DO_ONLY_STATES = new Set(['AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA']);

/** Two-column export: MD/DO-only states for NPs, states with a current collaborative agreement are Collaborative Agreement; all others Independent. */
export function providerStateStatusRows(
  provider: { id: string; profession?: string | null; credentials?: string | null },
  states: string[], agreements: StateAgreement[], today = new Date(),
) {
  const role = normalizeRole(provider.profession);
  const np = !isIndependentPhysician(provider) && !isNonNpBehavioralRole(provider)
    && (['np', 'apn', 'aprn', 'npp', 'nurse practitioner', 'nurse practitioner, certified'].includes(role)
      || (!role && /\b(np|aprn|fnp|agpcnp)\b/i.test(provider.credentials ?? '')));
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return [...new Set(states)].sort().map(state => {
    if (np && MD_DO_ONLY_STATES.has(state)) return { State: state, Status: 'MD/DO Only' };
    const collaborative = agreements.some(a => a.profileId === provider.id && a.state === state
      && ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase())
      && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day) && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day));
    return { State: state, Status: collaborative ? 'Collaborative Agreement' : 'Independent' };
  });
}