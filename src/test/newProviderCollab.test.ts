import { describe, expect, it } from 'vitest';
import { hasAgreementDocument, newProviderCollabStates } from '@/lib/newProviderCollab';

describe('new provider agreement uploads', () => {
  it('prompts for every selected collaboration-required state', () => {
    expect(newProviderCollabStates('nurse_practitioner', ['CA', 'TX', 'AK'], [])).toEqual(['CA', 'TX']);
  });
  it('uses current saved requirements instead of outdated defaults', () => {
    expect(newProviderCollabStates('nurse_practitioner', ['CA', 'FL'], [
      { state_abbreviation: 'CA', collab_requirement_type: 'never', ca_required: false },
      { state_abbreviation: 'FL', collab_requirement_type: 'always', ca_required: true },
    ])).toEqual(['FL']);
  });
  it('does not impose NP collaboration on physicians', () => {
    expect(newProviderCollabStates('physician', ['CA', 'TX'], [])).toEqual([]);
  });
  it('never allows prohibited NP states', () => {
    expect(newProviderCollabStates('nurse_practitioner', ['AL', 'GA', 'IN', 'MO', 'MS', 'SC', 'TN', 'LA'], [])).toEqual([]);
  });
  it('requires an uploaded agreement or a web link', () => {
    expect(hasAgreementDocument(null, '')).toBe(false);
    expect(hasAgreementDocument(null, 'javascript:alert(1)')).toBe(false);
    expect(hasAgreementDocument(null, 'https://example.com/signed.pdf')).toBe(true);
    expect(hasAgreementDocument(new File(['signed'], 'agreement.pdf'))).toBe(true);
  });
});