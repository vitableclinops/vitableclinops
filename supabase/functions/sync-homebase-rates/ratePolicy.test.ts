import { describe, expect, it } from 'vitest';
import { isAgency, isProtectedRate, pickRate, uniqueMatch } from './ratePolicy';
import type { HBEmployee } from '../_shared/homebaseClient';
const employee = (job: Partial<HBEmployee['job']> = {}) => ({ job: { wage_type: 'hourly', wage_rate: 70, default_role: 'NP Telemedicine Visits', roles: [], archived_at: null, ...job } } as HBEmployee);
describe('Homebase clinical rate selection', () => {
  it('uses the clinical default wage, not the training rate', () => {
    expect(pickRate(employee({ roles: [{ name: 'Continuing Education/Training Module', wage_rate: 50 }] }), 'NP')).toMatchObject({ ok: true, rate: 70 });
  });
  it('does not use physician collaboration fees', () => {
    expect(pickRate(employee({ default_role: 'MD-Telemedicine', wage_rate: 180, roles: [{ name: 'MD-Collaborating Physician', wage_rate: 600 }] }), 'MD')).toMatchObject({ ok: true, rate: 180 });
  });
  it('never converts salary into hourly pay', () => {
    expect(pickRate(employee({ wage_type: 'salary', wage_rate: 140000 }), 'NP').ok).toBe(false);
  });
  it('preserves manual rates', () => expect(isProtectedRate('manual_workbench')).toBe(true));
  it('preserves salary equivalents', () => expect(isProtectedRate('homebase_salary_2080')).toBe(true));
  it('preserves agency rates', () => expect(isAgency({ source: 'directshifts' })).toBe(true));
  it('does not turn a missing wage into zero', () => expect(pickRate(employee({ wage_rate: null as unknown as number }), 'NP').ok).toBe(false));
  it('does not substitute in-home rates', () => expect(pickRate(employee({ default_role: 'NP In-Home Visits', wage_rate: 90 }), 'NP').ok).toBe(false));
  it('rejects conflicting clinical rates', () => expect(pickRate(employee({ roles: [{ name: 'NP Telemedicine', wage_rate: 60 }, { name: 'NP Telehealth', wage_rate: 70 }] }), 'NP').ok).toBe(false));
  it('rejects ambiguous identity matches', () => expect(uniqueMatch([{ email: 'same' }, { email: 'same' }], row => row.email === 'same')).toBeUndefined());
  it('selects therapy clinical wages', () => expect(pickRate(employee({ default_role: 'MH LPC', wage_rate: 75 }), 'LPC')).toMatchObject({ ok: true, rate: 75 }));
  it('ignores archived Homebase jobs', () => expect(pickRate(employee({ archived_at: '2026-11-01' }), 'NP').ok).toBe(false));
});