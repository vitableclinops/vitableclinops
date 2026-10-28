import { describe, expect, it } from 'vitest';
import { directoryMedallionConflicts } from '@/lib/directoryMedallionConflicts';

describe('Amanda reviewed directory classification', () => {
  const id = 'c69f6935-34eb-4ba2-b4c0-794d95370027';
  const classification = { field: 'employment_type', local: '1099', medallion: 'prn' };
  it('clears only her acknowledged 1099 versus PRN difference', () => {
    expect(directoryMedallionConflicts(id, [classification])).toEqual([]);
    expect(directoryMedallionConflicts('another-provider', [classification])).toEqual([classification]);
  });
  it('preserves identity and changed classification warnings', () => {
    const conflicts = [{ field: 'full_name', local: 'Amanda', medallion: 'Someone else' }, { ...classification, medallion: 'w2' }];
    expect(directoryMedallionConflicts(id, conflicts)).toEqual(conflicts);
  });
});