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
});