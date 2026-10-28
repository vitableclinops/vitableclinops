import { describe, expect, it } from 'vitest';
import { directoryMedallionConflicts } from '@/lib/directoryMedallionConflicts';

describe('Directory employment equivalence', () => {
  const id = 'any-provider';
  const classification = { field: 'employment_type', local: '1099', medallion: 'prn' };
  it.each([
    ['1099', 'contractor'], ['1099', 'PRN'], ['contractor', '1099'],
    ['PRN', '1099'], ['contractor', 'PRN'], ['PRN', 'contractor'],
    [' 1099 ', ' Contractor '],
  ])('does not flag equivalent employment values %s and %s for any provider', (local, medallion) => {
    expect(directoryMedallionConflicts(id, [{ ...classification, local, medallion }])).toEqual([]);
  });
  it('preserves identity, status, W2, agency, and missing-value warnings', () => {
    const conflicts = [
      { field: 'full_name', local: 'Amanda', medallion: 'Someone else' },
      { field: 'employment_status', local: '1099', medallion: 'prn' },
      { ...classification, medallion: 'w2' },
      { ...classification, medallion: 'agency' },
      { ...classification, medallion: null },
    ];
    expect(directoryMedallionConflicts(id, conflicts)).toEqual(conflicts);
  });
});