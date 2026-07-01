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

  it('accepts validated clinical lead hours in full even when they exceed monthly demand', () => {
    const allocations = allocateSchedulingEquity({
      stateGaps: [{ state: 'PA', gapHours: 40, demandHours: 40 }],
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
          id: 'standard-provider',
          providerName: 'Standard Provider',
          hourlyRate: 70,
          effectiveHours: 100,
        }),
      ],
    });

    const clinicalLead = allocations.find(a => a.id === 'clinical-lead')!;
    expect(clinicalLead.acceptedHours).toBe(100);
    expect(clinicalLead.providerAcceptancePct).toBe(100);
    expect(clinicalLead.scarceOverflowHours).toBe(60);
    expect(clinicalLead.softCapExceeded).toBe(false);
    expect(allocations.find(a => a.id === 'standard-provider')!.acceptedHours).toBe(0);
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

  it('does not keep routing DirectShifts/access above the target while compatible standard supply remains', () => {
    const allocations = allocateSchedulingEquity({
      stateGaps: [{ state: 'PA', gapHours: 100, demandHours: 100 }],
      candidates: [
        candidate({
          id: 'cheap-directshifts',
          providerName: 'Cheap DirectShifts',
          cohort: 'directshifts_access',
          hourlyRate: 50,
          effectiveHours: 100,
        }),
        candidate({
          id: 'standard-provider',
          providerName: 'Standard Provider',
          hourlyRate: 80,
          effectiveHours: 100,
        }),
      ],
    });

    const accepted = sumAccepted(allocations);
    const accessAccepted = allocations.find(a => a.id === 'cheap-directshifts')!.acceptedHours;
    expect(accessAccepted / accepted).toBeLessThanOrEqual(DIRECTSHIFTS_ACCESS_TARGET_SHARE + 0.01);
    expect(accessAccepted / accepted).toBeGreaterThanOrEqual(DIRECTSHIFTS_ACCESS_TARGET_SHARE - 0.01);
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

  it('uses August proportional fairness to pull an under-filled provider toward the fill rate', () => {
    const allocations = allocateSchedulingEquity({
      policy: 'august_2026',
      stateGaps: [{ state: 'PA', gapHours: 120, demandHours: 120 }],
      candidates: [
        candidate({
          id: 'low-rate-large',
          providerName: 'Low Rate Large',
          hourlyRate: 50,
          effectiveHours: 100,
          floorHours: 0,
          eligibleStates: [{ state: 'PA', gapHours: 120, demandHours: 120 }],
        }),
        candidate({
          id: 'higher-rate-small',
          providerName: 'Higher Rate Small',
          hourlyRate: 90,
          effectiveHours: 50,
          floorHours: 0,
          eligibleStates: [{ state: 'PA', gapHours: 120, demandHours: 120 }],
        }),
      ],
    });

    expect(allocations.find(a => a.id === 'low-rate-large')!.acceptedHours).toBeCloseTo(80, 1);
    expect(allocations.find(a => a.id === 'higher-rate-small')!.acceptedHours).toBeCloseTo(40, 1);
    expect(allocations.every(a => Math.abs(a.providerAcceptancePct - 80) <= 0.1)).toBe(true);
  });

  it('caps on-time August DirectShifts NPs at 80 hours and tracks overflow', () => {
    const allocations = allocateSchedulingEquity({
      policy: 'august_2026',
      stateGaps: [{ state: 'PA', gapHours: 120, demandHours: 120 }],
      candidates: [
        candidate({
          id: 'ds-np',
          providerName: 'Stacy Lynn',
          cohort: 'directshifts_access',
          hourlyRate: 70,
          effectiveHours: 100,
          floorHours: 0,
          directShiftsNp: true,
          submittedOnTime: true,
          eligibleStates: [{ state: 'PA', gapHours: 120, demandHours: 120 }],
        }),
      ],
    });

    const ds = allocations.find(a => a.id === 'ds-np')!;
    expect(ds.acceptedHours).toBe(80);
    expect(ds.directShiftsFloorHours).toBe(60);
    expect(ds.directShiftsTargetHours).toBe(80);
    expect(ds.overflowHours).toBe(20);
  });

  it('does not cap August clinical lead accepted hours through proportional fairness', () => {
    const allocations = allocateSchedulingEquity({
      policy: 'august_2026',
      stateGaps: [{ state: 'PA', gapHours: 100, demandHours: 100 }],
      candidates: [
        candidate({
          id: 'clinical-lead',
          providerName: 'Clinical Lead',
          cohort: 'clinical_lead',
          priorityRank: 0,
          hourlyRate: 150,
          effectiveHours: 100,
          floorHours: 0,
        }),
        candidate({
          id: 'standard',
          providerName: 'Standard',
          hourlyRate: 80,
          effectiveHours: 100,
          floorHours: 0,
        }),
      ],
    });

    expect(allocations.find(a => a.id === 'clinical-lead')!.acceptedHours).toBe(100);
    expect(allocations.find(a => a.id === 'standard')!.acceptedHours).toBe(0);
  });
});

function sumAccepted(allocations: Array<{ acceptedHours: number }>) {
  return allocations.reduce((sum, allocation) => sum + allocation.acceptedHours, 0);
}
