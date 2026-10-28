import { describe, expect, it } from 'vitest';
import { directoryIdentityAlert } from '@/lib/directoryIdentityAlerts';
import { pcpCellFor } from '@/lib/pcpCoverage';

describe('Directory identity alerts', () => {
  it('flags a missing NPI with its actual reason and verified-NPI correction', () => {
    const cell = pcpCellFor({ id: 'new-provider', profession: 'NP', npi_number: null }, { identities: [] });
    const alert = directoryIdentityAlert(cell);
    expect(alert?.reason).toBe('No NPI on this record, so it cannot be linked to the EHR');
    expect(alert?.howToFix).toContain('verified 10-digit NPI');
  });
  it('does not create identity flags for unavailable snapshots or out-of-scope professions', () => {
    const profile = { id: 'provider', profession: 'physician', npi_number: null };
    expect(directoryIdentityAlert(pcpCellFor(profile, undefined))).toBeUndefined();
    expect(directoryIdentityAlert(pcpCellFor(profile, { identities: [] }))).toBeUndefined();
  });
  it('clears only the missing-NPI flag for an admin no-NPI exception', () => {
    const profile = { id: 'reviewed', profession: 'NP', npi_number: null, admin_no_npi: true };
    expect(pcpCellFor(profile, { identities: [] })).toMatchObject({ kind: 'not_applicable', text: 'Admin: no NPI', states: [] });
    expect(directoryIdentityAlert(pcpCellFor(profile, { identities: [] }))).toBeUndefined();
    const data = { identities: [{ ehrProviderId: 'duplicate', ehrName: 'Provider', npi: '1234567890', states: [], status: 'ambiguous' as const, profileId: 'reviewed', nameDiffers: false, reason: 'Several EHR IDs share this directory record' }] };
    expect(pcpCellFor(profile, data).kind).toBe('needs_review');
  });
});