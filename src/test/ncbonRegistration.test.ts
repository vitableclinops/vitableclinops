import { describe, it, expect } from 'vitest';
import { activeStateAgreementFlags, type StateAgreement } from '@/lib/activeStateAgreementFlags';
import { hasVerifiedNcbonRegistration, type CollabDecision } from '@/lib/nyIndependentPractice';

const np = { id: 'nc-np', profession: 'NP' };
const rules = [{ state_abbreviation: 'NC', ca_required: true, collab_requirement_type: 'always' }];
const agreement: StateAgreement = { profileId: np.id, state: 'NC', status: 'active', document: 'https://example.org/signed.pdf' };
const proof: CollabDecision = { profile_id: np.id, state_abbreviation: 'NC', decision: 'ncbon_registered', verified_source: 'NCBON portal approval', verified_on: '2026-11-03', verified_attachment_path: 'independent-verification/nc-np/approval.png' };
const audit = (agreements = [agreement], decisions = [proof], states = ['NC']) => activeStateAgreementFlags(np, states, rules, agreements, decisions);

describe('NC signed Collab Agreement AND NCBON registration', () => {
  it('flags missing NCBON registration even with signed agreement', () => expect(audit([agreement], [])[0]?.registrationReview).toBe(true));
  it('still requires a signed agreement after registration', () => expect(audit([])).toHaveLength(1));
  it('clears only when both requirements are saved', () => expect(audit()).toEqual([]));
  it('requires a source', () => expect(hasVerifiedNcbonRegistration(np.id, [{ ...proof, verified_source: '' }])).toBe(false));
  it('requires a date', () => expect(hasVerifiedNcbonRegistration(np.id, [{ ...proof, verified_on: '' }])).toBe(false));
  it('requires clickable proof', () => expect(audit([agreement], [{ ...proof, verified_attachment_path: null }])).toHaveLength(1));
  it('accepts a verification link instead of a file', () => expect(audit([agreement], [{ ...proof, verified_attachment_path: null, verified_link: 'https://portal.ncbon.com/approval' }])).toEqual([]));
  it('rejects unsafe verification links', () => expect(audit([agreement], [{ ...proof, verified_attachment_path: null, verified_link: 'javascript:alert(1)' }])).toHaveLength(1));
  it('does not accept independent practice in place of registration', () => expect(audit([agreement], [{ ...proof, decision: 'independent_verified' }])).toHaveLength(1));
  it('does not borrow another provider registration', () => expect(audit([agreement], [{ ...proof, profile_id: 'other' }])).toHaveLength(1));
  it('DirectShifts exempts agreement documents, not registration', () => {
    const ds = [{ ...agreement, document: null, documentExempt: true }];
    expect(audit(ds, [])).toHaveLength(1);
    expect(audit(ds)).toEqual([]);
  });
  it('clears after deactivation and flags future activation', () => {
    expect(audit([], [], [])).toEqual([]);
    expect(audit([], [], ['NC'])).toHaveLength(1);
  });
  it('retains physician independent practice exemption', () => expect(activeStateAgreementFlags({ id: 'md', profession: 'MD' }, ['NC'], rules, [], [])).toEqual([]));
  it('reflags when the agreement expires', () => expect(audit([{ ...agreement, end: '2020-01-01' }])).toHaveLength(1));
});