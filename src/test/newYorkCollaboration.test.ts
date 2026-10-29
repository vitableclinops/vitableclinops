import { describe, expect, it } from 'vitest';
import { getCollabRequirementType, COLLAB_ALWAYS_STATES } from '@/constants/stateRestrictions';
import { newProviderCollabStates } from '@/lib/newProviderCollab';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
import { addedActiveEhrStates, type PrescriptiveAuthorityEvidence } from '@/lib/prescriptiveAuthorityEvidence';

const provider = { id: 'np', profession: 'NP' };
const today = new Date(2026, 9, 29);
const rules = [
  { state_abbreviation: 'NY', ca_required: false, collab_requirement_type: 'conditional' },
  { state_abbreviation: 'PA', ca_required: true, collab_requirement_type: 'always' },
];
const authority: PrescriptiveAuthorityEvidence = { profileId: 'np', state: 'NY', authority: 'rx_included', status: 'active' };

describe('New York conditional collaboration requirement', () => {
  it('does not require collaboration for every New York provider regardless of prescriptive authority', () => {
    expect(getCollabRequirementType('NY')).toBe('conditional');
    expect(COLLAB_ALWAYS_STATES).not.toContain('NY');
    expect(newProviderCollabStates('nurse_practitioner', ['NY'], [
      { state_abbreviation: 'NY', ca_required: false, collab_requirement_type: 'conditional' },
    ])).toEqual([]);
  });
  it('clears NY review with explicit current prescriptive authority', () => {
    expect(activeStateAgreementFlags(provider, ['NY'], rules, [], [], today, [authority])).toEqual([]);
  });
  it('flags unknown NY authority without claiming the provider lacks it', () => {
    const flags = activeStateAgreementFlags(provider, ['NY'], rules, [], [], today);
    expect(flags).toHaveLength(1);
    expect(flags[0].authorityReview).toBe(true);
  });
  it('accepts a current documented NY collaboration instead of authority', () => {
    expect(activeStateAgreementFlags(provider, ['NY'], rules, [{ profileId: 'np', state: 'NY', status: 'active', document: 'signed.pdf' }], [], today)).toEqual([]);
  });
  it.each([
    { profileId: 'other' }, { state: 'PA' }, { status: 'pending' },
    { expiration: '2026-10-28' }, { issue: '2026-10-30' }, { authority: 'APRN' }, { verified: false },
  ])('does not clear authority review with mismatched or noncurrent evidence %j', change => {
    expect(activeStateAgreementFlags(provider, ['NY'], rules, [], [], today, [{ ...authority, ...change }])).toHaveLength(1);
  });
  it('does not let NY authority replace a required PA collaboration', () => {
    expect(activeStateAgreementFlags(provider, ['PA'], rules, [], [], today, [authority]).map(f => f.state)).toEqual(['PA']);
  });
  it('rechecks newly active required states and clears deactivated states', () => {
    const previous = new Map([['np', ['NY']]]);
    const current = new Map([['np', ['NY', 'PA']]]);
    const added = addedActiveEhrStates(current, previous);
    const flags = activeStateAgreementFlags(provider, current.get('np') ?? [], rules, [], [], today, [authority], added.get('np'));
    expect(flags.map(f => [f.state, f.newlyActive])).toEqual([['PA', true]]);
    expect(activeStateAgreementFlags(provider, ['NY'], rules, [], [], today, [authority])).toEqual([]);
  });
  it('ignores licensed-only states and does not label the initial snapshot as a change', () => {
    expect(activeStateAgreementFlags(provider, [], rules, [], [], today, [authority])).toEqual([]);
    expect(addedActiveEhrStates(new Map([['np', ['NY']]])).size).toBe(0);
  });
});