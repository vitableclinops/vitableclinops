import { describe, expect, it } from 'vitest';
import { mergeProviderFlags } from '@/lib/providerFlagSummary';
import type { EhrIdentity } from '@/lib/pcpCoverage';

const identity = (over: Partial<EhrIdentity> = {}): EhrIdentity => ({
  ehrProviderId: 'ehr-1', ehrName: 'Jane', npi: '1234567890', states: ['CA'],
  status: 'matched', profileId: 'p1', nameDiffers: true, reason: 'Name differs', ...over,
});
const profiles = [{ id: 'p1', name: 'Jane Doe', suppress: false }];

describe('Unified provider identity flags', () => {
  it('counts a directory and source review for the same saved profile once', () => {
    const flags = mergeProviderFlags([{ id: 'p1', name: 'Jane Doe', conflicts: [], identityReview: { reason: 'Name differs', howToFix: 'Verify legal name' } }], [identity()], profiles);
    expect(flags).toHaveLength(1);
    expect(flags[0].profileId).toBe('p1');
    expect(flags[0].sourceIdentityReviews).toEqual([]);
    expect(flags[0].identityReview).toBeDefined();
  });
  it('adds source-only reviews to the individual provider list', () => {
    const flags = mergeProviderFlags([], [identity()], profiles);
    expect(flags).toHaveLength(1);
    expect(flags[0].id).toBe('p1');
    expect(flags[0].sourceIdentityReviews).toHaveLength(1);
  });
  it('never links an unmatched EHR identity by a matching name', () => {
    const flags = mergeProviderFlags([], [identity({ profileId: null, status: 'unmatched', ehrName: 'Jane Doe' })], profiles);
    expect(flags[0].id).toBe('ehr:ehr-1');
    expect(flags[0].profileId).toBeUndefined();
    expect(flags[0].sourceIdentityReviews).toHaveLength(1);
  });
  it('keeps ambiguous records unlinked even with candidate profiles', () => {
    const flags = mergeProviderFlags([], [identity({ profileId: null, status: 'ambiguous', candidateProfileIds: ['p1'] })], profiles);
    expect(flags[0].profileId).toBeUndefined();
    expect(flags[0].sourceIdentityReviews).toHaveLength(1);
  });
  it('does not reintroduce confirmed test or excluded source records', () => {
    expect(mergeProviderFlags([], [identity()], [{ ...profiles[0], suppress: true }])).toEqual([]);
    expect(mergeProviderFlags([], [identity({ status: 'excluded' })], profiles)).toEqual([]);
  });
  it('does not suppress a genuine name conflict for an otherwise eligible profile', () => {
    expect(mergeProviderFlags([], [identity()], profiles)[0].sourceIdentityReviews).toHaveLength(1);
  });
});