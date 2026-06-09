import { describe, expect, it } from 'vitest';
import {
  COST_MH_VISIT_SLOTS_PER_HOUR,
  buildSchedulingCostModel,
  protectedAccessHoursFromDecisionNotes,
  rateFromDecisionNotes,
  routingSynopsisTags,
  selectRateForProviderMonth,
  visitSlotsPerHourForCost,
} from '@/lib/scheduling/costPerVisit';

describe('scheduling cost per visit', () => {
  it('uses accepted hours, two slots per hour, and 70% target utilization', () => {
    const model = buildSchedulingCostModel({
      monthStart: '2026-07-01',
      rows: [
        {
          provider_id: 'p1',
          provider_name: 'Lower Rate Provider',
          decision_status: 'accepted',
          accepted_hours: 10,
          declined_hours: 0,
          decision_notes: 'provider_hourly_rate=100; provider_rate_policy=clinical_leads_then_hourly_rate_then_directshifts_share',
        },
        {
          provider_id: 'p2',
          provider_name: 'Table Rate Provider',
          decision_status: 'partial',
          accepted_hours: 5,
          declined_hours: 5,
          decision_notes: 'Trimmed as oversupply',
        },
      ],
      payRates: [
        {
          provider_id: 'p2',
          hourly_rate: 140,
          effective_from: '2026-07-01',
          effective_to: null,
          source: 'manual_workbench',
        },
      ],
    });

    expect(model.totalApprovedHours).toBe(15);
    expect(model.totalAvailableSlots).toBe(30);
    expect(model.totalTargetUtilizedVisits).toBe(21);
    expect(model.totalKnownWageCost).toBe(1700);
    expect(model.costPerVisitAtTarget).toBeCloseTo(80.952, 3);
  });

  it('prefers the decision-note rate over provider_pay_rates', () => {
    const model = buildSchedulingCostModel({
      monthStart: '2026-07-01',
      rows: [
        {
          provider_id: 'p1',
          provider_name: 'Decision Rate Provider',
          decision_status: 'accepted',
          accepted_hours: 4,
          declined_hours: 0,
          decision_notes: 'provider_hourly_rate=125',
        },
      ],
      payRates: [
        {
          provider_id: 'p1',
          hourly_rate: 300,
          effective_from: '2026-07-01',
          effective_to: null,
          source: 'homebase_role',
        },
      ],
    });

    expect(rateFromDecisionNotes('provider_hourly_rate=125')).toBe(125);
    expect(model.providerRows[0].hourlyRate).toBe(125);
    expect(model.providerRows[0].rateSource).toBe('decision_note');
    expect(model.totalKnownWageCost).toBe(500);
  });

  it('excludes missing-rate accepted hours from CPV while keeping total slot capacity visible', () => {
    const model = buildSchedulingCostModel({
      monthStart: '2026-07-01',
      rows: [
        {
          provider_id: 'known',
          provider_name: 'Known Rate',
          decision_status: 'accepted',
          accepted_hours: 10,
          declined_hours: 0,
          decision_notes: 'provider_hourly_rate=100',
        },
        {
          provider_id: 'missing',
          provider_name: 'Missing Rate',
          decision_status: 'accepted',
          accepted_hours: 10,
          declined_hours: 0,
          decision_notes: 'provider_hourly_rate=missing',
        },
      ],
      payRates: [],
    });

    expect(model.totalApprovedHours).toBe(20);
    expect(model.totalAvailableSlots).toBe(40);
    expect(model.knownRateHours).toBe(10);
    expect(model.missingRateHours).toBe(10);
    expect(model.missingRateRows).toHaveLength(1);
    expect(model.costPerVisitAtTarget).toBeCloseTo(1000 / 14, 3);
  });

  it('uses 3 visits per 2.5h block for mental health CPV capacity except Matthew Vazquez', () => {
    const model = buildSchedulingCostModel({
      monthStart: '2026-07-01',
      rows: [
        {
          provider_id: 'therapy',
          provider_name: 'Mishelle Lockerby',
          profession: 'Therapist',
          decision_status: 'accepted',
          accepted_hours: 20,
          declined_hours: 0,
          decision_notes: 'provider_hourly_rate=100',
        },
        {
          provider_id: 'matthew',
          provider_name: 'Matthew Vazquez',
          profession: 'Mental Health Coach',
          decision_status: 'accepted',
          accepted_hours: 10,
          declined_hours: 0,
          decision_notes: 'provider_hourly_rate=100',
        },
      ],
      payRates: [],
    });

    const therapy = model.providerRows.find(row => row.provider_id === 'therapy');
    const matthew = model.providerRows.find(row => row.provider_id === 'matthew');

    expect(visitSlotsPerHourForCost({
      provider_name: 'Mishelle Lockerby',
      profession: 'Therapist',
    }).slotsPerHour).toBe(COST_MH_VISIT_SLOTS_PER_HOUR);
    expect(therapy?.availableSlots).toBe(24);
    expect(therapy?.targetUtilizedVisits).toBeCloseTo(16.8, 3);
    expect(therapy?.costPerVisitAtTarget).toBeCloseTo(2000 / 16.8, 3);
    expect(matthew?.availableSlots).toBe(20);
    expect(matthew?.visitSlotModel).toBe('standard');
    expect(model.totalAvailableSlots).toBe(44);
    expect(model.knownRateTargetUtilizedVisits).toBeCloseTo(30.8, 3);
  });

  it('selects the month-active lowest rate when decision notes do not have a rate', () => {
    const selected = selectRateForProviderMonth(
      [
        {
          provider_id: 'p1',
          hourly_rate: 160,
          effective_from: '2026-06-01',
          effective_to: null,
          source: 'homebase_role',
        },
        {
          provider_id: 'p1',
          hourly_rate: 140,
          effective_from: '2026-07-01',
          effective_to: null,
          source: 'manual_workbench',
        },
        {
          provider_id: 'p1',
          hourly_rate: 90,
          effective_from: '2026-08-01',
          effective_to: null,
          source: 'future',
        },
      ],
      'p1',
      '2026-07-01',
    );

    expect(selected?.hourly_rate).toBe(140);
  });

  it('summarizes routing notes into concise decision tags', () => {
    const tags = routingSynopsisTags(
      [
        'provider_rate_policy=clinical_leads_then_hourly_rate_then_directshifts_share',
        'provider_utilization_policy=lower_utilization_secondary_after_rate',
        'Trimmed as oversupply — accepted hours capped at network demand',
        'scarce_window_policy=protected_before_monthly_trim',
      ].join('; '),
      'partial',
      8,
      4,
      'decision_note',
    );

    expect(tags).toContain('Lowest-rate routing');
    expect(tags).toContain('Higher-rate/capacity cut');
    expect(tags).toContain('Utilization tiebreak');
    expect(tags).toContain('Protected access');
  });

  it('counts only explicitly protected access hours instead of all accepted hours', () => {
    const notes = [
      'provider_hourly_rate=100',
      'scarce_window_policy=protected_before_monthly_trim',
      'scarce_window_hours=4h',
      'access_buffer_used_hours=2h',
    ].join('; ');
    const model = buildSchedulingCostModel({
      monthStart: '2026-07-01',
      rows: [
        {
          provider_id: 'p1',
          provider_name: 'Protected Slice Provider',
          decision_status: 'accepted',
          accepted_hours: 100,
          declined_hours: 0,
          decision_notes: notes,
        },
      ],
      payRates: [],
    });

    expect(protectedAccessHoursFromDecisionNotes(notes)).toBe(6);
    expect(model.highlights.protectedAccessProviders).toBe(1);
    expect(model.highlights.protectedAccessHours).toBe(6);
  });

  it('summarizes scheduling equity notes for DirectShifts/access and soft caps', () => {
    const model = buildSchedulingCostModel({
      monthStart: '2026-07-01',
      rows: [
        {
          provider_id: 'ds-1',
          provider_name: 'DirectShifts One',
          decision_status: 'partial',
          accepted_hours: 20,
          declined_hours: 20,
          decision_notes: [
            'provider_hourly_rate=80',
            'cohort=directshifts_access',
            'directshifts_target_share=15',
            'provider_acceptance_pct=50',
            'equity_floor=met',
            'soft_cap_exceeded=0',
          ].join('; '),
        },
        {
          provider_id: 'ds-2',
          provider_name: 'DirectShifts Two',
          decision_status: 'partial',
          accepted_hours: 18,
          declined_hours: 22,
          decision_notes: [
            'provider_hourly_rate=80',
            'cohort=directshifts_access',
            'provider_acceptance_pct=45',
            'equity_floor=met',
          ].join('; '),
        },
        {
          provider_id: 'standard',
          provider_name: 'Standard Provider',
          decision_status: 'accepted',
          accepted_hours: 62,
          declined_hours: 0,
          decision_notes: 'provider_hourly_rate=70; cohort=standard; equity_floor=met; soft_cap_exceeded=1',
        },
      ],
      payRates: [],
    });

    expect(model.highlights.directshiftsAccessProviders).toBe(2);
    expect(model.highlights.directshiftsAccessHours).toBe(38);
    expect(model.highlights.directshiftsAccessSharePct).toBe(38);
    expect(model.highlights.directshiftsTargetSharePct).toBe(15);
    expect(model.highlights.equityFloorMetProviders).toBe(3);
    expect(model.highlights.softCapExceededProviders).toBe(1);
    expect(model.highlights.sameRateDirectshiftsGroups).toBe(1);
    expect(model.highlights.sameRateDirectshiftsMaxSpreadPct).toBe(5);
    expect(model.providerRows[0].routingTags).toContain('Soft cap relaxed');
  });
});
