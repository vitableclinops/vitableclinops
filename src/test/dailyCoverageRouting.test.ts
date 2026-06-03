import { describe, expect, it } from 'vitest';
import {
  routeDailyCoverage,
  canCoverState,
  SD_ND_BOOKED_APPOINTMENT_HOURS,
  type RoutingInput,
} from '@/lib/scheduling/dailyCoverageRouting';
import { canonicalName } from '@/lib/nameNormalization';

const base = (overrides: Partial<RoutingInput> = {}): RoutingInput => ({
  date: '2026-06-02',
  demand: [],
  providers: [],
  booked: [],
  ...overrides,
});

const stateRow = (result: ReturnType<typeof routeDailyCoverage>, state: string) =>
  result.stateCoverage.find((r) => r.state === state)!;

describe('canCoverState', () => {
  it('lets any provider cover a non-restricted state', () => {
    expect(canCoverState('NP', 'PA')).toBe(true);
    expect(canCoverState('MD', 'PA')).toBe(true);
  });

  it('reserves MD-only states for physicians', () => {
    expect(canCoverState('NP', 'GA')).toBe(false);
    expect(canCoverState('MD', 'GA')).toBe(true);
    expect(canCoverState('DO', 'TN')).toBe(true);
    expect(canCoverState('mental_health_coach', 'AL')).toBe(false);
  });
});

describe('canonicalName', () => {
  it('strips CRNP credentials from Homebase names', () => {
    expect(canonicalName('Van Tu, CRNP')).toBe('van tu');
  });
});

describe('routeDailyCoverage', () => {
  it('marks a fully covered state OK from confirmed free capacity', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'PA', demand_hours: 8, source: 'daily_card' }],
        providers: [
          {
            profile_id: 'p1',
            name: 'Ada Provider',
            profession: 'NP',
            scheduled_hours: 8,
            licensed_states: ['PA'],
            ehr_active_states: ['PA'],
          },
        ],
      }),
    );
    const pa = stateRow(result, 'PA');
    expect(pa.status).toBe('ok');
    expect(pa.confirmed_coverage_hours).toBe(8);
    expect(pa.gap_hours).toBe(0);
    expect(result.totals.ok).toBe(1);
    // The assignment surfaces as a move.
    expect(result.moves).toEqual([{ profile_id: 'p1', name: 'Ada Provider', state: 'PA', hours: 8 }]);
  });

  it('reports a partial gap as LOW or CRITICAL based on the confirmed ratio', () => {
    const result = routeDailyCoverage(
      base({
        demand: [
          { state: 'PA', demand_hours: 10, source: 'daily_card' },
          { state: 'OH', demand_hours: 10, source: 'daily_card' },
        ],
        providers: [
          { profile_id: 'p1', name: 'P One', profession: 'NP', scheduled_hours: 6, licensed_states: ['PA'], ehr_active_states: ['PA'] },
          { profile_id: 'p2', name: 'P Two', profession: 'NP', scheduled_hours: 4, licensed_states: ['OH'], ehr_active_states: ['OH'] },
        ],
      }),
    );
    const pa = stateRow(result, 'PA');
    const oh = stateRow(result, 'OH');
    expect(pa.status).toBe('low'); // 6/10 = 0.6
    expect(pa.gap_hours).toBe(4);
    expect(oh.status).toBe('critical'); // 4/10 = 0.4
    expect(oh.gap_hours).toBe(6);
  });

  it('marks a state with no scheduled coverage ZERO', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'TX', demand_hours: 12, source: 'daily_card' }],
        providers: [
          { profile_id: 'p1', name: 'P One', profession: 'NP', scheduled_hours: 8, licensed_states: ['PA'], ehr_active_states: ['PA'] },
        ],
      }),
    );
    const tx = stateRow(result, 'TX');
    expect(tx.status).toBe('zero');
    expect(tx.confirmed_coverage_hours).toBe(0);
    expect(tx.gap_hours).toBe(12);
  });

  it('locks booked appointments against both provider capacity and demand before routing', () => {
    const result = routeDailyCoverage(
      base({
        demand: [
          { state: 'PA', demand_hours: 8, source: 'daily_card' },
          { state: 'NJ', demand_hours: 8, source: 'daily_card' },
        ],
        providers: [
          {
            profile_id: 'p1',
            name: 'Booked Provider',
            profession: 'NP',
            scheduled_hours: 8,
            licensed_states: ['PA', 'NJ'],
            ehr_active_states: ['PA', 'NJ'],
          },
        ],
        booked: [
          // 4 booked appointments in PA, no explicit hours → 4 * 0.5 = 2h
          { profile_id: 'p1', provider_name: 'Booked Provider', state: 'PA', appointment_count: 4, booked_hours: null },
        ],
      }),
    );
    const lock = result.bookedLocks.find((l) => l.matched);
    expect(lock?.hours).toBe(4 * SD_ND_BOOKED_APPOINTMENT_HOURS);
    expect(lock?.source).toBe('appointment_estimate');

    const pa = stateRow(result, 'PA');
    expect(pa.booked_locked_hours).toBe(2);
    // provider had 8h, 2h locked to PA, 6h free. PA needs 6 more, NJ needs 8.
    // greedy fills the larger gap (NJ=8) first with all 6 free hours.
    const nj = stateRow(result, 'NJ');
    expect(nj.confirmed_assigned_hours).toBe(6);
    expect(pa.confirmed_coverage_hours).toBe(2); // booked only; no free left for PA
    const assignment = result.providerAssignments.find((a) => a.profile_id === 'p1')!;
    expect(assignment.booked_locked_hours).toBe(2);
    expect(assignment.unassigned_free_hours).toBe(0);
  });

  it('uses metabase booked_hours when present instead of the 0.5h estimate', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'PA', demand_hours: 8, source: 'daily_card' }],
        providers: [
          { profile_id: 'p1', name: 'P One', profession: 'NP', scheduled_hours: 8, licensed_states: ['PA'], ehr_active_states: ['PA'] },
        ],
        booked: [{ profile_id: 'p1', provider_name: 'P One', state: 'PA', appointment_count: 4, booked_hours: 3.5 }],
      }),
    );
    const lock = result.bookedLocks.find((l) => l.matched)!;
    expect(lock.hours).toBe(3.5);
    expect(lock.source).toBe('metabase_booked_hours');
    expect(stateRow(result, 'PA').booked_locked_hours).toBe(3.5);
  });

  it('computes tentative-only upside without counting it toward status', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'FL', demand_hours: 8, source: 'daily_card' }],
        providers: [
          {
            profile_id: 'p1',
            name: 'Licensed Not Live',
            profession: 'NP',
            scheduled_hours: 6,
            licensed_states: ['FL'],
            ehr_active_states: [], // licensed but not EHR-live → tentative only
          },
        ],
      }),
    );
    const fl = stateRow(result, 'FL');
    expect(fl.status).toBe('zero'); // no confirmed coverage
    expect(fl.confirmed_coverage_hours).toBe(0);
    expect(fl.tentative_upside_hours).toBe(6); // 6 free hours could close part of the 8h gap
    expect(fl.gap_hours).toBe(8);
    // Surfaces as a tentative add recommendation.
    const add = result.adds.find((a) => a.state === 'FL' && a.profile_id === 'p1');
    expect(add?.tentative).toBe(true);
    expect(add?.source).toBe('tentative_scheduled');
  });

  it('caps tentative upside at the remaining gap', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'FL', demand_hours: 4, source: 'daily_card' }],
        providers: [
          { profile_id: 'p1', name: 'A', profession: 'NP', scheduled_hours: 6, licensed_states: ['FL'], ehr_active_states: [] },
          { profile_id: 'p2', name: 'B', profession: 'NP', scheduled_hours: 6, licensed_states: ['FL'], ehr_active_states: [] },
        ],
      }),
    );
    // 12h of tentative capacity but only a 4h gap.
    expect(stateRow(result, 'FL').tentative_upside_hours).toBe(4);
  });

  it('respects MD-only state restrictions for NPs even when licensed and EHR-live', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'GA', demand_hours: 8, source: 'daily_card' }],
        providers: [
          {
            profile_id: 'np1',
            name: 'NP In Georgia',
            profession: 'NP',
            scheduled_hours: 8,
            licensed_states: ['GA'],
            ehr_active_states: ['GA'],
          },
          {
            profile_id: 'md1',
            name: 'MD In Georgia',
            profession: 'MD',
            scheduled_hours: 5,
            licensed_states: ['GA'],
            ehr_active_states: ['GA'],
          },
        ],
      }),
    );
    const ga = stateRow(result, 'GA');
    // Only the MD's 5h counts; the NP is scope-ineligible in GA.
    expect(ga.confirmed_coverage_hours).toBe(5);
    expect(ga.status).toBe('low');
    const moveProviders = result.moves.filter((m) => m.state === 'GA').map((m) => m.profile_id);
    expect(moveProviders).toEqual(['md1']);
    expect(moveProviders).not.toContain('np1');
  });

  it('preserves unmatched Homebase employees and booked rows as warnings only', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'PA', demand_hours: 8, source: 'daily_card' }],
        providers: [
          { profile_id: 'p1', name: 'P One', profession: 'NP', scheduled_hours: 4, licensed_states: ['PA'], ehr_active_states: ['PA'] },
        ],
        unmatchedShifts: [{ name: 'Mystery Employee', scheduled_hours: 6 }],
        booked: [{ profile_id: null, provider_name: 'Ghost Provider', state: 'PA', appointment_count: 2, booked_hours: null }],
      }),
    );
    const pa = stateRow(result, 'PA');
    // Unmatched shift hours do NOT count as capacity; unmatched booked does NOT
    // reduce demand. Only the matched 4h count.
    expect(pa.confirmed_coverage_hours).toBe(4);
    expect(pa.booked_locked_hours).toBe(0);

    const warnTypes = result.warnings.map((w) => w.type).sort();
    expect(warnTypes).toContain('unmatched_homebase_employee');
    expect(warnTypes).toContain('unmatched_booked_appointment');
    const ghostLock = result.bookedLocks.find((l) => l.provider_name === 'Ghost Provider');
    expect(ghostLock?.matched).toBe(false);
  });

  it('flags missing Metabase demand as NO DATA', () => {
    const result = routeDailyCoverage(
      base({
        demand: [
          { state: 'PA', demand_hours: 8, source: 'daily_card' },
          { state: 'OH', demand_hours: null, source: 'none' },
        ],
        providers: [
          { profile_id: 'p1', name: 'P One', profession: 'NP', scheduled_hours: 8, licensed_states: ['PA', 'OH'], ehr_active_states: ['PA', 'OH'] },
        ],
      }),
    );
    const oh = stateRow(result, 'OH');
    expect(oh.status).toBe('no_data');
    expect(oh.demand_hours).toBeNull();
    expect(oh.coverage_ratio).toBeNull();
    expect(result.totals.no_data).toBe(1);
  });

  it('orders providers with fewer confirmed shortage states first', () => {
    const result = routeDailyCoverage(
      base({
        demand: [
          { state: 'PA', demand_hours: 4, source: 'daily_card' },
          { state: 'NJ', demand_hours: 4, source: 'daily_card' },
        ],
        providers: [
          // Flexible provider can serve both states.
          { profile_id: 'flex', name: 'Flexible', profession: 'NP', scheduled_hours: 4, licensed_states: ['PA', 'NJ'], ehr_active_states: ['PA', 'NJ'] },
          // Constrained provider can only serve PA.
          { profile_id: 'fixed', name: 'Fixed', profession: 'NP', scheduled_hours: 4, licensed_states: ['PA'], ehr_active_states: ['PA'] },
        ],
      }),
    );
    // Constrained (PA-only) provider should take PA; flexible fills NJ.
    const paMove = result.moves.find((m) => m.state === 'PA');
    const njMove = result.moves.find((m) => m.state === 'NJ');
    expect(paMove?.profile_id).toBe('fixed');
    expect(njMove?.profile_id).toBe('flex');
    expect(stateRow(result, 'PA').status).toBe('ok');
    expect(stateRow(result, 'NJ').status).toBe('ok');
  });

  it('recommends Jotform availability and low-utilization adds for residual gaps', () => {
    const result = routeDailyCoverage(
      base({
        demand: [{ state: 'TX', demand_hours: 8, source: 'daily_card' }],
        providers: [],
        addCandidates: [
          {
            profile_id: 'avail1',
            name: 'Available Provider',
            profession: 'NP',
            available_hours: 5,
            licensed_states: ['TX'],
            ehr_active_states: ['TX'],
            source: 'jotform_availability',
          },
          {
            profile_id: 'lowutil1',
            name: 'Low Util Provider',
            profession: 'NP',
            available_hours: null,
            licensed_states: ['TX'],
            ehr_active_states: ['TX'],
            source: 'low_utilization',
            utilization_pct: 12,
          },
          {
            // not licensed in TX → must be excluded
            profile_id: 'other',
            name: 'Other Provider',
            profession: 'NP',
            available_hours: 5,
            licensed_states: ['PA'],
            ehr_active_states: ['PA'],
            source: 'jotform_availability',
          },
        ],
      }),
    );
    const txAdds = result.adds.filter((a) => a.state === 'TX');
    expect(txAdds.map((a) => a.profile_id)).toEqual(['avail1', 'lowutil1']);
    expect(txAdds[0].source).toBe('jotform_availability');
    expect(txAdds[1].source).toBe('low_utilization');
  });
});
