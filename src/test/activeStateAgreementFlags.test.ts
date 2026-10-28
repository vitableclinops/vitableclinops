import { describe, expect, it } from 'vitest';
import { activeStateAgreementFlags, type StateAgreement } from '@/lib/activeStateAgreementFlags';
const provider = { id: 'jonathan', profession: 'NP' };
const today = new Date(2026, 9, 28);
const check = (states: string[], agreements: StateAgreement[] = []) => activeStateAgreementFlags(provider, states, [], agreements, [], today);
describe('active EHR state agreement checks', () => {
  it('flags required PA but not Ohio when Ohio is not active in EHR', () => {
    expect(check(['PA', 'AZ']).map(r => r.state)).toEqual(['PA']);
  });
  it('requires attached evidence for an active agreement', () => {
    expect(check(['PA'], [{ profileId: 'jonathan', state: 'PA', status: 'active', document: null }])[0].reason).toBe('Active agreement has no attached document.');
  });
  it('clears only the state with an active identity-linked documented agreement', () => {
    expect(check(['PA', 'OH'], [{ profileId: 'jonathan', state: 'PA', status: 'active', document: 'signed.pdf' }]).map(r => r.state)).toEqual(['OH']);
  });
  it('does not count another provider or terminated or expired agreements', () => {
    expect(check(['PA'], [
      { profileId: 'other', state: 'PA', status: 'active', document: 'signed.pdf' },
      { profileId: 'jonathan', state: 'PA', status: 'terminated', document: 'signed.pdf' },
      { profileId: 'jonathan', state: 'PA', status: 'active', document: 'signed.pdf', end: '2026-10-27' },
    ])[0].reason).toBe('Missing active linked collaborative agreement.');
  });
  it('uses saved requirements over defaults', () => {
    expect(activeStateAgreementFlags(provider, ['PA'], [{ state_abbreviation: 'PA', ca_required: false, collab_requirement_type: 'never' }], [], [], today)).toEqual([]);
  });
  it('asks for verification rather than declaring conditional states missing', () => {
    expect(check(['CO'])[0].reason).toBe('Collaboration requirement needs provider-specific verification.');
  });
  it('does not impose NP agreements on physicians', () => {
    expect(activeStateAgreementFlags({ id: 'md', profession: 'physician' }, ['PA'], [], [], [], today)).toEqual([]);
  });
});