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

const brittany: Candidate = {
  id: 'brittany',
  profile: {
    name: 'Brittany DirectShifts',
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

describe('DirectShifts Brittany priority', () => {
  it('selects Brittany before another DirectShifts provider when both are eligible', () => {
    expect(selectProviderForState([directShiftsPeer, brittany], 'PA', '2026-06-23')?.id)
      .toBe('brittany');
    expect(providerPriorityFor(brittany.profile).key).toBe('directshifts_brittany_priority');
  });

  it('does not select Brittany when she is not licensed for the needed state', () => {
    const brittanyNjOnly = { ...brittany, licensedStates: ['NJ'] };
    expect(selectProviderForState([brittanyNjOnly, directShiftsPeer], 'PA', '2026-06-23')?.id)
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
    const brittanyAl = { ...brittany, licensedStates: ['AL'] };

    expect(selectProviderForState([brittanyAl, physician], 'AL', '2026-06-23')?.id).toBe('md');
  });

  it('does not override unavailable dates', () => {
    const unavailableBrittany = { ...brittany, unavailableDates: ['2026-06-23'] };
    expect(selectProviderForState([unavailableBrittany, directShiftsPeer], 'PA', '2026-06-23')?.id)
      .toBe('peer');
  });

  it('does not override clinical lead priority', () => {
    const clinicalBrittany = {
      ...brittany.profile,
      profession: 'Clinical Lead NP',
    };
    expect(providerPriorityFor(clinicalBrittany).key).toBe('clinical_supervisor');
  });

  it('allows other DirectShifts providers to receive hours after Brittany is used', () => {
    const first = selectProviderForState([directShiftsPeer, brittany], 'PA', '2026-06-23');
    const remaining = [directShiftsPeer, brittany].filter(candidate => candidate.id !== first?.id);
    expect(first?.id).toBe('brittany');
    expect(selectProviderForState(remaining, 'PA', '2026-06-23')?.id).toBe('peer');
  });
});

function selectProviderForState(
  candidates: Candidate[],
  state: string,
  date: string,
): Candidate | undefined {
  return candidates
    .filter(candidate =>
      candidate.licensedStates.includes(state) &&
      !candidate.unavailableDates?.includes(date) &&
      isEligibleForState({ profession: candidate.profile.profession }, state),
    )
    .sort((a, b) =>
      compareProviderAllocationPriority(a.profile, b.profile) ||
      a.profile.name!.localeCompare(b.profile.name!, undefined, { sensitivity: 'base' }),
    )[0];
}
