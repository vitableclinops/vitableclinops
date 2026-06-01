import { describe, expect, it } from 'vitest';
import { computeStateCoverage, coverageStatusFor } from '@/lib/scheduling/coverage';

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
});

describe('coverageStatusFor', () => {
  it('classifies coverage using workbench thresholds', () => {
    expect(coverageStatusFor(99)).toBe('Covered');
    expect(coverageStatusFor(85)).toBe('Watch');
    expect(coverageStatusFor(70)).toBe('Gap');
    expect(coverageStatusFor(59)).toBe('Critical');
  });
});
