import { describe, expect, it } from 'vitest';
import { meetingStateGroups, selectedMeetingStates, selectMeetingProviders } from '../lib/collabMeetingStates';

describe('manually selected meeting states', () => {
  it('shows only saved selected states and their leading MD', () => {
    expect(meetingStateGroups('States: CA', [
      { state: 'CA', physician: 'CA MD', chartUrl: 'https://example.com/ca' },
      { state: 'TX', physician: 'TX MD', chartUrl: 'https://example.com/tx' },
    ])).toEqual([['CA MD', { states: ['CA'], chartUrl: 'https://example.com/ca' }]]);
  });
  it('does not infer states for old events without saved selections', () => {
    expect(selectedMeetingStates(null)).toEqual([]);
    expect(meetingStateGroups(null, [{ state: 'CA', physician: 'CA MD', chartUrl: null }]))
      .toEqual([['States not selected', { states: [], chartUrl: null }]]);
  });
  it('keeps selected states even without a current agreement', () => {
    expect(meetingStateGroups('States: WV', [])).toEqual([['Unassigned MD', { states: ['WV'], chartUrl: null }]]);
  });
  it('starts with no providers rather than inferring due meetings', () => {
    expect(selectMeetingProviders([])).toEqual({});
  });
  it('bulk selection includes only explicitly filtered states', () => {
    expect(selectMeetingProviders([{ email: 'provider', states: ['CA', 'TX'] }], new Set(['CA'])))
      .toEqual({ provider: ['CA'] });
  });
});