export interface CollabDecision {
  profile_id: string;
  state_abbreviation: string;
  decision: string;
  verified_source?: string | null;
  verified_on?: string | null;
  verified_link?: string | null;
  verified_attachment_path?: string | null;
  verified_attachment_name?: string | null;
}

/** States where a confirmed independent-practice verification is an alternative to a collaborative agreement. */
export const INDEPENDENT_ALTERNATIVE_STATES = new Set(['NY', 'WV', 'OK', 'VA']);

/** Independent status counts only when it was recorded with where and when it was verified. */
export function hasVerifiedIndependentPractice(profileId: string, state: string, decisions: CollabDecision[]) {
  return INDEPENDENT_ALTERNATIVE_STATES.has(state) && decisions.some(d => d.profile_id === profileId
    && d.state_abbreviation === state && d.decision === 'independent_verified'
    && !!d.verified_source?.trim() && !!d.verified_on);
}

/** States where every path also needs a prescriptive-authority designation on the license. */
export const RX_AUTHORITY_REQUIRED_STATES = new Set(['VA', 'PA']);

export function hasVerificationLink(link?: string | null): boolean {
  if (!link?.trim()) return false;
  try {
    const url = new URL(link.trim());
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname;
  } catch { return false; }
}

/** Rx authority is confirmed by a saved source-and-date verification; autonomous verification includes Rx authority. */
export function hasVerifiedRxAuthority(profileId: string, state: string, decisions: CollabDecision[]) {
  return decisions.some(d => d.profile_id === profileId && d.state_abbreviation === state
    && (d.decision === 'rx_authority_verified' || (state !== 'PA' && d.decision === 'independent_verified'))
    && !!d.verified_source?.trim() && !!d.verified_on
    && (state !== 'PA' || hasVerificationLink(d.verified_link)));
}
