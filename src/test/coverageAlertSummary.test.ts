import { describe, expect, it } from 'vitest';
import { coverageAlertSummary, coverageNeedsReview } from '@/lib/coverageAlertSummary';
import type { PcpCoverageData } from '@/hooks/usePcpCoverage';
import type { EhrIdentity } from '@/lib/pcpCoverage';

const identity = (over: Partial<EhrIdentity>): EhrIdentity => ({
  ehrProviderId: 'ehr-1',
  ehrName: 'Jane Doe',
  npi: '1234567890',
  states: ['CA'],
  status: 'matched',
  profileId: 'profile-1',
  nameDiffers: false,
  reason: '',
  ...over,
});

const snapshot = (over: Partial<PcpCoverageData> = {}): PcpCoverageData => ({
  statesByProfile: new Map(),
  identities: [],
  pulledAt: new Date(Date.now() - 3600_000).toISOString(),
  warehouseLatestChangeAt: new Date(Date.now() - 7200_000).toISOString(),
  stale: false,
  lastAttempt: { status: 'success', at: new Date().toISOString(), error: null },
  ...over,
});

describe('Condensed coverage status for the provider flagged alert', () => {
  it('reports a recent snapshot as fetched recently with no issues', () => {
    const summary = coverageAlertSummary(snapshot());
    expect(summary.status).toBe('ok');
    expect(summary.label).toBe('Fetched recently');
    expect(summary.hasIssues).toBe(false);
    expect(summary.failure).toBeNull();
    expect(summary.summary).toContain('fetched recently');
  });

  it('marks an old snapshot stale so it stays visible in the alert', () => {
    const summary = coverageAlertSummary(snapshot({ stale: true }));
    expect(summary.status).toBe('stale');
    expect(summary.label).toBe('Stale snapshot');
    expect(summary.hasIssues).toBe(true);
  });

  it('surfaces a failed refresh without hiding the last good snapshot', () => {
    const summary = coverageAlertSummary(
      snapshot({ lastAttempt: { status: 'failed', at: '2026-10-28T09:00:00Z', error: 'timeout' } }),
    );
    expect(summary.failure).toContain('Latest refresh failed');
    expect(summary.hasIssues).toBe(true);
  });

  it('lists unmatched, ambiguous and name-disagreeing identities for review only', () => {
    const summary = coverageAlertSummary(
      snapshot({
        identities: [
          identity({ ehrProviderId: 'a', status: 'matched', nameDiffers: false }),
          identity({ ehrProviderId: 'b', status: 'unmatched', profileId: null, reason: 'NPI not in directory' }),
          identity({ ehrProviderId: 'c', status: 'ambiguous', candidateProfileIds: ['x', 'y'], reason: 'two directory records share this NPI' }),
          identity({ ehrProviderId: 'd', status: 'excluded', reason: 'former employee' }),
          identity({ ehrProviderId: 'e', status: 'matched', nameDiffers: true }),
        ],
      }),
    );
    expect(summary.review.map(i => i.ehrProviderId)).toEqual(['b', 'c', 'e']);
    expect(summary.excluded.map(i => i.ehrProviderId)).toEqual(['d']);
    expect(summary.hasIssues).toBe(true);
    expect(summary.counts).toEqual({ matched: 2, unmatched: 1, ambiguous: 1, excluded: 1 });
  });

  it('does not flag a deliberate exclusion for review', () => {
    expect(coverageNeedsReview(identity({ status: 'excluded', reason: 'former employee' }))).toBe(false);
    expect(coverageAlertSummary(snapshot({ identities: [identity({ status: 'excluded' })] })).hasIssues).toBe(false);
  });

  it('says coverage is unavailable when no snapshot exists', () => {
    const summary = coverageAlertSummary(null);
    expect(summary.status).toBe('unavailable');
    expect(summary.summary).toContain('unavailable');
    expect(summary.hasIssues).toBe(true);
  });
});
