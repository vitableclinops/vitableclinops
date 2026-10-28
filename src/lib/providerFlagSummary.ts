import type { EhrIdentity } from '@/lib/pcpCoverage';

interface Conflict { field: string; local: string | null; medallion: string | null }
export interface IdentityReview { reason: string; howToFix: string }
export interface FlaggedProvider {
  id: string;
  name: string;
  conflicts: Conflict[];
  identityReview?: IdentityReview;
  sourceIdentityReviews?: IdentityReview[];
  profileId?: string;
}

export function sourceIdentityAlert(identity: EhrIdentity): IdentityReview {
  const reason = identity.status === 'matched' && identity.nameDiffers
    ? 'Linked by NPI, but the EHR name differs from the directory record.'
    : identity.reason;
  const howToFix = identity.status === 'matched' && identity.nameDiffers
    ? 'The NPI already matches. Verify the legal name in the directory and EHR, then correct the inaccurate name. Keep nicknames as preferred names; do not change a verified NPI.'
    : identity.status === 'ambiguous'
      ? 'Ask an admin to compare the directory and EHR records using verified NPIs and provider IDs. Correct inaccurate NPIs or consolidate confirmed duplicates while preserving licenses and agreements. Do not assign coverage or delete records until identity is verified.'
      : 'Verify this provider’s 10-digit NPI in the EHR and directory. Correct the inaccurate NPI, or add a directory profile if this is a confirmed current provider with no record. Never match people by name alone. Recheck after the next successful coverage refresh.';
  return { reason: `${reason} EHR NPI: ${identity.npi ?? 'not supplied'}.`, howToFix };
}

/** Merge only by saved profile ID; unmatched source identities remain unlinked. */
export function mergeProviderFlags(
  providers: FlaggedProvider[],
  identities: EhrIdentity[],
  profiles: { id: string; name: string; suppress: boolean }[],
): FlaggedProvider[] {
  const catalog = new Map(profiles.map(p => [p.id, p]));
  const flags = new Map(providers.map(p => [p.id, { ...p, profileId: p.id, sourceIdentityReviews: [] as IdentityReview[] }]));
  for (const identity of identities) {
    if (identity.status === 'excluded') continue;
    const profile = identity.profileId ? catalog.get(identity.profileId) : undefined;
    if (profile?.suppress) continue;
    if (!identity.profileId && identity.candidateProfileIds?.length && identity.candidateProfileIds.every(id => catalog.get(id)?.suppress)) continue;
    const key = identity.profileId ?? `ehr:${identity.ehrProviderId}`;
    const existing = flags.get(key);
    const review = sourceIdentityAlert(identity);
    if (existing) {
      // The computed directory warning already explains this same identity.
      if (!existing.identityReview) existing.sourceIdentityReviews.push(review);
    } else {
      flags.set(key, {
        id: key, name: profile?.name ?? identity.ehrName,
        profileId: profile?.id, conflicts: [], sourceIdentityReviews: [review],
      });
    }
  }
  return [...flags.values()].sort((a, b) => a.name.localeCompare(b.name));
}