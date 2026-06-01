import { describe, expect, it } from 'vitest';
import {
  mentalHealthServiceLineForProvider,
  isMentalHealthProvider,
} from '@/lib/scheduling/mentalHealth';

describe('mental health scheduling classification', () => {
  it('routes named mental health coaches to the MH coaching forecast', () => {
    for (const name of [
      'Matthew Vazquez',
      'Jamie Fuentes',
      'Jennifer Yost',
      'Esha Shah',
      'Liana Griebsch',
      'Michelle Diederich',
    ]) {
      expect(mentalHealthServiceLineForProvider(null, name), name).toBe('mh_coaching');
      expect(isMentalHealthProvider(null, name), name).toBe(true);
    }
  });

  it('routes named therapists to the therapy forecast', () => {
    for (const name of [
      'Margaret (Margo) Mulgrew',
      'Margo Mulgrew',
      'Richard Travis Rash',
      'Richard Rash',
      'Mishelle Lockerby (Direct Shifts)',
      'Mishelle Lockerby',
    ]) {
      expect(mentalHealthServiceLineForProvider(null, name), name).toBe('therapy');
      expect(isMentalHealthProvider(null, name), name).toBe(true);
    }
  });

  it('treats LCSW credentials as therapy and Health Coach credentials as coaching', () => {
    expect(mentalHealthServiceLineForProvider('LCSW', 'Any Therapist')).toBe('therapy');
    expect(mentalHealthServiceLineForProvider('Health Coach', 'Any Coach')).toBe('mh_coaching');
  });
});
