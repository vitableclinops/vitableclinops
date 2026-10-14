import { describe, it, expect } from 'vitest';
import { matchEhrCoverage, isSnapshotStale } from '@/lib/pcpCoverage';

const profiles = [
  { id: 'p-akosua', full_name: 'Akosua Norgbey', npi_number: '1831574011' },
  { id: 'p-antonia', full_name: 'Antonia Jackson', npi_number: '1356763593' },
  { id: 'p-lastasha', full_name: 'LaStasha Jackson', npi_number: '1356911325' },
  { id: 'p-anabel', full_name: 'Anabel Gomez', npi_number: '1538695283' },
  { id: 'p-dup1', full_name: 'Dup One', npi_number: '1111111111' },
  { id: 'p-dup2', full_name: 'Dup Two', npi_number: '1111111111' },
  { id: 'a3917d41-d677-4110-bf05-d7115879ef53', full_name: 'Matthew Vazquez', npi_number: '1222222222' },
];

const row = (provider_id: string, provider_full_name: string, npi: string | null, state: string) =>
  ({ provider_id, provider_full_name, npi, state });

describe('Active PCP Telemedicine States identity matching', () => {
  it('links coverage by NPI, not by name', () => {
    const { statesByProfile } = matchEhrCoverage([
      row('e1', 'Akosua Norgbey', '1831574011', 'PA'),
      row('e1', 'Akosua Norgbey', '1831574011', 'NJ'),
    ], profiles);
    expect(statesByProfile.get('p-akosua')).toEqual(['NJ', 'PA']);
  });

  it('never links by name alone: same name, no NPI match → unmatched', () => {
    const { identities, statesByProfile } = matchEhrCoverage([row('e2', 'Akosua Norgbey', '9999999999', 'TX')], profiles);
    expect(identities[0].status).toBe('unmatched');
    expect(statesByProfile.size).toBe(0);
  });

  it('matches by NPI even when the name differs, and flags the difference', () => {
    const { identities } = matchEhrCoverage([row('e3', 'Anabel Garcia', '1538695283', 'TX')], profiles);
    expect(identities[0]).toMatchObject({ status: 'matched', profileId: 'p-anabel', nameDiffers: true });
  });

  it('flags an NPI shared by two directory records as ambiguous', () => {
    const { identities } = matchEhrCoverage([row('e4', 'Dup', '1111111111', 'OH')], profiles);
    expect(identities[0].status).toBe('ambiguous');
  });

  it('flags two EHR IDs claiming one profile as ambiguous', () => {
    const { identities } = matchEhrCoverage([
      row('e5', 'Akosua Norgbey', '1831574011', 'PA'),
      row('e6', 'Akosua N', '1831574011', 'NJ'),
    ], profiles);
    expect(identities.every((i) => i.status === 'ambiguous')).toBe(true);
  });

  it('flags missing NPI as unmatched', () => {
    expect(matchEhrCoverage([row('e7', 'X', null, 'PA')], profiles).identities[0].status).toBe('unmatched');
  });

  it('uses the Medallion NPI linked to a profile', () => {
    const { statesByProfile } = matchEhrCoverage(
      [row('e8', 'Brittney Afram', '1750990875', 'FL')],
      [{ id: 'p-brittney', full_name: 'Brittney Afram', npi_number: null }],
      [{ profile_id: 'p-brittney', npi: '1750990875' }],
    );
    expect(statesByProfile.get('p-brittney')).toEqual(['FL']);
  });
});

describe('PCP coverage exclusions tied to verified identities', () => {
  it('excludes the four former employees by EHR ID + NPI', () => {
    const { identities, statesByProfile } = matchEhrCoverage([
      row('d5027156-3519-4620-97c2-c781743f9e5b', 'Heidi Hershberger', '1962936542', 'PA'),
      row('d4754d85-1b68-4ebd-b05f-3601cc93312e', 'Emily Van-Otoo', '1649662925', 'PA'),
      row('4b4b4d58-01d5-4548-a3c8-096052584127', 'Crystal Oramadike', '1063965978', 'PA'),
      row('8fa1e0f2-5227-4c3a-a5cd-ed9809dbe86a', 'Lastasha Jackson', '1356911325', 'PA'),
    ], profiles);
    expect(identities.map((i) => i.status)).toEqual(['excluded', 'excluded', 'excluded', 'excluded']);
    expect(statesByProfile.has('p-lastasha')).toBe(false);
  });

  it('flags an excluded EHR ID with a different NPI instead of guessing', () => {
    const { identities } = matchEhrCoverage([row('8fa1e0f2-5227-4c3a-a5cd-ed9809dbe86a', 'Lastasha Jackson', '1000000000', 'PA')], profiles);
    expect(identities[0].status).toBe('ambiguous');
  });

  it('does not exclude Antonia Jackson', () => {
    const { statesByProfile } = matchEhrCoverage([row('18c75841', 'Antonia Jackson', '1356763593', 'NJ')], profiles);
    expect(statesByProfile.get('p-antonia')).toEqual(['NJ']);
  });

  it('keeps Matthew Vazquez out of scope by verified profile, without assigning states', () => {
    const { identities, statesByProfile } = matchEhrCoverage([row('e9', 'Matthew Vazquez', '1222222222', 'PA')], profiles);
    expect(identities[0].status).toBe('excluded');
    expect(statesByProfile.size).toBe(0);
  });
});

describe('Snapshot staleness', () => {
  const now = new Date('2026-10-14T19:00:00Z');
  it('labels the June 10 snapshot stale', () => {
    expect(isSnapshotStale('2026-06-10T11:00:30Z', now)).toBe(true);
  });
  it('treats a same-day fetch as fresh', () => {
    expect(isSnapshotStale('2026-10-14T18:53:00Z', now)).toBe(false);
  });
  it('treats a missing fetch as stale', () => {
    expect(isSnapshotStale(null, now)).toBe(true);
  });
});
