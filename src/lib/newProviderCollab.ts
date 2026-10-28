import { getCollabRequirementType } from '@/constants/stateRestrictions';
import { PROVIDER_TYPE_CONFIG, type ProviderType } from '@/types';

export function newProviderCollabStates(profession: ProviderType, states: string[], requirements: Array<{ state_abbreviation: string; collab_requirement_type: string | null; ca_required: boolean }>) {
  if (!PROVIDER_TYPE_CONFIG[profession]?.requiresCollaborativeAgreement) return [];
  return [...new Set(states)].filter(state => {
    if (getCollabRequirementType(state) === 'md_only') return false;
    const saved = requirements.find(row => row.state_abbreviation === state);
    const type = saved?.collab_requirement_type ?? (saved ? (saved.ca_required ? 'always' : 'never') : getCollabRequirementType(state));
    return type === 'always';
  });
}

export function hasAgreementDocument(file: unknown, link?: string) {
  if (file instanceof File) return true;
  try {
    const url = new URL(link?.trim() ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}