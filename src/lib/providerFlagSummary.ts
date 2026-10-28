import type { EhrIdentity } from '@/lib/pcpCoverage';

interface Conflict { field: string; local: string | null; medallion: string | null }
export interface IdentityReview { reason: string; howToFix: string }
export interface FlaggedProvider {
  id: string;
  name: string;
  conflicts: Conflict[];
  identityReview?: IdentityReview;
  agreementReviews?: import('@/lib/activeStateAgreementFlags').AgreementReview[];
  sourceIdentityReviews?: IdentityReview[];
  profileId?: string;
}

/** User-confirmed EHR identities for offboarded profiles without saved NPIs. Not identity links. */
export const CONFIRMED_OFFBOARDED_EHR_PROFILES: Record<string, string> = {
  '1b2a1a96-7d85-47a1-9125-75525d46c371': '52018090-c1b4-4354-a5b8-434e0d1a16c4',
  'd8ee0aff-067a-42f1-bb82-b0b91fe81887': '68c444a2-0dea-4692-be3b-6275864aba1d',
  '4fc3569a-0bc6-4212-9c74-e13b3dfbb556': 'b9bad450-80f9-40f2-9f3b-ef3600dbddc8',
  'eec8df01-0ef0-4d84-a323-ec78e6fbc75a': '73d38376-1143-4cb7-905e-300b4dc69daf',
  'dff1574d-d60e-468a-836d-86449fef0e37': '791e28bf-0375-465c-b68d-3bfd639fa449',
};

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
  const flags = new Map<string, FlaggedProvider & { sourceIdentityReviews: IdentityReview[] }>(providers.map(p => [p.id, { ...p, profileId: p.id, sourceIdentityReviews: [] }]));
  for (const identity of identities) {
    if (identity.status === 'excluded') continue;
    const confirmedProfileId = CONFIRMED_OFFBOARDED_EHR_PROFILES[identity.ehrProviderId];
    if (confirmedProfileId && catalog.get(confirmedProfileId)?.suppress) continue;
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