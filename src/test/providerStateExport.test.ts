import { describe, expect, it } from 'vitest';
import { providerStateExportRows, providerStateStatusRows, type ProviderStateExportEvidence } from '@/lib/providerStateExport';

const day = new Date(2026, 10, 9);
const provider = { id: 'np', full_name: 'Example Provider', profession: 'NP' };
const empty: ProviderStateExportEvidence = { agreements: [], rules: [], decisions: [], authorityEvidence: [], requirementProofs: [], sheetLicenses: [] };
const proof = (state: string, key: string) => ({ profile_id: 'np', state_abbreviation: state, requirement_key: key,
  verified_source: 'State board', verified_on: '2026-11-08', verified_link: 'https://example.org/proof' });

describe('Provider Licenses export', () => {
  it('exports both EHR groups once and alphabetically', () => {
    const rows = providerStateExportRows(provider, ['PA', 'AR', 'PA'], ['PA', 'NC'], true, empty, day);
    expect(rows.map(r => [r.State, r['EHR status']])).toEqual([
      ['AR', 'Licensed but not active in EHR'], ['NC', 'Active states in EHR'], ['PA', 'Active states in EHR'],
    ]);
  });
  it('exports Arkansas agreement and Rx proof but not unsaved board registration', () => {
    const rows = providerStateExportRows(provider, ['AR'], ['AR'], true, { ...empty,
      agreements: [{ profileId: 'np', state: 'AR', status: 'active', document: 'https://example.org/agreement' }],
      requirementProofs: [proof('AR', 'rx_authority')],
    }, day);
    expect(rows[0]['Requirements fulfilled']).toBe('Signed Collab Agreement; Prescriptive authority');
    expect(rows[0]['Outstanding requirements']).toContain('Collab Agreement registered with state board');
  });
  it('does not count expired or another provider’s proof', () => {
    const rows = providerStateExportRows(provider, ['AR'], [], true, { ...empty,
      requirementProofs: [{ ...proof('AR', 'rx_authority'), expiration_date: '2026-11-08' }, { ...proof('AR', 'board_registration'), profile_id: 'other' }],
    }, day);
    expect(rows[0]['Requirements fulfilled']).toBe('No fulfilled requirements confirmed on record');
  });
  it('keeps unresolved coverage explicit rather than calling licensed states inactive', () => {
    expect(providerStateExportRows(provider, ['AK'], [], false, empty, day)[0]['EHR status']).toBe('EHR status unavailable');
  });
  it('exports PA file-verified Rx authority and PALS separately', () => {
    const rows = providerStateExportRows(provider, ['PA'], ['PA'], true, { ...empty,
      decisions: [{ profile_id: 'np', state_abbreviation: 'PA', decision: 'rx_authority_verified', verified_source: 'Board', verified_on: '2026-11-08', verified_attachment_path: 'pa.png' }],
      requirementProofs: [proof('PA', 'pals_collab_registration')],
    }, day);
    expect(rows[0]['Requirements fulfilled']).toBe('PALS portal collab confirmed/registration; Prescriptive authority');
  });
  it('does not export NP requirements for physicians', () => {
    const rows = providerStateExportRows({ ...provider, profession: 'DO' }, ['AR'], ['AR'], true, empty, day);
    expect(rows[0]['State requirements']).toContain('NP requirements not applicable');
    expect(rows[0]['Outstanding requirements']).toBe('License status unconfirmed');
  });
});

describe('Provider state status export', () => {
  it('marks states with a current agreement Collaborative Agreement and all others Independent', () => {
    const rows = providerStateStatusRows(provider, ['PA', 'AR', 'NC'], [
      { profileId: 'np', state: 'AR', status: 'active', document: 'https://example.org/agreement' },
      { profileId: 'np', state: 'PA', status: 'terminated', document: 'https://example.org/old' },
      { profileId: 'other', state: 'NC', status: 'active', document: '' },
    ], day);
    expect(rows).toEqual([
      { State: 'AR', Status: 'Collaborative Agreement' },
      { State: 'NC', Status: 'Independent' },
      { State: 'PA', Status: 'Independent' },
    ]);
  });
  it('ignores agreements outside their dates', () => {
    const rows = providerStateStatusRows(provider, ['AR'], [
      { profileId: 'np', state: 'AR', status: 'active', start: '2027-01-01', document: '' },
    ], day);
    expect(rows).toEqual([{ State: 'AR', Status: 'Independent' }]);
  });
  it('marks NP-prohibited states MD/DO Only for NPs but not for physicians', () => {
    expect(providerStateStatusRows(provider, ['AL', 'GA', 'AR'], [], day)).toEqual([
      { State: 'AL', Status: 'MD/DO Only' },
      { State: 'AR', Status: 'Independent' },
      { State: 'GA', Status: 'MD/DO Only' },
    ]);
    expect(providerStateStatusRows({ ...provider, profession: 'DO' }, ['AL'], [], day))
      .toEqual([{ State: 'AL', Status: 'Independent' }]);
  });
});