import { describe, it, expect } from 'vitest';
import {
  buildPcpCoverageMap,
  isPcpCoverageExcluded,
  pcpCoverageStatesFor,
} from '@/lib/pcpCoverage';

describe('PCP coverage exclusions (Metabase question 2940 rules)', () => {
  it('excludes the four former employees from current coverage', () => {
    for (const name of ['Heidi Hershberger', 'Emily Van-Otoo', 'Crystal Jones', 'LaStasha Jackson']) {
      expect(isPcpCoverageExcluded(name)).toBe(true);
    }
  });

  it('excludes Matthew Vasquez as an out-of-scope health coach, not as terminated', () => {
    expect(isPcpCoverageExcluded('Matthew Vasquez')).toBe(true);
  });

  it('matches the query spelling "Lastasha Jackson" to the same exclusion', () => {
    expect(isPcpCoverageExcluded('Lastasha Jackson')).toBe(true);
  });

  it('does not exclude Antonia Jackson — matching is by full name, never first/last name alone', () => {
    expect(isPcpCoverageExcluded('Antonia Jackson')).toBe(false);
  });

  it('drops excluded names even if they appear in a raw export', () => {
    const map = buildPcpCoverageMap([
      { State: 'PA', 'Provider Full Name': 'Heidi Hershberger' },
      { State: 'PA', 'Provider Full Name': 'Matthew Vasquez' },
      { State: 'PA', 'Provider Full Name': 'Akosua Norgbey' },
      { State: 'NJ', 'Provider Full Name': 'Akosua Norgbey' },
    ]);
    expect(map.size).toBe(1);
    expect(pcpCoverageStatesFor(map, 'Akosua Norgbey')).toEqual(['NJ', 'PA']);
    expect(pcpCoverageStatesFor(map, 'Heidi Hershberger')).toEqual([]);
    expect(pcpCoverageStatesFor(map, 'Matthew Vasquez')).toEqual([]);
  });

  it('matches "Last, First" profile names to bare query names', () => {
    const map = buildPcpCoverageMap([{ State: 'TX', 'Provider Full Name': 'Anabel Garcia' }]);
    expect(pcpCoverageStatesFor(map, 'Garcia, Anabel')).toEqual(['TX']);
  });
});
