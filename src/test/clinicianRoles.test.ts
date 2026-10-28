import { describe, expect, it } from 'vitest';
import { isClinician } from '@/lib/clinicianRoles';

describe('Directory clinician scope', () => {
  it('hides staff records that carry no clinical Type', () => {
    expect(isClinician({ profession: null, credentials: null })).toBe(false);
    expect(isClinician({ profession: '-', credentials: null })).toBe(false);
    expect(isClinician({ profession: '', credentials: '' })).toBe(false);
    expect(isClinician({ profession: 'admin', credentials: null })).toBe(false);
  });

  it('shows every licensed clinical Type', () => {
    for (const profession of ['MD', 'DO', 'NP', 'APN', 'RN', 'LPC', 'LCSW']) {
      expect(isClinician({ profession, credentials: null })).toBe(true);
    }
  });

  it('shows provider-type and coach spellings', () => {
    expect(isClinician({ profession: 'nurse_practitioner' })).toBe(true);
    expect(isClinician({ profession: 'mental_health_coach' })).toBe(true);
    expect(isClinician({ profession: 'MH Coach' })).toBe(true);
    expect(isClinician({ profession: 'health_coach' })).toBe(true);
  });

  it('falls back to clinical credentials when the Type is blank', () => {
    expect(isClinician({ profession: null, credentials: 'NP' })).toBe(true);
    expect(isClinician({ profession: '-', credentials: 'MSN, FNP-BC' })).toBe(true);
    expect(isClinician({ profession: null, credentials: 'MD' })).toBe(true);
  });

  it('keeps a blank Type with non-clinical credentials out of scope', () => {
    expect(isClinician({ profession: null, credentials: 'BA' })).toBe(false);
    expect(isClinician({ profession: '-', credentials: null })).toBe(false);
  });

  it('never hides an unrecognized populated Type', () => {
    expect(isClinician({ profession: 'DPM' })).toBe(true);
  });
});
