import { describe, it, expect } from 'vitest';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
import { hasVerifiedRxAuthority, hasVerificationLink } from '@/lib/nyIndependentPractice';

const np = { id: 'pa-provider', profession: 'NP' };
const rules = [{ state_abbreviation: 'PA', collab_requirement_type: 'always', ca_required: true }];
const agreements = [{ profileId: np.id, state: 'PA', status: 'active', document: 'https://example.org/agreement.pdf' }];
const verification = { profile_id: np.id, state_abbreviation: 'PA', decision: 'rx_authority_verified', verified_source: 'State board', verified_on: '2026-10-30', verified_link: 'https://example.org/license' };
const audit = (agreementsOnFile = agreements, decisions = [verification], states = ['PA']) => activeStateAgreementFlags(np, states, rules, agreementsOnFile, decisions);

describe('PA Collab Agreement plus Rx Authority designation', () => {
  it('requires Rx verification even when the agreement is saved', () => expect(audit(agreements, [])).toHaveLength(1));
  it('requires a Collab Agreement even when Rx Authority is verified', () => expect(audit([])).toHaveLength(1));
  it('clears only with both agreement and linked Rx designation verification', () => expect(audit()).toHaveLength(0));
  it('requires a verification link, not just source/date or an attachment', () => expect(audit(agreements, [{ ...verification, verified_link: '', verified_attachment_path: 'proof.png' }])).toHaveLength(1));
  it('does not accept independent status as the PA alternative', () => expect(audit([], [{ ...verification, decision: 'independent_verified' }])).toHaveLength(1));
  it('requires source and date along with the verification link', () => {
    expect(hasVerifiedRxAuthority(np.id, 'PA', [{ ...verification, verified_source: '' }])).toBe(false);
    expect(hasVerifiedRxAuthority(np.id, 'PA', [{ ...verification, verified_on: '' }])).toBe(false);
  });
  it('keeps DirectShifts agreement-document exemption but still needs Rx proof', () => {
    const ds = [{ ...agreements[0], document: '', documentExempt: true }];
    expect(audit(ds, [])).toHaveLength(1);
    expect(audit(ds)).toHaveLength(0);
  });
  it('clears on PA deactivation and prompts on activation', () => {
    expect(audit([], [], [])).toHaveLength(0);
    expect(audit([], [], ['PA'])).toHaveLength(1);
  });
  it('rejects unsafe or malformed proof links', () => {
    expect(hasVerificationLink('javascript:alert(1)')).toBe(false);
    expect(hasVerificationLink('not a link')).toBe(false);
    expect(hasVerificationLink('https://example.org/proof')).toBe(true);
  });
});