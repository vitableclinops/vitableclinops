import { describe, expect, it } from 'vitest';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
import { hasVerifiedIndependentPractice } from '@/lib/nyIndependentPractice';

const provider = { id: 'np', profession: 'NP' };
const rules = [{ state_abbreviation: 'WV', ca_required: false, collab_requirement_type: 'conditional' }];
const today = new Date(2026, 9, 30);
const decision = { profile_id: 'np', state_abbreviation: 'WV', decision: 'independent_verified', verified_source: 'WV Board confirmation', verified_on: '2026-10-29' };

describe('West Virginia agreement or confirmed independence', () => {
  it('flags an EHR-active WV NP with both correction alternatives when evidence is missing', () => {
    expect(activeStateAgreementFlags(provider, ['WV'], rules, [], [], today).map(f => [f.state, f.independentAlternative])).toEqual([['WV', true]]);
  });
  it('accepts a documented active WV agreement', () => {
    expect(activeStateAgreementFlags(provider, ['WV'], rules, [{ profileId: 'np', state: 'WV', status: 'active', document: 'signed.pdf' }], [], today)).toEqual([]);
  });
  it('accepts confirmed WV independence with source and date for flags and finalization', () => {
    expect(hasVerifiedIndependentPractice('np', 'WV', [decision])).toBe(true);
    expect(activeStateAgreementFlags(provider, ['WV'], rules, [], [decision], today)).toEqual([]);
  });
  it.each([{ verified_source: '' }, { verified_on: null }])('requires both source and date: %j', missing => {
    expect(hasVerifiedIndependentPractice('np', 'WV', [{ ...decision, ...missing }])).toBe(false);
    expect(activeStateAgreementFlags(provider, ['WV'], rules, [], [{ ...decision, ...missing }], today)).toHaveLength(1);
  });
  it('never flags WV when it is not active in the EHR', () => {
    expect(activeStateAgreementFlags(provider, [], rules, [], [], today)).toEqual([]);
  });
  it('does not borrow another provider or state verification', () => {
    expect(hasVerifiedIndependentPractice('np', 'WV', [{ ...decision, profile_id: 'other' }, { ...decision, state_abbreviation: 'NY' }])).toBe(false);
  });
});