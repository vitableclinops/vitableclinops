import { describe, expect, it } from 'vitest';
import { directoryCollaborationIds, directoryCollaborationCounts } from '@/lib/directoryCollaboration';

describe('directory collaboration participation', () => {
  it('counts the same local agreement only once across direct and participant links', () => {
    const counts = directoryCollaborationCounts([{ id: 'a', provider_id: 'np', physician_id: 'kate', workflow_status: 'active', terminated_at: null }], [{ agreement_id: 'a', provider_id: 'np', is_active: true }], [{ profile_id: 'np', supervisor_profile_id: 'kate', source_status: 'active', local_agreement_id: 'a' }]);
    expect(counts.get('np')).toBe(1);
    expect(counts.get('kate')).toBe(1);
  });
  it('includes Kate as physician on an active local agreement', () => {
    const ids = directoryCollaborationIds([{ id: 'a', provider_id: 'np', physician_id: 'kate', workflow_status: 'active', terminated_at: null }], [], []);
    expect(ids.has('kate')).toBe(true);
  });
  it('includes Moensania from her active linked Medallion agreement', () => {
    const ids = directoryCollaborationIds([], [], [{ profile_id: 'moensania', supervisor_profile_id: 'kate', source_status: 'active', local_agreement_id: null }]);
    expect(ids.has('moensania')).toBe(true);
  });
  it('includes active linked multi-provider participants', () => {
    const ids = directoryCollaborationIds([{ id: 'a', provider_id: null, physician_id: 'md', workflow_status: 'active', terminated_at: null }], [{ agreement_id: 'a', provider_id: 'np', is_active: true }], []);
    expect(ids.has('np')).toBe(true);
  });
  it('does not reactivate locally terminated agreements using source data', () => {
    const ids = directoryCollaborationIds([{ id: 'a', provider_id: 'np', physician_id: 'md', workflow_status: 'terminated', terminated_at: '2026-10-28' }], [], [{ profile_id: 'np', supervisor_profile_id: 'md', source_status: 'active', local_agreement_id: 'a' }]);
    expect([...ids]).toEqual([]);
  });
  it('does not count cancelled agreements or unlinked source names', () => {
    expect([...directoryCollaborationIds([], [], [{ profile_id: 'np', supervisor_profile_id: null, source_status: 'cancelled', local_agreement_id: null }, { profile_id: null, supervisor_profile_id: null, source_status: 'active', local_agreement_id: null }])]).toEqual([]);
  });
});