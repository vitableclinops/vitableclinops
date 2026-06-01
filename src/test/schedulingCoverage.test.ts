import { describe, expect, it } from 'vitest';
import {
  ACCESS_GROWTH_BUFFER_MULTIPLIER,
  computeStateCoverage,
  coverageStatusFor,
  isEligibleForState,
} from '@/lib/scheduling/coverage';

describe('computeStateCoverage', () => {
  it('uses accepted shift rows for filled hours and active licenses for eligible/missing counts', () => {
    const result = computeStateCoverage({
      targets: [{ state: 'PA', monthly_hours_target: 100 }],
      shifts: [{ assigned_state: 'PA', hours: 40, shift_type: 'virtual_oneoff', provider_name: 'Ready Provider' }],
      providers: [
        { id: 'p1', name: 'Ready Provider', profession: 'NP', active: true },
        { id: 'p2', name: 'Missing Provider', profession: 'NP', active: true },
        { id: 'p3', name: 'Inactive Provider', profession: 'NP', active: false },
      ],
      licenses: [
        { provider_id: 'p1', state: 'PA', status: 'active' },
        { provider_id: 'p2', state: 'PA', status: 'verified' },
        { provider_id: 'p3', state: 'PA', status: 'active' },
      ],
      submissions: [{ provider_id: 'p1', decision_status: 'accepted' }],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      state: 'PA',
      needed: 100,
      filled: 40,
      leftover: 60,
      eligible_providers: 2,
      missing_providers: 1,
      status: 'Critical',
    });
  });

  it('can apply an access growth buffer to demand targets', () => {
    const result = computeStateCoverage({
      targets: [{ state: 'PA', monthly_hours_target: 100 }],
      shifts: [{ assigned_state: 'PA', hours: 100, shift_type: 'virtual_oneoff', provider_name: 'Ready Provider' }],
      providers: [{ id: 'p1', name: 'Ready Provider', profession: 'NP', active: true }],
      licenses: [{ provider_id: 'p1', state: 'PA', status: 'active' }],
      submissions: [{ provider_id: 'p1', decision_status: 'accepted' }],
      demandMultiplier: ACCESS_GROWTH_BUFFER_MULTIPLIER,
    });

    expect(result.rows[0]).toMatchObject({
      baseline_needed: 100,
      needed: 125,
      access_buffer_hours: 25,
      filled: 100,
      leftover: 25,
      status: 'Watch',
    });
  });

  it('filters MD-only states to MD/DO providers', () => {
    const result = computeStateCoverage({
      targets: [{ state: 'AL', monthly_hours_target: 25 }],
      shifts: [],
      providers: [
        { id: 'np1', name: 'NP Provider', profession: 'NP', active: true },
        { id: 'md1', name: 'MD Provider', profession: 'MD', active: true },
      ],
      licenses: [
        { provider_id: 'np1', state: 'AL', status: 'active' },
        { provider_id: 'md1', state: 'AL', status: 'active' },
      ],
      submissions: [],
    });

    expect(result.rows[0].eligible_providers).toBe(1);
    expect(result.rows[0].missing_providers).toBe(1);
  });

  it('reserves physician providers for MD-only states', () => {
    const result = computeStateCoverage({
      targets: [
        { state: 'AL', monthly_hours_target: 25 },
        { state: 'PA', monthly_hours_target: 100 },
      ],
      shifts: [],
      providers: [
        { id: 'np1', name: 'NP Provider', profession: 'NP', active: true },
        { id: 'md1', name: 'MD Provider', profession: 'Physician', active: true },
      ],
      licenses: [
        { provider_id: 'np1', state: 'PA', status: 'active' },
        { provider_id: 'md1', state: 'AL', status: 'active' },
        { provider_id: 'md1', state: 'PA', status: 'active' },
      ],
      submissions: [],
    });

    const byState = new Map(result.rows.map(row => [row.state, row]));
    expect(byState.get('AL')?.eligible_providers).toBe(1);
    expect(byState.get('PA')?.eligible_providers).toBe(1);
  });
});

describe('isEligibleForState', () => {
  it('keeps physicians on MD-only states and non-physicians off them', () => {
    expect(isEligibleForState({ profession: 'MD' }, 'AL')).toBe(true);
    expect(isEligibleForState({ profession: 'Physician' }, 'PA')).toBe(false);
    expect(isEligibleForState({ profession: 'MD/DO' }, 'TN')).toBe(true);
    expect(isEligibleForState({ profession: 'NP' }, 'AL')).toBe(false);
    expect(isEligibleForState({ profession: 'NP' }, 'PA')).toBe(true);
  });
});

describe('coverageStatusFor', () => {
  it('classifies coverage using workbench thresholds', () => {
    expect(coverageStatusFor(99)).toBe('Covered');
    expect(coverageStatusFor(85)).toBe('Watch');
    expect(coverageStatusFor(70)).toBe('Gap');
    expect(coverageStatusFor(59)).toBe('Critical');
  });
});
