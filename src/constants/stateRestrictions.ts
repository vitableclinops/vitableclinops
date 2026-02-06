// States where NPs cannot practice
export const NP_PROHIBITED_STATES = ['AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA'] as const;

// Collab requirement classifications
export const COLLAB_NEVER_STATES = [
  'AK', 'AZ', 'DC', 'DE', 'HI', 'IA', 'ID', 'KS', 'MI', 'MT', 'ND', 'NH', 'NM', 'NV', 'OR', 'RI', 'WA', 'WY'
] as const;

export const COLLAB_ALWAYS_STATES = [
  'CA', 'NC', 'NJ', 'NY', 'OH', 'OK', 'PA', 'TX', 'WI', 'WV'
] as const;

export const COLLAB_CONDITIONAL_STATES = [
  'AR', 'CO', 'CT', 'FL', 'IL', 'KY', 'MA', 'MD', 'ME', 'MN', 'NE', 'SD', 'UT', 'VA', 'VT'
] as const;

export type CollabRequirementType = 'never' | 'always' | 'conditional';

export function getCollabRequirementType(stateAbbr: string): CollabRequirementType {
  if (COLLAB_NEVER_STATES.includes(stateAbbr as any)) return 'never';
  if (COLLAB_ALWAYS_STATES.includes(stateAbbr as any)) return 'always';
  if (COLLAB_CONDITIONAL_STATES.includes(stateAbbr as any)) return 'conditional';
  return 'never'; // Default to never if not found
}

export function isNPProhibitedState(stateAbbr: string): boolean {
  return NP_PROHIBITED_STATES.includes(stateAbbr as any);
}

// Minimum patient age options
export const MIN_PATIENT_AGE_OPTIONS = [
  { value: '1.5', label: '1.5+ years (Toddlers and up)' },
  { value: '13', label: '13+ years (Adolescents and up)' },
  { value: '17', label: '17+ years (Adults only)' },
] as const;
