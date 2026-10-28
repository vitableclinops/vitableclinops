import { describe, expect, it } from 'vitest';
import { employeeVisibleIn, isOffboarded } from '@/lib/employeeVisibility';

describe('Offboarded employees', () => {
  it('excludes terminated employees from current views and includes them in Offboarded', () => {
    expect(employeeVisibleIn('terminated', 'current')).toBe(false);
    expect(employeeVisibleIn('terminated', 'offboarded')).toBe(true);
  });
  it('treats the saved termed label as terminated', () => {
    expect(isOffboarded('termed')).toBe(true);
    expect(employeeVisibleIn('termed', 'current')).toBe(false);
  });
  it('keeps active and inactive employees out of Offboarded', () => {
    for (const status of ['active', 'inactive', null]) {
      expect(employeeVisibleIn(status, 'current')).toBe(true);
      expect(employeeVisibleIn(status, 'offboarded')).toBe(false);
    }
  });
});