import { hasVerificationLink } from '@/lib/nyIndependentPractice';
import { parseLocalDate } from '@/lib/utils';

export const SHEET_REQUIREMENTS: Record<string, { label: string; keys: string[]; agreement?: boolean; alternative?: boolean; anyDesignation?: boolean; agreementSubstitute?: string }> = {
  AK: { label: 'Active license status only', keys: ['active_license'] },
  AZ: { label: 'Active license status only', keys: ['active_license'] },
  AR: { label: '"Prescriptive authority: yes" + Signed Collab Agreement + State Board Registration', keys: ['rx_authority', 'board_registration'], agreement: true },
  CA: { label: '"Nurse Practitioner Furnishing" License + Signed Collab Agreement', keys: ['furnishing_license'], agreement: true },
  CO: { label: 'C-RXN License', keys: ['c_rxn_license'] },
  CT: { label: '"Practice without collaborative agreement: yes" on License', keys: ['practice_without_collab'] },
  DE: { label: '"Prescriptive authority" Endorsement on License OR Nursing Interstate Telehealth Registration', keys: ['rx_authority', 'nursing_interstate_telehealth_registration'], alternative: true, anyDesignation: true },
  FL: { label: 'Autonomous Status on License OR Signed Collab Agreement OR TLHT (Telehealth) Designation', keys: ['autonomous_status', 'tlht_designation'], agreement: true, alternative: true, anyDesignation: true },
  ID: { label: 'Active license status only', keys: ['active_license'] },
  IA: { label: 'Active license status only', keys: ['active_license'] },
  KS: { label: 'Active license status only', keys: ['active_license'] },
  ME: { label: 'Active license status only', keys: ['active_license'] },
  MD: { label: 'Active license status only', keys: ['active_license'] },
  MI: { label: 'Active license status only', keys: ['active_license'] },
  MT: { label: 'Active license status only', keys: ['active_license'] },
  NH: { label: 'Active license status only', keys: ['active_license'] },
  NM: { label: 'Active license status only', keys: ['active_license'] },
  OR: { label: 'Active license status only', keys: ['active_license'] },
  RI: { label: 'Active license status only', keys: ['active_license'] },
  UT: { label: 'Active license status only', keys: ['active_license'] },
  WA: { label: 'Active license status only', keys: ['active_license'] },
  WY: { label: 'Active license status only', keys: ['active_license'] },
  HI: { label: '"Prescriptive authority" Special Privilege Designation on License', keys: ['rx_authority'] },
  IL: { label: 'Signed Collab Agreement OR Full Practice Authority APRN License', keys: ['full_practice_authority'], agreement: true, alternative: true },
  KY: { label: 'CAPA-NS/Prescriptive authority designations on license (no collab agreement needed unless this is not on the license)', keys: ['capa_ns', 'rx_authority'], agreementSubstitute: 'capa_ns' },
  MA: { label: 'Rx Authority Designation on License + CSR OR Signed Collab Agreement', keys: ['rx_authority', 'csr_registration'], agreement: true, alternative: true },
  NV: { label: 'Active license status only', keys: ['active_license'] },
  NJ: { label: 'Signed Collab Agreement', keys: [], agreement: true },
  ND: { label: '"Prescriptive Authority: YES" on License', keys: ['rx_authority'] },
  OH: { label: 'Signed Collab Agreement', keys: [], agreement: true },
  SD: { label: '"Full Practice Authority/Prescriptive Authority: YES" Status', keys: ['full_practice_authority'] },
  TX: { label: 'Signed Collab Agreement + Filed with State Board', keys: ['board_registration'], agreement: true },
  VT: { label: '"Independent Practice, Prescriptive Authority" on License OR Signed Collab Agreement OR Advanced Practice Registered Nurse - Telehealth Registration', keys: ['independent_practice', 'aprn_telehealth_registration'], agreement: true, alternative: true, anyDesignation: true },
  WI: { label: 'Signed Collab Agreement OR Independent Practice Designation on License', keys: ['independent_practice'], agreement: true, alternative: true },
};
export const REQUIREMENT_LABELS: Record<string, string> = {
  active_license: 'Active license status', rx_authority: 'Prescriptive authority', board_registration: 'Collab Agreement registered with state board',
  furnishing_license: 'Nurse Practitioner Furnishing license', c_rxn_license: 'C-RXN license', practice_without_collab: 'Practice without collaborative agreement: yes', autonomous_status: 'Autonomous status on license',
  tlht_designation: 'TLHT (Telehealth) designation',
  nursing_interstate_telehealth_registration: 'Nursing Interstate Telehealth Registration',
  aprn_telehealth_registration: 'Advanced Practice Registered Nurse - Telehealth Registration',
  full_practice_authority: 'Full practice authority on license', csr_registration: 'Controlled substance registration (CSR)',
  capa_ns: 'CAPA-NS designation on license (Collaborative Agreement for Prescriptive Authority for Non-Scheduled Drugs)',
  active_prescribing_cii: 'Active Prescribing - CII license status', independent_practice: 'Independent practice designation on license',
};
export interface RequirementProof {
  profile_id: string; state_abbreviation: string; requirement_key: string; verified_source: string; verified_on: string;
  verified_link?: string | null; verified_attachment_path?: string | null; verified_attachment_name?: string | null; expiration_date?: string | null;
}
export interface SheetLicense { profileId: string | null; state: string; status: string | null; expiration?: string | null; issue?: string | null }
export function validRequirementProof(p: RequirementProof, day = new Date()) {
  return !!p.verified_source.trim() && !!p.verified_on && parseLocalDate(p.verified_on) <= day
    && (!p.expiration_date || parseLocalDate(p.expiration_date) >= new Date(day.getFullYear(), day.getMonth(), day.getDate()))
    && (!!p.verified_attachment_path?.trim() || hasVerificationLink(p.verified_link));
}
export function sheetLicenseStatus(profileId: string, state: string, licenses: SheetLicense[], proofs: RequirementProof[], day = new Date()): 'valid' | 'invalid' | 'unknown' {
  if (proofs.some(p => p.profile_id === profileId && p.state_abbreviation === state && p.requirement_key === 'active_license' && validRequirementProof(p, day))) return 'valid';
  const date = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const matching = licenses.filter(l => l.profileId === profileId && l.state === state);
  if (matching.some(l => ['active', 'verified'].includes((l.status ?? '').toLowerCase()) && (!l.issue || parseLocalDate(l.issue.slice(0, 10)) <= date) && (!l.expiration || parseLocalDate(l.expiration.slice(0, 10)) >= date))) return 'valid';
  if (matching.length && matching.every(l => ['expired','invalid','revoked','suspended','inactive'].includes((l.status ?? '').toLowerCase()) || (!!l.expiration && parseLocalDate(l.expiration.slice(0,10)) < date))) return 'invalid';
  return 'unknown';
}
export function missingSheetRequirements(profileId: string, state: string, agreement: boolean, proofs: RequirementProof[], licenses: SheetLicense[], day = new Date()): string[] {
  const config = SHEET_REQUIREMENTS[state];
  if (!config) return [];
  if (config.keys.length === 1 && config.keys[0] === 'active_license') return sheetLicenseStatus(profileId, state, licenses, proofs, day) === 'invalid' ? ['active_license'] : [];
  const missing = config.keys.filter(key => !(config.agreementSubstitute === key && agreement) && !proofs.some(p => p.profile_id === profileId && p.state_abbreviation === state && p.requirement_key === key && validRequirementProof(p, day)));
  if (config.alternative) return (config.agreement && agreement) || (config.anyDesignation ? missing.length < config.keys.length : !missing.length) ? [] : [...missing, ...(config.agreement ? ['collab_agreement'] : [])];
  return [...missing, ...(config.agreement && !agreement ? ['collab_agreement'] : [])];
}