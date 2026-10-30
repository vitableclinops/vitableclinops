import { describe, it, expect } from 'vitest';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
const np = { id: 'p1', profession: 'NP' };
const rules = [{ state_abbreviation: 'VA', collab_requirement_type: 'conditional', ca_required: false }];
const agr = [{ profileId: 'p1', state: 'VA', status: 'active', document: 'https://doc' }];
const d = (decision: string) => [{ profile_id: 'p1', state_abbreviation: 'VA', decision, verified_source: 'Board', verified_on: '2026-10-01' }];
describe('VA rule', () => {
  it('flags with nothing on file', () => expect(activeStateAgreementFlags(np, ['VA'], rules, [], [])).toHaveLength(1));
  it('agreement alone is not enough', () => expect(activeStateAgreementFlags(np, ['VA'], rules, agr, [])).toHaveLength(1));
  it('agreement + Rx authority clears', () => expect(activeStateAgreementFlags(np, ['VA'], rules, agr, d('rx_authority_verified'))).toHaveLength(0));
  it('Rx authority alone without agreement is not enough', () => expect(activeStateAgreementFlags(np, ['VA'], rules, [], d('rx_authority_verified'))).toHaveLength(1));
  it('Rx + autonomous clears without agreement', () => expect(activeStateAgreementFlags(np, ['VA'], rules, [], d('independent_verified'))).toHaveLength(0));
});
