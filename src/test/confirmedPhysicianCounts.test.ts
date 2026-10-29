import { describe, expect, it } from 'vitest';
import { confirmedPhysicianCount } from '@/lib/confirmedPhysicianCounts';

const value = { kate: { counts: { AR: 2, CA: 4, FL: 4, OH: 5, OK: 1, TX: 4, VA: 3 } } };
describe('confirmed total physician counts', () => {
  it.each([['AR', 2], ['CA', 4], ['FL', 4], ['OH', 5], ['OK', 1], ['TX', 4], ['VA', 3]])('uses Kate’s confirmed %s total of %i without adding linked counts', (state, count) => {
    expect(confirmedPhysicianCount(value, 'kate', String(state))).toBe(count);
  });
  it('does not apply Kate’s totals to other physicians or unsupplied states', () => {
    expect(confirmedPhysicianCount(value, 'patel', 'OH')).toBeNull();
    expect(confirmedPhysicianCount(value, 'kate', 'PA')).toBeNull();
  });
});