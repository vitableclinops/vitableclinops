import { describe, it, expect } from 'vitest';
import { physicianSlots, type SlotAgreement, type SlotPerson } from '@/lib/physicianSlots';

const people: SlotPerson[] = [{ id: 'np1', full_name: 'Kelsie', profession: 'NP', credentials: null, employment_status: 'active' },
  { id: 'np2', full_name: 'Former', profession: 'NP', credentials: null, employment_status: 'terminated' },
  { id: 'rn', full_name: 'Nurse', profession: 'RN', credentials: null, employment_status: 'active' }];
const rules = [{ state_abbreviation: 'OH', np_md_ratio: '5', np_md_ratio_limit: 3 }, { state_abbreviation: 'CT', np_md_ratio: 'None', np_md_ratio_limit: null }];
const agreement: SlotAgreement = { physicianKey: 'patel', physicianName: 'Dr. Patel', state: 'OH', providerIds: ['np1'], status: 'active' };

describe('physician slots', () => {
  it('shows Dr. Patel Ohio as 1/5 from State Requirements and exposes the conflicting verification limit', () => {
    expect(physicianSlots([agreement], people, rules)[0]).toMatchObject({ filled: 1, limit: 5, verificationLimit: 3 });
  });
  it('counts one NP once across duplicate agreements and direct/participant links', () => {
    expect(physicianSlots([agreement, { ...agreement, providerIds: ['np1', 'np1'] }], people, rules)[0].filled).toBe(1);
  });
  it('excludes offboarded providers and non-NPs', () => {
    expect(physicianSlots([{ ...agreement, providerIds: ['np1', 'np2', 'rn'] }], people, rules)[0].filled).toBe(1);
  });
  it.each(['terminated', 'draft', 'cancelled', 'pending_signatures', 'archived'])('does not count %s agreements', status => {
    expect(physicianSlots([{ ...agreement, status }], people, rules)).toHaveLength(0);
  });
  it('omits states with no saved numeric limit', () => {
    expect(physicianSlots([{ ...agreement, state: 'CT' }], people, rules)).toHaveLength(0);
  });
  it('keeps each physician and state separate', () => {
    expect(physicianSlots([agreement, { ...agreement, physicianKey: 'other' }], people, rules)).toHaveLength(2);
  });
  it('excludes ended and future agreements', () => {
    expect(physicianSlots([{ ...agreement, end: '2026-10-28' }, { ...agreement, start: '2026-10-30' }], people, rules, new Date(2026, 9, 29))).toHaveLength(0);
  });
});