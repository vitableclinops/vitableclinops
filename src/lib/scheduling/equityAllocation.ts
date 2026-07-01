export const FAIRNESS_POLICY_VERSION = '2026-06-09';
export const AUGUST_2026_FAIRNESS_POLICY_VERSION = '2026-08-01';
export const DIRECTSHIFTS_ACCESS_TARGET_SHARE = 0.15;
export const PROVIDER_SOFT_CAP_SHARE = 0.75;
export const SAME_RATE_DIRECTSHIFTS_TOLERANCE_PCT = 10;
export const AUGUST_2026_FAIRNESS_TOLERANCE_PCT = 25;
export const AUGUST_2026_DIRECTSHIFTS_NP_MIN_HOURS = 60;
export const AUGUST_2026_DIRECTSHIFTS_NP_TARGET_HOURS = 80;

const BULK_ALLOCATION_QUANTUM_HOURS = 0.5;

export type SchedulingEquityPolicy = 'legacy_2026_07' | 'august_2026';

export type SchedulingEquityCohort =
  | 'clinical_lead'
  | 'directshifts_access'
  | 'standard'
  | 'mental_health';

export type SchedulingEquityState = {
  state: string;
  gapHours: number;
  demandHours: number;
};

export type SchedulingEquityCandidate = {
  id: string;
  providerName: string;
  cohort: SchedulingEquityCohort;
  priorityRank: number;
  hourlyRate: number | null;
  utilizationPct?: number | null;
  effectiveHours: number;
  scarceHours: number;
  floorHours: number;
  directShiftsNp?: boolean;
  submittedOnTime?: boolean;
  eligibleStates: SchedulingEquityState[];
};

export type SchedulingEquityStateGap = {
  state: string;
  gapHours: number;
  demandHours: number;
};

export type SchedulingEquityAllocation = {
  id: string;
  acceptedHours: number;
  allocations: Array<{ state: string; hours: number }>;
  providerAcceptancePct: number;
  equityFloor: 'met' | 'unmet_no_gap' | 'unmet_no_valid_shift';
  softCapHours: number;
  softCapExceeded: boolean;
  directshiftsTargetShare: number;
  directshiftsShareAfter: number;
  scarceOverflowHours: number;
  overflowHours?: number;
  directShiftsFloorHours?: number;
  directShiftsTargetHours?: number;
  fairnessTolerancePct?: number;
  manualReviewReason?: string | null;
  fairnessPolicyVersion: string;
};

type MutableAllocation = SchedulingEquityAllocation & {
  acceptedHours: number;
  allocations: Array<{ state: string; hours: number }>;
};

export function allocateSchedulingEquity({
  candidates,
  stateGaps,
  directshiftsTargetShare = DIRECTSHIFTS_ACCESS_TARGET_SHARE,
  softCapShare = PROVIDER_SOFT_CAP_SHARE,
  policy = 'legacy_2026_07',
  fairnessTolerancePct = AUGUST_2026_FAIRNESS_TOLERANCE_PCT,
}: {
  candidates: SchedulingEquityCandidate[];
  stateGaps: SchedulingEquityStateGap[];
  directshiftsTargetShare?: number;
  softCapShare?: number;
  policy?: SchedulingEquityPolicy;
  fairnessTolerancePct?: number;
}): SchedulingEquityAllocation[] {
  if (policy === 'august_2026') {
    return allocateAugust2026SchedulingEquity({
      candidates,
      stateGaps,
      fairnessTolerancePct,
    });
  }

  const normalizedCandidates = candidates
    .map(candidate => ({
      ...candidate,
      effectiveHours: equityRound2(Math.max(0, candidate.effectiveHours)),
      scarceHours: equityRound2(Math.max(0, candidate.scarceHours)),
      floorHours: equityRound2(Math.max(0, candidate.floorHours)),
      eligibleStates: candidate.eligibleStates
        .map(state => ({
          state: normalizeState(state.state),
          gapHours: equityRound2(Math.max(0, state.gapHours)),
          demandHours: equityRound2(Math.max(0, state.demandHours)),
        }))
        .filter(state => /^[A-Z]{2}$/.test(state.state)),
    }))
    .filter(candidate => candidate.effectiveHours > 0);

  const stateRemaining = new Map<string, number>();
  const stateDemand = new Map<string, number>();
  for (const gap of stateGaps) {
    const state = normalizeState(gap.state);
    if (!/^[A-Z]{2}$/.test(state)) continue;
    stateRemaining.set(state, equityRound2(Math.max(stateRemaining.get(state) ?? 0, Number(gap.gapHours ?? 0))));
    stateDemand.set(state, equityRound2(Math.max(stateDemand.get(state) ?? 0, Number(gap.demandHours ?? 0))));
  }

  const allocations = new Map<string, MutableAllocation>();
  for (const candidate of normalizedCandidates) {
    allocations.set(candidate.id, {
      id: candidate.id,
      acceptedHours: 0,
      allocations: [],
      providerAcceptancePct: 0,
      equityFloor: candidate.floorHours > 0 ? 'unmet_no_gap' : 'unmet_no_valid_shift',
      softCapHours: equityRound2(candidate.effectiveHours * softCapShare),
      softCapExceeded: false,
      directshiftsTargetShare: equityRound2(directshiftsTargetShare * 100),
      directshiftsShareAfter: 0,
      scarceOverflowHours: 0,
      fairnessPolicyVersion: FAIRNESS_POLICY_VERSION,
    });
  }

  const allocateToCandidate = (
    candidate: SchedulingEquityCandidate,
    requestedHours: number,
    allowOverflow: boolean,
  ) => {
    const allocation = allocations.get(candidate.id);
    if (!allocation) return { accepted: 0, overflow: 0 };
    let remaining = equityRound2(Math.min(
      requestedHours,
      Math.max(0, candidate.effectiveHours - allocation.acceptedHours),
    ));
    if (remaining <= 0) return { accepted: 0, overflow: 0 };

    let accepted = 0;
    let overflow = 0;
    const sortedStates = statesByNeed(candidate, stateRemaining, stateDemand);
    for (const state of sortedStates) {
      if (remaining <= 0) break;
      const available = Math.max(0, stateRemaining.get(state) ?? 0);
      if (available <= 0) continue;
      const take = equityRound2(Math.min(available, remaining));
      addAllocation(allocation, state, take);
      stateRemaining.set(state, equityRound2(available - take));
      remaining = equityRound2(remaining - take);
      accepted = equityRound2(accepted + take);
    }

    if (allowOverflow && remaining > 0) {
      const fallbackState = fallbackStateFor(candidate, stateDemand);
      if (fallbackState) {
        addAllocation(allocation, fallbackState, remaining);
        accepted = equityRound2(accepted + remaining);
        overflow = remaining;
        remaining = 0;
      }
    }

    allocation.acceptedHours = equityRound2(allocation.acceptedHours + accepted);
    allocation.scarceOverflowHours = equityRound2(allocation.scarceOverflowHours + overflow);
    if (allocation.acceptedHours > 0) allocation.equityFloor = 'met';
    return { accepted, overflow };
  };

  const candidatesByPriority = [...normalizedCandidates].sort(compareBaseCandidatePriority);
  const hasNonAccessCandidate = normalizedCandidates.some(candidate => candidate.cohort !== 'directshifts_access');

  // Clinical lead hours are not demand-trimmed. Once validation/licensure
  // admits the submission into this allocator, accept the full forecastable
  // clinical lead capacity before rate, DirectShifts share, and soft caps.
  for (const candidate of candidatesByPriority) {
    if (!isClinicalLeadCandidate(candidate)) continue;
    allocateToCandidate(candidate, candidate.effectiveHours, true);
  }

  // Protected Friday/weekend access survives before monthly surplus trims.
  for (const candidate of candidatesByPriority) {
    if (candidate.scarceHours <= 0) continue;
    allocateToCandidate(candidate, candidate.scarceHours, true);
  }

  // No-zero pass: each eligible submitter gets at least one publishable block
  // when compatible demand remains.
  for (const candidate of candidatesByPriority.sort((a, b) =>
    compareEquityFloorPriority(a, b, allocations, directshiftsTargetShare),
  )) {
    const allocation = allocations.get(candidate.id);
    if (!allocation || allocation.acceptedHours > 0) continue;
    if (candidate.floorHours <= 0) {
      allocation.equityFloor = 'unmet_no_valid_shift';
      continue;
    }
    const possible = eligibleGapHours(candidate, stateRemaining);
    if (possible <= 0) {
      allocation.equityFloor = 'unmet_no_gap';
      continue;
    }
    allocateToCandidate(candidate, Math.min(candidate.floorHours, possible), false);
  }

  let guard = 0;
  while (totalRemainingGap(stateRemaining) > 0.001 && guard < 100_000) {
    guard += 1;
    const eligible = normalizedCandidates.filter(candidate =>
      candidateRemaining(candidate, allocations) > 0.001 &&
      eligibleGapHours(candidate, stateRemaining) > 0.001,
    );
    if (eligible.length === 0) break;

    const clinicalLeadEligible = eligible.filter(isClinicalLeadCandidate);
    const accessEligible = eligible.filter(candidate => candidate.cohort === 'directshifts_access');
    const nonAccessEligible = eligible.filter(candidate => candidate.cohort !== 'directshifts_access');
    const directshiftsAtOrAboveTarget =
      currentDirectshiftsShare(allocations, normalizedCandidates) >= directshiftsTargetShare - 0.001;
    const shouldCatchUpAccess =
      clinicalLeadEligible.length === 0 &&
      !directshiftsAtOrAboveTarget &&
      currentDirectshiftsShare(allocations, normalizedCandidates) < directshiftsTargetShare &&
      accessEligible.length > 0;
    const pool = clinicalLeadEligible.length > 0
      ? clinicalLeadEligible
      : shouldCatchUpAccess
        ? accessEligible
        : directshiftsAtOrAboveTarget && nonAccessEligible.length > 0
          ? nonAccessEligible
          : eligible;
    const underCap = pool.filter(candidate => {
      const allocation = allocations.get(candidate.id);
      return allocation ? allocation.acceptedHours < allocation.softCapHours - 0.001 : false;
    });
    const activePool = underCap.length > 0 ? underCap : pool;
    const candidate = [...activePool].sort((a, b) =>
      compareBulkPriority(a, b, allocations, shouldCatchUpAccess),
    )[0];
    if (!candidate) break;

    const allocation = allocations.get(candidate.id)!;
    const capRemaining = Math.max(0, allocation.softCapHours - allocation.acceptedHours);
    const capLimited = underCap.length > 0 ? capRemaining : Number.POSITIVE_INFINITY;
    const directshiftsShareLimited = hasNonAccessCandidate && candidate.cohort === 'directshifts_access'
      ? directshiftsAdditionalCapacity(allocations, normalizedCandidates, directshiftsTargetShare)
      : Number.POSITIVE_INFINITY;
    const take = Math.min(
      BULK_ALLOCATION_QUANTUM_HOURS,
      candidateRemaining(candidate, allocations),
      eligibleGapHours(candidate, stateRemaining),
      capLimited,
      directshiftsShareLimited,
    );
    if (take <= 0) break;
    allocateToCandidate(candidate, take, false);
  }

  const directshiftsShareAfter = equityRound2(currentDirectshiftsShare(allocations, normalizedCandidates) * 100);
  for (const candidate of normalizedCandidates) {
    const allocation = allocations.get(candidate.id);
    if (!allocation) continue;
    if (allocation.acceptedHours <= 0 && candidate.floorHours <= 0) {
      allocation.equityFloor = 'unmet_no_valid_shift';
    } else if (allocation.acceptedHours <= 0 && eligibleGapHours(candidate, stateRemaining) <= 0) {
      allocation.equityFloor = 'unmet_no_gap';
    }
    allocation.providerAcceptancePct = candidate.effectiveHours > 0
      ? equityRound2((allocation.acceptedHours / candidate.effectiveHours) * 100)
      : 0;
    allocation.softCapExceeded = !isClinicalLeadCandidate(candidate) &&
      allocation.acceptedHours > allocation.softCapHours + 0.001;
    allocation.directshiftsShareAfter = directshiftsShareAfter;
    allocation.acceptedHours = equityRound2(allocation.acceptedHours);
    allocation.allocations = allocation.allocations
      .filter(item => item.hours > 0)
      .sort((a, b) => a.state.localeCompare(b.state));
  }

  return normalizedCandidates
    .map(candidate => allocations.get(candidate.id)!)
    .filter(Boolean);
}

function allocateAugust2026SchedulingEquity({
  candidates,
  stateGaps,
  fairnessTolerancePct,
}: {
  candidates: SchedulingEquityCandidate[];
  stateGaps: SchedulingEquityStateGap[];
  fairnessTolerancePct: number;
}): SchedulingEquityAllocation[] {
  const normalizedCandidates = candidates
    .map(candidate => ({
      ...candidate,
      effectiveHours: equityRound2(Math.max(0, candidate.effectiveHours)),
      scarceHours: equityRound2(Math.max(0, candidate.scarceHours)),
      floorHours: equityRound2(Math.max(0, candidate.floorHours)),
      directShiftsNp: Boolean(candidate.directShiftsNp),
      submittedOnTime: candidate.submittedOnTime !== false,
      eligibleStates: candidate.eligibleStates
        .map(state => ({
          state: normalizeState(state.state),
          gapHours: equityRound2(Math.max(0, state.gapHours)),
          demandHours: equityRound2(Math.max(0, state.demandHours)),
        }))
        .filter(state => /^[A-Z]{2}$/.test(state.state)),
    }))
    .filter(candidate => candidate.effectiveHours > 0);

  const stateRemaining = new Map<string, number>();
  const stateDemand = new Map<string, number>();
  for (const gap of stateGaps) {
    const state = normalizeState(gap.state);
    if (!/^[A-Z]{2}$/.test(state)) continue;
    stateRemaining.set(state, equityRound2(Math.max(stateRemaining.get(state) ?? 0, Number(gap.gapHours ?? 0))));
    stateDemand.set(state, equityRound2(Math.max(stateDemand.get(state) ?? 0, Number(gap.demandHours ?? 0))));
  }

  const allocations = new Map<string, MutableAllocation>();
  for (const candidate of normalizedCandidates) {
    const dsFloor = augustDirectShiftsFloorHours(candidate);
    const dsTarget = augustDirectShiftsTargetHours(candidate);
    allocations.set(candidate.id, {
      id: candidate.id,
      acceptedHours: 0,
      allocations: [],
      providerAcceptancePct: 0,
      equityFloor: dsFloor > 0 || candidate.floorHours > 0 ? 'unmet_no_gap' : 'unmet_no_valid_shift',
      softCapHours: dsTarget ?? candidate.effectiveHours,
      softCapExceeded: false,
      directshiftsTargetShare: 0,
      directshiftsShareAfter: 0,
      scarceOverflowHours: 0,
      overflowHours: Math.max(0, candidate.effectiveHours - (dsTarget ?? candidate.effectiveHours)),
      directShiftsFloorHours: dsFloor,
      directShiftsTargetHours: dsTarget ?? undefined,
      fairnessTolerancePct,
      manualReviewReason: null,
      fairnessPolicyVersion: AUGUST_2026_FAIRNESS_POLICY_VERSION,
    });
  }

  const allocateToCandidate = (
    candidate: SchedulingEquityCandidate,
    requestedHours: number,
    allowOverflow: boolean,
  ) => {
    const allocation = allocations.get(candidate.id);
    if (!allocation) return { accepted: 0, overflow: 0 };
    const candidateCap = augustCandidateCap(candidate);
    let remaining = equityRound2(Math.min(
      requestedHours,
      Math.max(0, candidateCap - allocation.acceptedHours),
    ));
    if (remaining <= 0) return { accepted: 0, overflow: 0 };

    let accepted = 0;
    let overflow = 0;
    const sortedStates = statesByNeed(candidate, stateRemaining, stateDemand);
    for (const state of sortedStates) {
      if (remaining <= 0) break;
      const available = Math.max(0, stateRemaining.get(state) ?? 0);
      if (available <= 0) continue;
      const take = equityRound2(Math.min(available, remaining));
      addAllocation(allocation, state, take);
      stateRemaining.set(state, equityRound2(available - take));
      remaining = equityRound2(remaining - take);
      accepted = equityRound2(accepted + take);
    }

    if (allowOverflow && remaining > 0) {
      const fallbackState = fallbackStateFor(candidate, stateDemand);
      if (fallbackState) {
        addAllocation(allocation, fallbackState, remaining);
        accepted = equityRound2(accepted + remaining);
        overflow = remaining;
        remaining = 0;
      }
    }

    allocation.acceptedHours = equityRound2(allocation.acceptedHours + accepted);
    allocation.scarceOverflowHours = equityRound2((allocation.scarceOverflowHours ?? 0) + overflow);
    if (allocation.acceptedHours > 0) allocation.equityFloor = 'met';
    return { accepted, overflow };
  };

  const candidatesByPriority = [...normalizedCandidates].sort(compareBaseCandidatePriority);

  for (const candidate of candidatesByPriority) {
    if (!isClinicalLeadCandidate(candidate)) continue;
    allocateToCandidate(candidate, candidate.effectiveHours, false);
  }

  for (const candidate of candidatesByPriority) {
    const floor = augustDirectShiftsFloorHours(candidate);
    if (floor <= 0) continue;
    allocateToCandidate(candidate, floor, true);
  }

  for (const candidate of candidatesByPriority) {
    if (isClinicalLeadCandidate(candidate)) continue;
    const remaining = augustCandidateCap(candidate) - (allocations.get(candidate.id)?.acceptedHours ?? 0);
    if (remaining <= 0) continue;
    allocateToCandidate(candidate, remaining, false);
  }

  applyAugustFairnessGuard({
    candidates: normalizedCandidates,
    allocations,
    stateRemaining,
    stateDemand,
    tolerancePct: fairnessTolerancePct,
  });

  for (const candidate of normalizedCandidates) {
    const allocation = allocations.get(candidate.id);
    if (!allocation) continue;
    const compatibleGapRemaining = eligibleGapHours(candidate, stateRemaining);
    if (allocation.acceptedHours <= 0 && augustDirectShiftsFloorHours(candidate) > 0) {
      allocation.manualReviewReason = 'directshifts_np_floor_unmet';
      allocation.equityFloor = 'unmet_no_gap';
    } else if (allocation.acceptedHours <= 0 && compatibleGapRemaining > 0.001) {
      allocation.manualReviewReason = 'zero_hours_with_compatible_state_gap';
      allocation.equityFloor = 'unmet_no_valid_shift';
    } else if (allocation.acceptedHours <= 0 && allocation.equityFloor !== 'unmet_no_valid_shift') {
      allocation.equityFloor = 'unmet_no_gap';
    }
    allocation.providerAcceptancePct = candidate.effectiveHours > 0
      ? equityRound2((allocation.acceptedHours / candidate.effectiveHours) * 100)
      : 0;
    allocation.softCapExceeded = false;
    allocation.directshiftsShareAfter = 0;
    allocation.acceptedHours = equityRound2(allocation.acceptedHours);
    allocation.overflowHours = equityRound2(Math.max(0, candidate.effectiveHours - allocation.acceptedHours));
    allocation.allocations = allocation.allocations
      .filter(item => item.hours > 0)
      .sort((a, b) => a.state.localeCompare(b.state));
  }

  return normalizedCandidates
    .map(candidate => allocations.get(candidate.id)!)
    .filter(Boolean);
}

function applyAugustFairnessGuard({
  candidates,
  allocations,
  stateRemaining,
  stateDemand,
  tolerancePct,
}: {
  candidates: SchedulingEquityCandidate[];
  allocations: Map<string, MutableAllocation>;
  stateRemaining: Map<string, number>;
  stateDemand: Map<string, number>;
  tolerancePct: number;
}) {
  const rankTwo = candidates.filter(candidate => !isClinicalLeadCandidate(candidate));
  const totalSubmitted = candidates.reduce((sum, candidate) => sum + candidate.effectiveHours, 0);
  if (totalSubmitted <= 0 || rankTwo.length === 0) return;

  const tolerance = tolerancePct / 100;
  let guard = 0;
  while (guard < 200) {
    guard += 1;
    const totalAccepted = candidates.reduce((sum, candidate) => (
      sum + (allocations.get(candidate.id)?.acceptedHours ?? 0)
    ), 0);
    const fillRate = totalAccepted / totalSubmitted;
    const hasUnderAllocatedProvider = rankTwo.some(candidate => {
      const allocation = allocations.get(candidate.id);
      if (!allocation || candidate.effectiveHours <= 0) return false;
      const acceptedRate = allocation.acceptedHours / candidate.effectiveHours;
      return acceptedRate < fillRate - tolerance - 0.001 &&
        candidateRemainingForAugust(candidate, allocations) > 0.001;
    });
    const over = rankTwo
      .filter(candidate => {
        const allocation = allocations.get(candidate.id);
        if (!allocation || candidate.effectiveHours <= 0) return false;
        const acceptedRate = allocation.acceptedHours / candidate.effectiveHours;
        const floorRate = augustDirectShiftsFloorHours(candidate) / candidate.effectiveHours;
        const triggerRate = hasUnderAllocatedProvider ? fillRate : fillRate + tolerance;
        return acceptedRate > triggerRate + 0.001 &&
          acceptedRate > floorRate + 0.001;
      })
      .sort((a, b) => (
        ((allocations.get(b.id)?.acceptedHours ?? 0) / b.effectiveHours) -
        ((allocations.get(a.id)?.acceptedHours ?? 0) / a.effectiveHours)
      ))[0];
    if (!over) break;

    const overAllocation = allocations.get(over.id);
    if (!overAllocation) break;
    const floor = augustDirectShiftsFloorHours(over);
    const capRate = hasUnderAllocatedProvider ? fillRate : fillRate + tolerance;
    const cap = equityRound2(Math.max(floor, over.effectiveHours * capRate));
    const reducible = equityRound2(overAllocation.acceptedHours - cap);
    if (reducible <= 0.001) break;
    const freed = reduceAllocation(overAllocation, reducible, stateRemaining);
    if (freed <= 0.001) break;

    let freedRemaining = freed;
    const under = rankTwo
      .filter(candidate => {
        const allocation = allocations.get(candidate.id);
        if (!allocation || candidate.effectiveHours <= 0) return false;
        const acceptedRate = allocation.acceptedHours / candidate.effectiveHours;
        return acceptedRate < fillRate - 0.001 &&
          candidateRemainingForAugust(candidate, allocations) > 0.001;
      })
      .sort(compareBaseCandidatePriority);
    for (const candidate of under) {
      if (freedRemaining <= 0.001) break;
      const accepted = allocateFreedAugustHours(
        candidate,
        freedRemaining,
        allocations,
        stateRemaining,
        stateDemand,
      );
      freedRemaining = equityRound2(freedRemaining - accepted);
    }

    if (freedRemaining > 0.001) {
      const overNow = allocations.get(over.id);
      if (overNow) restoreAllocationToOriginalStates(overNow, over, freedRemaining, stateRemaining, stateDemand);
      break;
    }
  }
}

function allocateFreedAugustHours(
  candidate: SchedulingEquityCandidate,
  requestedHours: number,
  allocations: Map<string, MutableAllocation>,
  stateRemaining: Map<string, number>,
  stateDemand: Map<string, number>,
) {
  const allocation = allocations.get(candidate.id);
  if (!allocation) return 0;
  let remaining = equityRound2(Math.min(requestedHours, candidateRemainingForAugust(candidate, allocations)));
  if (remaining <= 0) return 0;
  let accepted = 0;
  for (const state of statesByNeed(candidate, stateRemaining, stateDemand)) {
    if (remaining <= 0) break;
    const available = Math.max(0, stateRemaining.get(state) ?? 0);
    if (available <= 0) continue;
    const take = equityRound2(Math.min(available, remaining));
    addAllocation(allocation, state, take);
    stateRemaining.set(state, equityRound2(available - take));
    allocation.acceptedHours = equityRound2(allocation.acceptedHours + take);
    remaining = equityRound2(remaining - take);
    accepted = equityRound2(accepted + take);
  }
  if (allocation.acceptedHours > 0) allocation.equityFloor = 'met';
  return accepted;
}

function reduceAllocation(
  allocation: MutableAllocation,
  requestedReduction: number,
  stateRemaining: Map<string, number>,
) {
  let remaining = equityRound2(requestedReduction);
  let reduced = 0;
  const ordered = [...allocation.allocations].sort((a, b) =>
    a.state.localeCompare(b.state),
  );
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (remaining <= 0) break;
    const item = ordered[index];
    const take = equityRound2(Math.min(item.hours, remaining));
    if (take <= 0) continue;
    item.hours = equityRound2(item.hours - take);
    stateRemaining.set(item.state, equityRound2((stateRemaining.get(item.state) ?? 0) + take));
    remaining = equityRound2(remaining - take);
    reduced = equityRound2(reduced + take);
  }
  allocation.allocations = ordered.filter(item => item.hours > 0);
  allocation.acceptedHours = equityRound2(Math.max(0, allocation.acceptedHours - reduced));
  return reduced;
}

function restoreAllocationToOriginalStates(
  allocation: MutableAllocation,
  candidate: SchedulingEquityCandidate,
  hours: number,
  stateRemaining: Map<string, number>,
  stateDemand: Map<string, number>,
) {
  let remaining = equityRound2(Math.min(hours, candidateRemainingForAugust(candidate, new Map([[candidate.id, allocation]]))));
  for (const state of statesByNeed(candidate, stateRemaining, stateDemand)) {
    if (remaining <= 0) break;
    const available = Math.max(0, stateRemaining.get(state) ?? 0);
    if (available <= 0) continue;
    const take = equityRound2(Math.min(available, remaining));
    addAllocation(allocation, state, take);
    stateRemaining.set(state, equityRound2(available - take));
    allocation.acceptedHours = equityRound2(allocation.acceptedHours + take);
    remaining = equityRound2(remaining - take);
  }
}

function augustCandidateCap(candidate: SchedulingEquityCandidate) {
  const target = augustDirectShiftsTargetHours(candidate);
  return target ?? candidate.effectiveHours;
}

function augustDirectShiftsFloorHours(candidate: SchedulingEquityCandidate) {
  if (!candidate.directShiftsNp || candidate.submittedOnTime === false) return 0;
  if (candidate.effectiveHours < AUGUST_2026_DIRECTSHIFTS_NP_MIN_HOURS) {
    return candidate.effectiveHours;
  }
  return AUGUST_2026_DIRECTSHIFTS_NP_MIN_HOURS;
}

function augustDirectShiftsTargetHours(candidate: SchedulingEquityCandidate) {
  if (!candidate.directShiftsNp || candidate.submittedOnTime === false) return null;
  if (candidate.effectiveHours <= AUGUST_2026_DIRECTSHIFTS_NP_TARGET_HOURS) {
    return candidate.effectiveHours;
  }
  return AUGUST_2026_DIRECTSHIFTS_NP_TARGET_HOURS;
}

function candidateRemainingForAugust(
  candidate: SchedulingEquityCandidate,
  allocations: Map<string, MutableAllocation>,
) {
  return equityRound2(Math.max(
    0,
    augustCandidateCap(candidate) - (allocations.get(candidate.id)?.acceptedHours ?? 0),
  ));
}

function compareBaseCandidatePriority(
  a: SchedulingEquityCandidate,
  b: SchedulingEquityCandidate,
) {
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
  const rateA = a.hourlyRate ?? Number.POSITIVE_INFINITY;
  const rateB = b.hourlyRate ?? Number.POSITIVE_INFINITY;
  if (rateA !== rateB) return rateA - rateB;
  const utilizationA = a.utilizationPct ?? null;
  const utilizationB = b.utilizationPct ?? null;
  if (utilizationA != null || utilizationB != null) {
    const utilSortA = utilizationA ?? Number.NEGATIVE_INFINITY;
    const utilSortB = utilizationB ?? Number.NEGATIVE_INFINITY;
    if (utilSortA !== utilSortB) return utilSortB - utilSortA;
  }
  const countA = a.eligibleStates.length;
  const countB = b.eligibleStates.length;
  if (countA !== countB) return countA - countB;
  return a.providerName.localeCompare(b.providerName, undefined, { sensitivity: 'base' });
}

function isClinicalLeadCandidate(candidate: SchedulingEquityCandidate) {
  return candidate.cohort === 'clinical_lead' || candidate.priorityRank === 0;
}

function compareEquityFloorPriority(
  a: SchedulingEquityCandidate,
  b: SchedulingEquityCandidate,
  allocations: Map<string, MutableAllocation>,
  targetShare: number,
) {
  const accessDeficit = currentDirectshiftsShare(allocations, [a, b]) < targetShare;
  if (accessDeficit && a.cohort !== b.cohort) {
    if (a.cohort === 'directshifts_access') return -1;
    if (b.cohort === 'directshifts_access') return 1;
  }
  return compareBaseCandidatePriority(a, b);
}

function compareBulkPriority(
  a: SchedulingEquityCandidate,
  b: SchedulingEquityCandidate,
  allocations: Map<string, MutableAllocation>,
  accessCatchUp: boolean,
) {
  if (a.cohort === 'directshifts_access' && b.cohort === 'directshifts_access') {
    const rateA = a.hourlyRate ?? Number.POSITIVE_INFINITY;
    const rateB = b.hourlyRate ?? Number.POSITIVE_INFINITY;
    if (rateA === rateB) {
      const pctDiff = acceptedPct(a, allocations) - acceptedPct(b, allocations);
      if (Math.abs(pctDiff) > 0.001) return pctDiff;
    }
  }
  if (accessCatchUp) {
    const pctDiff = acceptedPct(a, allocations) - acceptedPct(b, allocations);
    if (Math.abs(pctDiff) > 0.001) return pctDiff;
  }
  return compareBaseCandidatePriority(a, b);
}

function acceptedPct(
  candidate: SchedulingEquityCandidate,
  allocations: Map<string, MutableAllocation>,
) {
  const accepted = allocations.get(candidate.id)?.acceptedHours ?? 0;
  return candidate.effectiveHours > 0 ? accepted / candidate.effectiveHours : 1;
}

function candidateRemaining(
  candidate: SchedulingEquityCandidate,
  allocations: Map<string, MutableAllocation>,
) {
  return equityRound2(Math.max(0, candidate.effectiveHours - (allocations.get(candidate.id)?.acceptedHours ?? 0)));
}

function eligibleGapHours(
  candidate: SchedulingEquityCandidate,
  stateRemaining: Map<string, number>,
) {
  return equityRound2(candidate.eligibleStates.reduce(
    (sum, state) => sum + Math.max(0, stateRemaining.get(state.state) ?? 0),
    0,
  ));
}

function totalRemainingGap(stateRemaining: Map<string, number>) {
  let total = 0;
  for (const value of stateRemaining.values()) total += Math.max(0, value);
  return equityRound2(total);
}

function currentDirectshiftsShare(
  allocations: Map<string, MutableAllocation>,
  candidates: SchedulingEquityCandidate[],
) {
  let total = 0;
  let access = 0;
  for (const candidate of candidates) {
    const accepted = allocations.get(candidate.id)?.acceptedHours ?? 0;
    total += accepted;
    if (candidate.cohort === 'directshifts_access') access += accepted;
  }
  return total > 0 ? access / total : 0;
}

function directshiftsAdditionalCapacity(
  allocations: Map<string, MutableAllocation>,
  candidates: SchedulingEquityCandidate[],
  targetShare: number,
) {
  if (targetShare >= 1) return Number.POSITIVE_INFINITY;
  let access = 0;
  let nonAccess = 0;
  for (const candidate of candidates) {
    const accepted = allocations.get(candidate.id)?.acceptedHours ?? 0;
    if (candidate.cohort === 'directshifts_access') access += accepted;
    else nonAccess += accepted;
  }
  const maxAccess = (targetShare / Math.max(0.001, 1 - targetShare)) * nonAccess;
  return equityRound2(Math.max(0, maxAccess - access));
}

function statesByNeed(
  candidate: SchedulingEquityCandidate,
  stateRemaining: Map<string, number>,
  stateDemand: Map<string, number>,
) {
  return candidate.eligibleStates
    .map(state => state.state)
    .sort((a, b) =>
      (stateRemaining.get(b) ?? 0) - (stateRemaining.get(a) ?? 0) ||
      (stateDemand.get(b) ?? 0) - (stateDemand.get(a) ?? 0) ||
      a.localeCompare(b),
    );
}

function fallbackStateFor(
  candidate: SchedulingEquityCandidate,
  stateDemand: Map<string, number>,
) {
  return candidate.eligibleStates
    .map(state => state.state)
    .sort((a, b) =>
      (stateDemand.get(b) ?? 0) - (stateDemand.get(a) ?? 0) ||
      a.localeCompare(b),
    )[0] ?? null;
}

function addAllocation(
  allocation: MutableAllocation,
  state: string,
  hours: number,
) {
  const rounded = equityRound2(hours);
  if (rounded <= 0) return;
  const existing = allocation.allocations.find(item => item.state === state);
  if (existing) {
    existing.hours = equityRound2(existing.hours + rounded);
  } else {
    allocation.allocations.push({ state, hours: rounded });
  }
}

function normalizeState(state: string) {
  return (state ?? '').trim().toUpperCase();
}

function equityRound2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
