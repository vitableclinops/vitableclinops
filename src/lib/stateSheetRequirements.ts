import { hasVerificationLink } from '@/lib/nyIndependentPractice';
import { parseLocalDate } from '@/lib/utils';

export const SHEET_REQUIREMENTS: Record<string, { label: string; keys: string[]; agreement?: boolean; alternative?: boolean }> = {
  AK: { label: 'Active license status only', keys: ['active_license'] },
  AZ: { label: 'Active license status only', keys: ['active_license'] },
  AR: { label: '"Prescriptive authority: yes" + Signed Collab Agreement + State Board Registration', keys: ['rx_authority', 'board_registration'], agreement: true },
  CA: { label: '"Nurse Practitioner Furnishing" License + Signed Collab Agreement', keys: ['furnishing_license'], agreement: true },
  CO: { label: 'C-RXN License', keys: ['c_rxn_license'] },
  CT: { label: '"Practice without collaborative agreement: yes" on License', keys: ['practice_without_collab'] },
  DE: { label: '"Prescriptive authority" Endorsement on License', keys: ['rx_authority'] },
  FL: { label: 'Autonomous Status on License OR Signed Collab Agreement', keys: ['autonomous_status'], agreement: true, alternative: true },
};
export const REQUIREMENT_LABELS: Record<string, string> = {
  active_license: 'Active license status', rx_authority: 'Prescriptive authority', board_registration: 'Collab Agreement registered with state board',
  furnishing_license: 'Nurse Practitioner Furnishing license', c_rxn_license: 'C-RXN license', practice_without_collab: 'Practice without collaborative agreement: yes', autonomous_status: 'Autonomous status on license',
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
  if (state === 'AK' || state === 'AZ') return sheetLicenseStatus(profileId, state, licenses, proofs, day) === 'invalid' ? ['active_license'] : [];
  const missing = config.keys.filter(key => !proofs.some(p => p.profile_id === profileId && p.state_abbreviation === state && p.requirement_key === key && validRequirementProof(p, day)));
  if (config.alternative) return agreement || !missing.length ? [] : ['autonomous_status', 'collab_agreement'];
  return [...missing, ...(config.agreement && !agreement ? ['collab_agreement'] : [])];
}