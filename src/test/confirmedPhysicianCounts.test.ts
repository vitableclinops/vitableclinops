import { describe, expect, it } from 'vitest';
import { confirmedPhysicianCount } from '@/lib/confirmedPhysicianCounts';

const value = { kate: { counts: { AR: 2, CA: 4, FL: 4, IL: 7, NC: 5, NJ: 14, OH: 3, OK: 1, PA: 19, TX: 4, VA: 3, WI: 4, WV: 2 } } };
describe('confirmed total physician counts', () => {
  it.each([['AR', 2], ['CA', 4], ['FL', 4], ['IL', 7], ['NC', 5], ['NJ', 14], ['OH', 3], ['OK', 1], ['PA', 19], ['TX', 4], ['VA', 3], ['WI', 4], ['WV', 2]])('uses Kate’s confirmed %s total of %i without adding linked counts', (state, count) => {
    expect(confirmedPhysicianCount(value, 'kate', String(state))).toBe(count);
  });
  it('does not apply Kate’s totals to other physicians or unsupplied states', () => {
    expect(confirmedPhysicianCount(value, 'patel', 'OH')).toBeNull();
    expect(confirmedPhysicianCount(value, 'kate', 'NY')).toBeNull();
  });
});