import { describe, expect, it } from 'vitest';
import {
  compareProviderAllocationPriority,
  providerPriorityFor,
  type ProviderPriorityProfile,
} from '@/lib/scheduling/providerPriority';
import { isEligibleForState } from '@/lib/scheduling/coverage';

type Candidate = {
  id: string;
  profile: ProviderPriorityProfile;
  licensedStates: string[];
  unavailableDates?: string[];
};

const brittneyAfram: Candidate = {
  id: 'brittney-afram',
  profile: {
    name: 'Brittney Afram',
    profession: 'NP',
    employment_type: 'agency',
    source: 'DirectShifts',
    shift_types: ['directshifts'],
  },
  licensedStates: ['PA'],
};

const directShiftsPeer: Candidate = {
  id: 'peer',
  profile: {
    name: 'Alex DirectShifts',
    profession: 'NP',
    employment_type: 'agency',
    source: 'DirectShifts',
    shift_types: ['directshifts'],
  },
  licensedStates: ['PA'],
};

describe('DirectShifts Brittney Afram priority', () => {
  it('selects Brittney Afram before another DirectShifts provider when both are eligible and rates do not decide', () => {
    expect(selectProviderForState([directShiftsPeer, brittneyAfram], 'PA', '2026-06-23')?.id)
      .toBe('brittney-afram');
    expect(providerPriorityFor(brittneyAfram.profile).key).toBe('directshifts_brittany_priority');
  });

  it('prioritizes clinical leads first, then the lowest hourly rate regardless of provider source', () => {
    const lowerRateDirectShifts: Candidate = {
      ...directShiftsPeer,
      id: 'low-rate-ds',
      profile: {
        ...directShiftsPeer.profile,
        name: 'Lower Rate DS',
        hourly_rate: 72,
      },
    };
    const higherRateInternal: Candidate = {
      id: 'high-rate-internal',
      profile: {
        name: 'Higher Rate Internal',
        profession: 'NP',
        employment_type: 'employee',
        source: 'Vitable',
        hourly_rate: 95,
      },
      licensedStates: ['PA'],
    };
    const clinicalLead: Candidate = {
      id: 'clinical-lead',
      profile: {
        name: 'Clinical Lead NP',
        profession: 'Clinical Lead NP',
        employment_type: 'employee',
        source: 'Vitable',
        hourly_rate: 140,
      },
      licensedStates: ['PA'],
    };

    expect(selectProviderForState([higherRateInternal, lowerRateDirectShifts], 'PA', '2026-06-23')?.id)
      .toBe('low-rate-ds');
    expect(selectProviderForState([higherRateInternal, lowerRateDirectShifts, clinicalLead], 'PA', '2026-06-23')?.id)
      .toBe('clinical-lead');
  });

  it('lets a lower-rate DirectShifts provider outrank Brittney Afram when cost decides', () => {
    const lowerRatePeer: Candidate = {
      ...directShiftsPeer,
      profile: {
        ...directShiftsPeer.profile,
        hourly_rate: 70,
      },
    };
    const higherRateBrittney: Candidate = {
      ...brittneyAfram,
      profile: {
        ...brittneyAfram.profile,
        hourly_rate: 90,
      },
    };

    expect(selectProviderForState([higherRateBrittney, lowerRatePeer], 'PA', '2026-06-23')?.id)
      .toBe('peer');
  });

  it('does not use utilization as a tie-break by default', () => {
    const highUtilization: Candidate = {
      id: 'high-utilization',
      profile: {
        name: 'High Utilization',
        profession: 'NP',
        employment_type: 'employee',
        source: 'Vitable',
        hourly_rate: 80,
        utilization_pct: 92,
      },
      licensedStates: ['PA'],
    };
    const lowUtilization: Candidate = {
      id: 'low-utilization',
      profile: {
        name: 'Low Utilization',
        profession: 'NP',
        employment_type: 'agency',
        source: 'DirectShifts',
        hourly_rate: 80,
        utilization_pct: 41,
      },
      licensedStates: ['PA'],
    };

    expect(selectProviderForState([highUtilization, lowUtilization], 'PA', '2026-06-23')?.id)
      .toBe('high-utilization');
  });

  it('can opt into lower utilization as the secondary tie-break after hourly rate', () => {
    const highUtilization: Candidate = {
      id: 'high-utilization',
      profile: {
        name: 'High Utilization',
        profession: 'NP',
        employment_type: 'employee',
        source: 'Vitable',
        hourly_rate: 80,
        utilization_pct: 92,
      },
      licensedStates: ['PA'],
    };
    const lowUtilization: Candidate = {
      id: 'low-utilization',
      profile: {
        name: 'Low Utilization',
        profession: 'NP',
        employment_type: 'agency',
        source: 'DirectShifts',
        hourly_rate: 80,
        utilization_pct: 41,
      },
      licensedStates: ['PA'],
    };

    expect(
      selectProviderForState(
        [highUtilization, lowUtilization],
        'PA',
        '2026-06-23',
        { useUtilization: true },
      )?.id,
    ).toBe('low-utilization');
  });

  it('does not treat a different first-name-only Brittany as the priority provider', () => {
    const differentBrittany: Candidate = {
      id: 'different-brittany',
      profile: {
        name: 'Brittany DirectShifts',
        profession: 'NP',
        employment_type: 'agency',
        source: 'DirectShifts',
        shift_types: ['directshifts'],
      },
      licensedStates: ['PA'],
    };

    expect(providerPriorityFor(differentBrittany.profile).key).toBe('access_provider');
  });

  it('recognizes Brittney Afram even when DirectShifts metadata is missing from the provider row', () => {
    const brittneyWithoutSource: Candidate = {
      ...brittneyAfram,
      profile: {
        name: 'Brittney Afram',
        profession: 'NP',
      },
    };

    expect(providerPriorityFor(brittneyWithoutSource.profile).key).toBe('directshifts_brittany_priority');
    expect(selectProviderForState([directShiftsPeer, brittneyWithoutSource], 'PA', '2026-06-23')?.id)
      .toBe('brittney-afram');
  });

  it('does not select Brittney Afram when she is not licensed for the needed state', () => {
    const brittneyAframNjOnly = { ...brittneyAfram, licensedStates: ['NJ'] };
    expect(selectProviderForState([brittneyAframNjOnly, directShiftsPeer], 'PA', '2026-06-23')?.id)
      .toBe('peer');
  });

  it('does not override MD-only physician-reserved state policy', () => {
    const physician: Candidate = {
      id: 'md',
      profile: {
        name: 'Morgan DirectShifts MD',
        profession: 'MD',
        employment_type: 'agency',
        source: 'DirectShifts',
        shift_types: ['directshifts'],
      },
      licensedStates: ['AL'],
    };
    const brittneyAframAl = { ...brittneyAfram, licensedStates: ['AL'] };

    expect(selectProviderForState([brittneyAframAl, physician], 'AL', '2026-06-23')?.id).toBe('md');
  });

  it('does not override unavailable dates', () => {
    const unavailableBrittneyAfram = { ...brittneyAfram, unavailableDates: ['2026-06-23'] };
    expect(selectProviderForState([unavailableBrittneyAfram, directShiftsPeer], 'PA', '2026-06-23')?.id)
      .toBe('peer');
  });

  it('does not override clinical lead priority', () => {
    const clinicalBrittneyAfram = {
      ...brittneyAfram.profile,
      profession: 'Clinical Lead NP',
    };
    expect(providerPriorityFor(clinicalBrittneyAfram).key).toBe('clinical_supervisor');
  });

  it('allows other DirectShifts providers to receive hours after Brittney Afram is used', () => {
    const first = selectProviderForState([directShiftsPeer, brittneyAfram], 'PA', '2026-06-23');
    const remaining = [directShiftsPeer, brittneyAfram].filter(candidate => candidate.id !== first?.id);
    expect(first?.id).toBe('brittney-afram');
    expect(selectProviderForState(remaining, 'PA', '2026-06-23')?.id).toBe('peer');
  });
});

function selectProviderForState(
  candidates: Candidate[],
  state: string,
  date: string,
  options: { useUtilization?: boolean } = {},
): Candidate | undefined {
  return candidates
    .filter(candidate =>
      candidate.licensedStates.includes(state) &&
      !candidate.unavailableDates?.includes(date) &&
      isEligibleForState({ profession: candidate.profile.profession }, state),
    )
    .sort((a, b) =>
      compareProviderAllocationPriority(a.profile, b.profile, options) ||
      a.profile.name!.localeCompare(b.profile.name!, undefined, { sensitivity: 'base' }),
    )[0];
}
