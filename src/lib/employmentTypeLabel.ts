// Display-only employment label overrides. The stored employment_type stays
// untouched; only the directory bubble text changes for these providers.
const W2_LABEL_OVERRIDES = new Set([
  'genevieve.teetie@vitablehealth.com',
  'shanta.w@vitablehealth.com',
  'rebecca.keuch@vitablehealth.com',
]);

export function employmentTypeBadgeLabel(provider: { email?: string | null; employment_type?: string | null }): string | null {
  if (provider.employment_type === 'w2' && provider.email && W2_LABEL_OVERRIDES.has(provider.email)) {
    return 'W2';
  }
  return null;
}
