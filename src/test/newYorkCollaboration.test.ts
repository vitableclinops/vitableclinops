import { describe, expect, it } from 'vitest';
import { getCollabRequirementType, COLLAB_ALWAYS_STATES } from '@/constants/stateRestrictions';
import { newProviderCollabStates } from '@/lib/newProviderCollab';

describe('New York conditional collaboration requirement', () => {
  it('does not require collaboration for every New York provider regardless of prescriptive authority', () => {
    expect(getCollabRequirementType('NY')).toBe('conditional');
    expect(COLLAB_ALWAYS_STATES).not.toContain('NY');
    expect(newProviderCollabStates('nurse_practitioner', ['NY'], [
      { state_abbreviation: 'NY', ca_required: false, collab_requirement_type: 'conditional' },
    ])).toEqual([]);
  });
});