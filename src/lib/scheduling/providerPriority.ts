export type ProviderPriorityKey =
  | 'clinical_supervisor'
  | 'vitable_internal'
  | 'directshifts_brittany_priority'
  | 'access_provider';

export type ProviderPriority = {
  key: ProviderPriorityKey;
  rank: 0 | 1 | 2;
  label: string;
};

export type ProviderPriorityProfile = {
  name?: string | null;
  profession?: string | null;
  employment_type?: string | null;
  source?: string | null;
  shift_types?: string[] | null;
};

export const PROVIDER_PRIORITY_BY_KEY: Record<ProviderPriorityKey, ProviderPriority> = {
  clinical_supervisor: { key: 'clinical_supervisor', rank: 0, label: 'Clinical supervisor' },
  vitable_internal: { key: 'vitable_internal', rank: 1, label: 'Vitable internal' },
  directshifts_brittany_priority: {
    key: 'directshifts_brittany_priority',
    rank: 2,
    label: 'DirectShifts Brittany priority',
  },
  access_provider: { key: 'access_provider', rank: 2, label: 'Access provider' },
};

const DEFAULT_PROVIDER_PRIORITY = PROVIDER_PRIORITY_BY_KEY.vitable_internal;

const normalizedProviderText = (profile: ProviderPriorityProfile | null | undefined) => {
  if (!profile) return '';
  const employmentType = (profile.employment_type ?? '').trim().toLowerCase();
  const source = (profile.source ?? '').trim().toLowerCase();
  const shiftTypes = Array.isArray(profile.shift_types) ? profile.shift_types : [];
  return [
    profile.name,
    profile.profession,
    employmentType,
    source,
    ...shiftTypes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export function isDirectShiftsProvider(profile: ProviderPriorityProfile | null | undefined): boolean {
  if (!profile) return false;
  const employmentType = (profile.employment_type ?? '').trim().toLowerCase();
  const source = (profile.source ?? '').trim().toLowerCase();
  const haystack = normalizedProviderText(profile);
  return (
    employmentType === 'agency' ||
    source.includes('directshifts') ||
    source.includes('direct shifts') ||
    haystack.includes('directshifts') ||
    haystack.includes('direct shifts') ||
    haystack.includes('agency supplied')
  );
}

export function isBrittanyDirectShiftsProvider(
  profile: ProviderPriorityProfile | null | undefined,
): boolean {
  if (!profile || !isDirectShiftsProvider(profile)) return false;
  const name = (profile.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return name.split(/\s+/).includes('brittany');
}

export function providerPriorityFor(
  profile: ProviderPriorityProfile | null | undefined,
): ProviderPriority {
  if (!profile) return DEFAULT_PROVIDER_PRIORITY;
  const employmentType = (profile.employment_type ?? '').trim().toLowerCase();
  const source = (profile.source ?? '').trim().toLowerCase();
  const haystack = normalizedProviderText(profile);

  if (
    haystack.includes('clinical supervisor') ||
    haystack.includes('clinical lead') ||
    haystack.includes('supervisor')
  ) {
    return PROVIDER_PRIORITY_BY_KEY.clinical_supervisor;
  }

  if (isBrittanyDirectShiftsProvider(profile)) {
    return PROVIDER_PRIORITY_BY_KEY.directshifts_brittany_priority;
  }

  if (
    employmentType === 'agency' ||
    source.includes('directshifts') ||
    source.includes('direct shifts') ||
    source.includes('access') ||
    haystack.includes('directshifts') ||
    haystack.includes('direct shifts') ||
    haystack.includes('access provider') ||
    haystack.includes('agency supplied')
  ) {
    return PROVIDER_PRIORITY_BY_KEY.access_provider;
  }

  return DEFAULT_PROVIDER_PRIORITY;
}

export function compareProviderAllocationPriority(
  a: ProviderPriorityProfile | null | undefined,
  b: ProviderPriorityProfile | null | undefined,
): number {
  const priorityA = providerPriorityFor(a);
  const priorityB = providerPriorityFor(b);
  if (priorityA.rank !== priorityB.rank) return priorityA.rank - priorityB.rank;

  const bothDirectShifts = isDirectShiftsProvider(a) && isDirectShiftsProvider(b);
  if (bothDirectShifts) {
    const brittanyRankA = isBrittanyDirectShiftsProvider(a) ? 0 : 1;
    const brittanyRankB = isBrittanyDirectShiftsProvider(b) ? 0 : 1;
    if (brittanyRankA !== brittanyRankB) return brittanyRankA - brittanyRankB;
  }

  return 0;
}
