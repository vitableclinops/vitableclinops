import { describe, expect, it } from 'vitest';
import { licensedNotActiveLabel, licensedNotActiveStateList, licensedNotActiveStates } from '@/lib/licensedNotActiveStates';

describe('Licensed states minus active PCP telemedicine states', () => {
  it('keeps only licensed states not in active PCP telemedicine states', () => {
    expect(licensedNotActiveStates(['CA', 'NJ', 'PA', 'TX'], ['NJ', 'PA', 'OH'])).toEqual(['CA', 'TX']);
  });
  it('returns no states when every licensed state is active', () => {
    expect(licensedNotActiveStates(['NJ', 'PA'], ['PA', 'NJ'])).toEqual([]);
  });
  it('keeps all licenses when no active states are returned', () => {
    expect(licensedNotActiveStates(['TX', 'CA'], [])).toEqual(['CA', 'TX']);
  });
  it('normalizes and deduplicates state abbreviations', () => {
    expect(licensedNotActiveStates(['ca', ' CA ', 'nj', ''], [' NJ '])).toEqual(['CA']);
  });
  it('does not treat unavailable coverage as inactive', () => {
    expect(licensedNotActiveLabel(['CA'], { kind: 'unavailable', text: '', detail: '', states: [] })).toBe('Coverage unavailable');
  });
  it('does not infer inactive states from an ambiguous identity', () => {
    expect(licensedNotActiveLabel(['CA'], { kind: 'needs_review', text: '', detail: '', states: [] })).toBe('Identity needs review');
  });
  it('offers the full list for a hover popup when states are present', () => {
    expect(licensedNotActiveStateList('CA, TX, NJ')).toBe('CA, TX, NJ');
  });
  it('offers no popup for status messages or empty cells', () => {
    expect(licensedNotActiveStateList('Coverage unavailable')).toBeNull();
    expect(licensedNotActiveStateList('Identity needs review')).toBeNull();
    expect(licensedNotActiveStateList('None')).toBeNull();
    expect(licensedNotActiveStateList(null)).toBeNull();
    expect(licensedNotActiveStateList('   ')).toBeNull();
  });
});