import { describe, expect, it } from 'vitest';
import { directoryMedallionConflicts } from '@/lib/directoryMedallionConflicts';

describe('Directory employment-type alert exclusion', () => {
  const id = 'any-provider';
  const classification = { field: 'employment_type', local: '1099', medallion: 'prn' };
  it.each([
    ['1099', 'contractor'], ['1099', 'PRN'], ['contractor', '1099'],
    ['PRN', '1099'], ['contractor', 'PRN'], ['PRN', 'contractor'],
    [' 1099 ', ' Contractor '],
    ['1099', 'full_time'], ['1099', 'w2'], ['1099', 'agency'],
    ['w2', 'contractor'], ['agency', 'PRN'], ['1099', null],
    [null, 'full_time'], ['future-local-type', 'future-medallion-type'],
  ])('does not flag employment type %s versus %s for any provider', (local, medallion) => {
    expect(directoryMedallionConflicts(id, [{ ...classification, local, medallion }])).toEqual([]);
  });
  it('preserves identity and employment-status warnings while removing only employment type', () => {
    const conflicts = [
      { field: 'full_name', local: 'Amanda', medallion: 'Someone else' },
      { field: 'employment_status', local: '1099', medallion: 'prn' },
      { ...classification, medallion: 'w2' },
      { ...classification, medallion: 'agency' },
      { ...classification, medallion: null },
    ];
    expect(directoryMedallionConflicts(id, conflicts)).toEqual(conflicts.slice(0, 2));
  });
});