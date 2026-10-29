import { parseLocalDate } from '@/lib/utils';

export interface PrescriptiveAuthorityEvidence {
  profileId: string | null;
  state: string;
  authority: string | null;
  status: string | null;
  expiration?: string | null;
  issue?: string | null;
  verified?: boolean | null;
}

/** Only explicit, current, identity-linked authority qualifies; ordinary NP licenses do not. */
export function hasPrescriptiveAuthority(profileId: string, state: string, evidence: PrescriptiveAuthorityEvidence[], today: Date) {
  return evidence.some(row => row.profileId === profileId && row.state === state
    && ['rx_included', 'prescriptive_authority'].includes((row.authority ?? '').trim().toLowerCase())
    && ['active', 'verified'].includes((row.status ?? '').trim().toLowerCase())
    && row.verified !== false
    && (!row.expiration || parseLocalDate(row.expiration.slice(0, 10)) >= today)
    && (!row.issue || parseLocalDate(row.issue.slice(0, 10)) <= today));
}

/** Compare successful, identity-resolved snapshots; an initial snapshot is not a change. */
export function addedActiveEhrStates(current: Map<string, string[]>, previous?: Map<string, string[]>) {
  const added = new Map<string, string[]>();
  if (!previous) return added;
  for (const [id, states] of current) {
    const old = new Set(previous.get(id) ?? []);
    added.set(id, states.filter(state => !old.has(state)));
  }
  return added;
}