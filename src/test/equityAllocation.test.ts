import { describe, expect, it } from 'vitest';
import {
  allocateSchedulingEquity,
  DIRECTSHIFTS_ACCESS_TARGET_SHARE,
  PROVIDER_SOFT_CAP_SHARE,
  type SchedulingEquityCandidate,
} from '@/lib/scheduling/equityAllocation';

const stateGaps = [{ state: 'PA', gapHours: 100, demandHours: 100 }];

function candidate(
  overrides: Partial<SchedulingEquityCandidate> & Pick<SchedulingEquityCandidate, 'id' | 'providerName'>,
): SchedulingEquityCandidate {
  return {
    cohort: 'standard',
    priorityRank: 1,
    hourlyRate: 80,
    effectiveHours: 100,
    scarceHours: 0,
    floorHours: 5,
    eligibleStates: [{ state: 'PA', gapHours: 100, demandHours: 100 }],
    ...overrides,
  };
}

describe('allocateSchedulingEquity', () => {
  it('moves DirectShifts/access providers toward 15% of accepted telehealth hours when eligible supply exists', () => {
    const allocations = allocateSchedulingEquity({
      stateGaps,
      candidates: [
        candidate({
          id: 'standard-low-rate',
          providerName: 'Standard Low Rate',
          hourlyRate: 50,
          effectiveHours: 200,
        }),
        candidate({
          id: 'directshifts',
          providerName: 'DirectShifts Provider',
          cohort: 'directshifts_access',
          hourlyRate: 80,
          effectiveHours: 100,
        }),
      ],
    });

    const accepted = sumAccepted(allocations);
    const accessAccepted = allocations.find(a => a.id === 'directshifts')!.acceptedHours;
    expect(accepted).toBe(100);
    expect(accessAccepted / accepted).toBeGreaterThanOrEqual(DIRECTSHIFTS_ACCESS_TARGET_SHARE);
  });

  it('allocates compatible clinical lead demand before DirectShifts/access catch-up', () => {
    const allocations = allocateSchedulingEquity({
      stateGaps: [{ state: 'PA', gapHours: 100, demandHours: 100 }],
      candidates: [
        candidate({
          id: 'clinical-lead',
          providerName: 'Clinical Lead',
          cohort: 'clinical_lead',
          priorityRank: 0,
          hourlyRate: 150,
          effectiveHours: 100,
        }),
        candidate({
          id: 'directshifts',
          providerName: 'DirectShifts Provider',
          cohort: 'directshifts_access',
          priorityRank: 1,
          hourlyRate: 80,
          effectiveHours: 100,
        }),
      ],
    });

    expect(allocations.find(a => a.id === 'clinical-lead')!.acceptedHours).toBeGreaterThan(
      allocations.find(a => a.id === 'directshifts')!.acceptedHours,
    );
  });

  it('keeps same-rate DirectShifts/access providers close by accepted percentage of submitted hours', () => {
    const allocations = allocateSchedulingEquity({
      stateGaps: [{ state: 'PA', gapHours: 80, demandHours: 80 }],
      candidates: [
        candidate({
          id: 'ds-one',
          providerName: 'DS One',
          cohort: 'directshifts_access',
          hourlyRate: 80,
          effectiveHours: 80,
        }),
        candidate({
          id: 'ds-two',
          providerName: 'DS Two',
          cohort: 'directshifts_access',
          hourlyRate: 80,
          effectiveHours: 80,
        }),
      ],
    });

    const first = allocations.find(a => a.id === 'ds-one')!;
    const second = allocations.find(a => a.id === 'ds-two')!;
    expect(Math.abs(first.providerAcceptancePct - second.providerAcceptancePct)).toBeLessThanOrEqual(10);
    expect(first.acceptedHours).toBeCloseTo(40, 1);
    expect(second.acceptedHours).toBeCloseTo(40, 1);
  });

  it('uses the 75% soft cap to redistribute hours before allowing over-cap allocation', () => {
    const allocations = allocateSchedulingEquity({
      stateGaps: [{ state: 'PA', gapHours: 180, demandHours: 180 }],
      candidates: [
        candidate({
          id: 'cheap-large',
          providerName: 'Cheap Large Submitter',
          hourlyRate: 50,
          effectiveHours: 200,
          eligibleStates: [{ state: 'PA', gapHours: 180, demandHours: 180 }],
        }),
        candidate({
          id: 'next-provider',
          providerName: 'Next Provider',
          hourlyRate: 90,
          effectiveHours: 100,
          eligibleStates: [{ state: 'PA', gapHours: 180, demandHours: 180 }],
        }),
      ],
    });

    const cheap = allocations.find(a => a.id === 'cheap-large')!;
    const next = allocations.find(a => a.id === 'next-provider')!;
    expect(cheap.acceptedHours).toBeCloseTo(200 * PROVIDER_SOFT_CAP_SHARE, 1);
    expect(next.acceptedHours).toBeGreaterThan(0);
  });

  it('gives each eligible submitter some hours before one provider consumes all compatible demand', () => {
    const allocations = allocateSchedulingEquity({
      stateGaps: [{ state: 'PA', gapHours: 20, demandHours: 20 }],
      candidates: [
        candidate({
          id: 'cheap-provider',
          providerName: 'Cheap Provider',
          hourlyRate: 50,
          effectiveHours: 100,
          eligibleStates: [{ state: 'PA', gapHours: 20, demandHours: 20 }],
        }),
        candidate({
          id: 'higher-provider',
          providerName: 'Higher Provider',
          hourlyRate: 120,
          effectiveHours: 10,
          eligibleStates: [{ state: 'PA', gapHours: 20, demandHours: 20 }],
        }),
      ],
    });

    expect(allocations.find(a => a.id === 'cheap-provider')!.acceptedHours).toBeGreaterThan(0);
    expect(allocations.find(a => a.id === 'higher-provider')!.acceptedHours).toBeGreaterThan(0);
    expect(allocations.every(a => a.equityFloor === 'met')).toBe(true);
  });
});

function sumAccepted(allocations: Array<{ acceptedHours: number }>) {
  return allocations.reduce((sum, allocation) => sum + allocation.acceptedHours, 0);
}
