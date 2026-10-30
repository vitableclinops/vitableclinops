import { describe, expect, it } from 'vitest';
import { activeStateAgreementFlags, type StateAgreement } from '@/lib/activeStateAgreementFlags';
const provider = { id: 'jonathan', profession: 'NP' };
const today = new Date(2026, 9, 28);
const rules = ['PA', 'OH'].map(state_abbreviation => ({ state_abbreviation, ca_required: true, collab_requirement_type: 'always' }));
const check = (states: string[], agreements: StateAgreement[] = []) => activeStateAgreementFlags(provider, states, rules, agreements, [], today);
describe('active EHR state agreement checks', () => {
  it('clears Moensania AR when a refreshed EHR state list deactivates AR without changing her agreement', () => {
    const moensania = { id: 'fd1f3e33-9057-45f6-8950-3004bdcdbd27', profession: 'NP' };
    const arRules = [{ state_abbreviation: 'AR', ca_required: true, collab_requirement_type: 'always' }];
    const agreements = [{ profileId: moensania.id, state: 'AR', status: 'active', document: null }];
    const audit = (states: string[]) => activeStateAgreementFlags(moensania, states, arRules, agreements, [], today);
    expect(audit(['AR', 'PA']).map(flag => flag.state)).toEqual(['AR']);
    expect(audit(['PA'])).toEqual([]);
    expect(agreements[0].status).toBe('active');
  });
  it('adds the missing requirement when a future EHR refresh activates AR', () => {
    const arRules = [{ state_abbreviation: 'AR', ca_required: true, collab_requirement_type: 'always' }];
    expect(activeStateAgreementFlags(provider, [], arRules, [], [], today)).toEqual([]);
    expect(activeStateAgreementFlags(provider, ['AR'], arRules, [], [], today, [], ['AR']))
      .toEqual([expect.objectContaining({ state: 'AR', newlyActive: true })]);
  });
  it('requires updated evidence on activation when the linked AR agreement has expired', () => {
    const arRules = [{ state_abbreviation: 'AR', ca_required: true, collab_requirement_type: 'always' }];
    const expired = [{ profileId: provider.id, state: 'AR', status: 'active', document: 'signed.pdf', end: '2026-10-27' }];
    expect(activeStateAgreementFlags(provider, [], arRules, expired, [], today)).toEqual([]);
    expect(activeStateAgreementFlags(provider, ['AR'], arRules, expired, [], today).map(flag => flag.state)).toEqual(['AR']);
  });
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
  it('does not flag CT or other states saved as not requiring agreements', () => {
    expect(activeStateAgreementFlags(provider, ['CT', 'CO', 'FL', 'MN', 'VT'],
      ['CT', 'CO', 'FL', 'MN', 'VT'].map(state_abbreviation => ({ state_abbreviation, ca_required: false, collab_requirement_type: 'conditional' })), [], [], today)).toEqual([]);
  });
  it('does not infer a requirement from defaults when a saved rule is absent', () => {
    expect(activeStateAgreementFlags(provider, ['PA', 'OH'], [], [], [], today)).toEqual([]);
  });
  it('flags a conditional state only when the directory explicitly requires an agreement', () => {
    expect(activeStateAgreementFlags(provider, ['AR'], [{ state_abbreviation: 'AR', ca_required: true, collab_requirement_type: 'conditional' }], [], [], today).map(r => r.state)).toEqual(['AR']);
  });
  it('does not impose NP agreements on physicians', () => {
    expect(activeStateAgreementFlags({ id: 'md', profession: 'physician' }, ['PA'], rules, [], [], today)).toEqual([]);
  });
  it.each(['MD', 'DO'])('%s needs no own agreement or document in required states', profession => {
    expect(activeStateAgreementFlags({ id: 'doctor', profession }, ['PA', 'OH'], rules, [], [], today)).toEqual([]);
    expect(activeStateAgreementFlags({ id: 'doctor', profession }, ['PA'], rules,
      [{ profileId: 'doctor', state: 'PA', status: 'active', document: null }], [], today)).toEqual([]);
  });
});
import { isDocumentExemptPhysician } from '@/lib/directShiftsPhysicians';
describe('DirectShifts physician exemption', () => {
  it('recognizes Anika Ramos and Dave Webster only', () => {
    expect(isDocumentExemptPhysician('Dr. Anika Ramos (Direct Shifts)')).toBe(true);
    expect(isDocumentExemptPhysician('Dave Webster')).toBe(true);
    expect(isDocumentExemptPhysician('Kate Baron')).toBe(false);
  });
});
