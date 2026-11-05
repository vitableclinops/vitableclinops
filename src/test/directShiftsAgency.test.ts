import { describe, it, expect } from 'vitest';
import { activeStateAgreementFlags } from '@/lib/activeStateAgreementFlags';
import { DIRECTSHIFTS_AGENCY_ID } from '@/lib/directShiftsAgency';

describe('DirectShifts agency providers', () => {
  const rules = [{ state_abbreviation: 'PA', collab_requirement_type: 'always', ca_required: true }];
  it('are never flagged for state requirements', () => {
    expect(activeStateAgreementFlags({ id: 'j', profession: 'nurse_practitioner', agency_id: DIRECTSHIFTS_AGENCY_ID }, ['PA', 'AK'], rules, [], [])).toEqual([]);
  });
  it('other NPs are still flagged', () => {
    expect(activeStateAgreementFlags({ id: 'k', profession: 'nurse_practitioner', agency_id: null }, ['PA'], rules, [], []).length).toBeGreaterThan(0);
  });
});
