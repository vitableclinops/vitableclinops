import type { PcpCoverageData } from '@/hooks/usePcpCoverage';
import type { EhrIdentity } from '@/lib/pcpCoverage';

/** Condensed view of the coverage snapshot for the top-of-directory alert. */
export interface CoverageAlertSummary {
  status: 'ok' | 'stale' | 'unavailable';
  label: string;
  /** One-line freshness + identity-count statement shown under the flag list. */
  summary: string;
  failure: string | null;
  counts: { matched: number; unmatched: number; ambiguous: number; excluded: number };
  review: EhrIdentity[];
  excluded: EhrIdentity[];
  hasIssues: boolean;
}

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT'
    : 'not recorded';

/** Unmatched, ambiguous, or linked-by-NPI-but-name-disagrees records. */
export function coverageNeedsReview(identity: EhrIdentity): boolean {
  return identity.status === 'unmatched' || identity.status === 'ambiguous' || identity.nameDiffers;
}

export function coverageAlertSummary(data: PcpCoverageData | null): CoverageAlertSummary {
  if (!data || !data.pulledAt) {
    return {
      status: 'unavailable',
      label: 'Coverage unavailable',
      summary: 'Active states in EHR: unavailable — no ID-based snapshot has been fetched yet.',
      failure: null,
      counts: { matched: 0, unmatched: 0, ambiguous: 0, excluded: 0 },
      review: [],
      excluded: [],
      hasIssues: true,
    };
  }
  const count = (s: EhrIdentity['status']) => data.identities.filter(i => i.status === s).length;
  const lastAttempt = data.lastAttempt;
  const failed = lastAttempt && lastAttempt.status !== 'success' && lastAttempt.status !== 'running' ? lastAttempt : null;
  const status = data.stale ? 'stale' : 'ok';
  const review = data.identities.filter(coverageNeedsReview);
  const excluded = data.identities.filter(i => i.status === 'excluded');
  return {
    status,
    label: data.stale ? 'Stale snapshot' : 'Fetched recently',
    summary:
      `Active states in EHR — ${data.stale ? 'stale snapshot' : 'fetched recently'}. ` +
      `Last successful fetch: ${fmt(data.pulledAt)}. Latest source-record change: ${fmt(data.warehouseLatestChangeAt)}. ` +
      `${count('matched')} matched by NPI · ${count('unmatched')} unmatched · ${count('ambiguous')} ambiguous · ${count('excluded')} excluded.`,
    failure: failed ? `Latest refresh failed ${fmt(failed.at)} — showing the last successful snapshot.` : null,
    counts: { matched: count('matched'), unmatched: count('unmatched'), ambiguous: count('ambiguous'), excluded: count('excluded') },
    review,
    excluded,
    hasIssues: status !== 'ok' || !!failed || review.length > 0,
  };
}
