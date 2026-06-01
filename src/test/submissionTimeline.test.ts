import { describe, it, expect } from 'vitest';
import {
  buildSubmissionTimeline,
  buildShiftRecommendationRows,
  isScarceCoverageSlot,
  TELEHEALTH_FORECAST_KINDS,
  type ParsedShiftsBlob,
  type SubmissionRow,
  type ShiftRecommendationRow,
} from '@/lib/submissionTimeline';
import { DEFAULT_VALIDATION_CONFIG } from '@/lib/availabilityValidation';

const FIXTURE_TARGET_MONTH = '2026-06-01';

const validRecurring = JSON.stringify([
  { 'Day of Week': 'Monday', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
  { 'Day of Week': 'Wednesday', 'Start Time (ET)': '1:00 PM', 'End Time (ET)': '5:00 PM' },
]);
const validOneOff = JSON.stringify([
  { 'Date': '06-04-2026', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
]);
const inHome = JSON.stringify([
  { 'Date': '06-11-2026', 'Start Time (ET)': '8:00 AM', 'End Time (ET)': '12:00 PM' },
]);

const baseSubmission: SubmissionRow = {
  id: 'sub-1',
  submitted_at: '2026-05-01T00:00:00Z',
  parsed_shifts: {
    recurring_virtual: validRecurring,
    one_off_virtual: validOneOff,
    in_home_clinic: inHome,
    email: 'test.provider@vitable.health',
  } as ParsedShiftsBlob,
};

describe('buildSubmissionTimeline', () => {
  it('produces a deterministic timeline given identical inputs (evaluator/emitter parity)', () => {
    const args = {
      submissions: [baseSubmission],
      identity: { name: 'Test Provider', email: baseSubmission.parsed_shifts!.email },
      targetMonth: FIXTURE_TARGET_MONTH,
    };
    const a = buildSubmissionTimeline(args.submissions, args.identity, args.targetMonth);
    const b = buildSubmissionTimeline(args.submissions, args.identity, args.targetMonth);
    expect(serializeTimeline(a.timeline)).toEqual(serializeTimeline(b.timeline));
    expect(serializeTimeline(a.forecastTimeline)).toEqual(serializeTimeline(b.forecastTimeline));
    expect(a.summary).toEqual(b.summary);
  });

  it('excludes in_home_clinic from forecast hours by default', () => {
    const result = buildSubmissionTimeline(
      [baseSubmission],
      { name: 'Test Provider' },
      FIXTURE_TARGET_MONTH,
    );
    // Recurring: Mondays in June 2026 (5) × 3h + Wednesdays (4) × 4h = 31h
    // One-off: 3h
    // In-home: 4h
    // Forecast (telehealth) total = 31 + 3 = 34. In-home (4) is excluded.
    expect(result.summary.final_approvable_hours).toBe(34);
    expect(result.summary.total_normalized_timeline_hours).toBe(38);
    const forecastKinds = new Set(result.forecastTimeline.map(s => s.source.kind));
    expect(forecastKinds.has('in_home')).toBe(false);
    const fullKinds = new Set(result.timeline.map(s => s.source.kind));
    expect(fullKinds.has('in_home')).toBe(true);
  });

  it('includes in_home_clinic in forecast hours when explicitly opted in', () => {
    const result = buildSubmissionTimeline(
      [baseSubmission],
      { name: 'Test Provider' },
      FIXTURE_TARGET_MONTH,
      { forecastKinds: ['recurring', 'one_off', 'in_home'] },
    );
    expect(result.summary.final_approvable_hours).toBe(38);
  });

  it('default forecastKinds is recurring + one_off', () => {
    expect(TELEHEALTH_FORECAST_KINDS.sort()).toEqual(['one_off', 'recurring']);
  });
});

describe('buildShiftRecommendationRows', () => {
  it('produces identical rows when called twice with the same inputs', () => {
    const validation = buildSubmissionTimeline(
      [baseSubmission],
      { name: 'Test Provider' },
      FIXTURE_TARGET_MONTH,
    );
    const args = {
      providerId: 'p1',
      providerName: 'Test Provider',
      targetMonth: FIXTURE_TARGET_MONTH,
      timeline: validation.timeline,
      forecastTimeline: validation.forecastTimeline,
      declinedHours: 5,
      declineAll: false,
      allocations: [{ state: 'PA', hours: 20 }, { state: 'NJ', hours: 9 }],
      decisionRunId: 'run-1',
    };
    const a = buildShiftRecommendationRows(args);
    const b = buildShiftRecommendationRows(args);
    expect(stripVolatile(a)).toEqual(stripVolatile(b));
  });

  it('in-home slots are always publish, not consumed by cut budget', () => {
    const validation = buildSubmissionTimeline(
      [baseSubmission],
      { name: 'Test Provider' },
      FIXTURE_TARGET_MONTH,
    );
    const rows = buildShiftRecommendationRows({
      providerId: 'p1',
      providerName: 'Test Provider',
      targetMonth: FIXTURE_TARGET_MONTH,
      timeline: validation.timeline,
      forecastTimeline: validation.forecastTimeline,
      // Decline-all: every forecast slot must be cut, but in-home stays.
      declinedHours: 0,
      declineAll: true,
      allocations: [],
      decisionRunId: 'run-1',
    });
    const inHomeRows = rows.filter(r => r.shift_type === 'in_home_clinic');
    const cutInHome = inHomeRows.filter(r => r.recommendation === 'cut');
    expect(inHomeRows.length).toBeGreaterThan(0);
    expect(cutInHome).toHaveLength(0);
    expect(inHomeRows.every(r => r.recommendation === 'publish')).toBe(true);
    // All telehealth slots should be cut on declineAll
    const teleRows = rows.filter(r => r.shift_type !== 'in_home_clinic');
    expect(teleRows.every(r => r.recommendation === 'cut')).toBe(true);
  });

  it('cut budget walks forecast slots latest-first', () => {
    const validation = buildSubmissionTimeline(
      [baseSubmission],
      { name: 'Test Provider' },
      FIXTURE_TARGET_MONTH,
    );
    // Forecast total = 34h; decline 8h → ~2 forecast slots cut, latest first.
    const rows = buildShiftRecommendationRows({
      providerId: 'p1',
      providerName: 'Test Provider',
      targetMonth: FIXTURE_TARGET_MONTH,
      timeline: validation.timeline,
      forecastTimeline: validation.forecastTimeline,
      declinedHours: 8,
      declineAll: false,
      allocations: [{ state: 'PA', hours: 26 }],
      decisionRunId: 'run-1',
    });
    const teleCut = rows.filter(r => r.shift_type !== 'in_home_clinic' && r.recommendation === 'cut');
    expect(teleCut.length).toBeGreaterThan(0);
    const cutHoursSum = teleCut.reduce((s, r) => s + r.hours, 0);
    expect(cutHoursSum).toBeGreaterThanOrEqual(8);
  });

  it('protects scarce coverage windows from monthly oversupply cuts', () => {
    const scarceSubmission: SubmissionRow = {
      id: 'sub-scarce',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        one_off_virtual: JSON.stringify([
          { 'Date': '06-01-2026', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
          { 'Date': '06-28-2026', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
        ]),
      } as ParsedShiftsBlob,
    };
    const validation = buildSubmissionTimeline(
      [scarceSubmission],
      { name: 'Scarce Provider' },
      FIXTURE_TARGET_MONTH,
    );
    const protectedForecastTimeline = validation.forecastTimeline.filter(isScarceCoverageSlot);
    expect(protectedForecastTimeline.map(s => s.date)).toEqual(['2026-06-28']);

    const rows = buildShiftRecommendationRows({
      providerId: 'p1',
      providerName: 'Scarce Provider',
      targetMonth: FIXTURE_TARGET_MONTH,
      timeline: validation.timeline,
      forecastTimeline: validation.forecastTimeline,
      protectedForecastTimeline,
      declinedHours: 3,
      declineAll: false,
      allocations: [{ state: 'PA', hours: 3 }],
      decisionRunId: 'run-1',
    });

    const monday = rows.find(r => r.shift_date === '2026-06-01');
    const sunday = rows.find(r => r.shift_date === '2026-06-28');
    expect(monday?.recommendation).toBe('cut');
    expect(sunday?.recommendation).toBe('publish');
    expect(sunday?.recommendation_reason).toContain('scarce coverage window');
  });

  it('emits policy cut rows for MH shifts shorter than 2.5 hours', () => {
    const submission: SubmissionRow = {
      id: 'sub-mh',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        one_off_virtual: JSON.stringify([
          { 'Date': '06-04-2026', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '11:00 AM' },
          { 'Date': '06-05-2026', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '11:30 AM' },
        ]),
      } as ParsedShiftsBlob,
    };
    const validation = buildSubmissionTimeline(
      [submission],
      { name: 'MH Coach' },
      FIXTURE_TARGET_MONTH,
      { config: { ...DEFAULT_VALIDATION_CONFIG, min_single_shift_hours: 2.5 } },
    );
    const rows = buildShiftRecommendationRows({
      providerId: 'mh-1',
      providerName: 'MH Coach',
      targetMonth: FIXTURE_TARGET_MONTH,
      timeline: validation.timeline,
      forecastTimeline: validation.forecastTimeline,
      policyCutTimeline: validation.forecastPolicyCutTimeline,
      policyCutReason: 'Cut — mental health shifts must be at least 2.5h',
      unallocatedForecastPublishReason: 'Publish (mental health schedule)',
      declinedHours: 0,
      declineAll: false,
      allocations: [],
      decisionRunId: 'run-mh',
    });

    const cutRows = rows.filter(r => r.recommendation === 'cut');
    const publishRows = rows.filter(r => r.recommendation === 'publish');
    expect(cutRows).toHaveLength(1);
    expect(cutRows[0].shift_date).toBe('2026-06-04');
    expect(cutRows[0].recommendation_reason).toContain('2.5h');
    expect(publishRows).toHaveLength(1);
    expect(publishRows[0].recommendation_reason).toContain('mental health schedule');
  });
});

describe('Evaluator/emitter parity (full pipeline)', () => {
  it('two passes (one simulating evaluator, one simulating emitter) produce the same shift_recommendation rows', () => {
    // First call: "evaluator" — runs validation, decides accepted/declined.
    const validation1 = buildSubmissionTimeline(
      [baseSubmission],
      { name: 'Test Provider', email: baseSubmission.parsed_shifts!.email },
      FIXTURE_TARGET_MONTH,
    );
    const decisionRunId = 'run-evaluator';
    const declined = 4;
    const allocations = [{ state: 'PA', hours: validation1.summary.final_approvable_hours - declined }];
    const evaluatorRows = buildShiftRecommendationRows({
      providerId: 'p1',
      providerName: 'Test Provider',
      targetMonth: FIXTURE_TARGET_MONTH,
      timeline: validation1.timeline,
      forecastTimeline: validation1.forecastTimeline,
      declinedHours: declined,
      declineAll: false,
      allocations,
      decisionRunId,
    });

    // Second call: "emitter" — re-runs the same pipeline against the same
    // submissions and the same decision_notes-derived allocations.
    const validation2 = buildSubmissionTimeline(
      [baseSubmission],
      { name: 'Test Provider', email: baseSubmission.parsed_shifts!.email },
      FIXTURE_TARGET_MONTH,
    );
    const emitterRows = buildShiftRecommendationRows({
      providerId: 'p1',
      providerName: 'Test Provider',
      targetMonth: FIXTURE_TARGET_MONTH,
      timeline: validation2.timeline,
      forecastTimeline: validation2.forecastTimeline,
      declinedHours: declined,
      declineAll: false,
      allocations,
      decisionRunId,
    });

    expect(stripVolatile(evaluatorRows)).toEqual(stripVolatile(emitterRows));
  });

  it('parity holds even when raw input contains an AM/PM error that gets corrected', () => {
    const submission: SubmissionRow = {
      id: 'sub-cassondra',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        recurring_virtual: JSON.stringify([
          { 'Day of Week': 'Friday', 'Start Time (ET)': '4:00 AM', 'End Time (ET)': '9:00 PM' },
        ]),
      } as ParsedShiftsBlob,
    };
    const ident = { name: 'Cassondra Hawkins' };
    const a = buildSubmissionTimeline([submission], ident, FIXTURE_TARGET_MONTH);
    const b = buildSubmissionTimeline([submission], ident, FIXTURE_TARGET_MONTH);
    expect(serializeTimeline(a.timeline)).toEqual(serializeTimeline(b.timeline));
    // After correction (4 PM–9 PM, 5h × 4 Fridays in June 2026) = 20h
    expect(a.summary.final_approvable_hours).toBe(20);
  });
});

describe('unavailable_dates filtering', () => {
  it('removes recurring slots that fall on a Start Date / End Date entry (single day)', () => {
    // Akosua's case: recurring Mon 9-12, off on 6/1 (a Monday).
    const submission: SubmissionRow = {
      id: 'sub-akosua-1',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        recurring_virtual: JSON.stringify([
          { 'Day of Week': 'Monday', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
        ]),
        unavailable_dates: JSON.stringify([
          { 'Start Date': '06-01-2026', 'End Date': '06-01-2026' },
        ]),
      } as ParsedShiftsBlob,
    };
    const result = buildSubmissionTimeline(
      [submission],
      { name: 'Akosua' },
      FIXTURE_TARGET_MONTH,
    );
    const dates = result.timeline.map(s => s.date);
    expect(dates).not.toContain('2026-06-01');
    // Other Mondays in June 2026: 6/8, 6/15, 6/22, 6/29 → 4 remaining.
    expect(dates.filter(d => /^2026-06-\d{2}$/.test(d))).toHaveLength(4);
  });

  it('expands a Start Date → End Date range into all inclusive days', () => {
    // Off 6/6 through 6/8 (Sat–Mon); recurring Mon 9-12 should drop 6/8.
    const submission: SubmissionRow = {
      id: 'sub-akosua-2',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        recurring_virtual: JSON.stringify([
          { 'Day of Week': 'Monday', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
        ]),
        unavailable_dates: JSON.stringify([
          { 'Start Date': '06-06-2026', 'End Date': '06-08-2026' },
        ]),
      } as ParsedShiftsBlob,
    };
    const result = buildSubmissionTimeline(
      [submission],
      { name: 'Akosua' },
      FIXTURE_TARGET_MONTH,
    );
    const dates = result.timeline.map(s => s.date);
    expect(dates).not.toContain('2026-06-08');
    // 5 Mondays in June 2026, minus 6/8 = 4.
    expect(dates).toHaveLength(4);
  });

  it("filters Akosua's full off-shift list against her recurring Mon 9-12", () => {
    const submission: SubmissionRow = {
      id: 'sub-akosua-full',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        recurring_virtual: JSON.stringify([
          { 'Day of Week': 'Monday', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
        ]),
        unavailable_dates: JSON.stringify([
          { 'Start Date': '06-01-2026', 'End Date': '06-01-2026' },
          { 'Start Date': '06-03-2026', 'End Date': '06-03-2026' },
          { 'Start Date': '06-06-2026', 'End Date': '06-08-2026' },
          { 'Start Date': '06-12-2026', 'End Date': '06-14-2026' },
          { 'Start Date': '06-16-2026', 'End Date': '06-16-2026' },
          { 'Start Date': '06-18-2026', 'End Date': '06-18-2026' },
          { 'Start Date': '06-20-2026', 'End Date': '06-20-2026' },
          { 'Start Date': '06-23-2026', 'End Date': '06-23-2026' },
          { 'Start Date': '06-26-2026', 'End Date': '06-27-2026' },
          { 'Start Date': '06-29-2026', 'End Date': '06-29-2026' },
        ]),
      } as ParsedShiftsBlob,
    };
    const result = buildSubmissionTimeline(
      [submission],
      { name: 'Akosua' },
      FIXTURE_TARGET_MONTH,
    );
    // June 2026 Mondays: 1, 8, 15, 22, 29.
    // Off list covers: 1 (single), 8 (range 6-8), 29 (single). 15 and 22 remain.
    const dates = result.timeline.map(s => s.date).sort();
    expect(dates).toEqual(['2026-06-15', '2026-06-22']);
  });

  it('legacy { Date } entries still work as a fallback', () => {
    const submission: SubmissionRow = {
      id: 'sub-legacy',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        recurring_virtual: JSON.stringify([
          { 'Day of Week': 'Monday', 'Start Time (ET)': '9:00 AM', 'End Time (ET)': '12:00 PM' },
        ]),
        unavailable_dates: JSON.stringify([
          { 'Date': '06-01-2026' },
        ]),
      } as ParsedShiftsBlob,
    };
    const result = buildSubmissionTimeline(
      [submission],
      { name: 'Akosua' },
      FIXTURE_TARGET_MONTH,
    );
    expect(result.timeline.map(s => s.date)).not.toContain('2026-06-01');
  });
});

describe('needs_review scenarios (no auto-decision)', () => {
  it('a submission with an 8 AM–11:59 PM recurring entry without an override is flagged needs_review', () => {
    const submission: SubmissionRow = {
      id: 'sub-x',
      submitted_at: '2026-05-01T00:00:00Z',
      parsed_shifts: {
        recurring_virtual: JSON.stringify([
          { 'Day of Week': 'Monday', 'Start Time (ET)': '8:00 AM', 'End Time (ET)': '11:59 PM' },
        ]),
      } as ParsedShiftsBlob,
    };
    const result = buildSubmissionTimeline(
      [submission],
      { name: 'Unknown Provider' },
      FIXTURE_TARGET_MONTH,
    );
    expect(result.summary.intervals_needing_review).toBeGreaterThan(0);
    // Hours flagged for review do NOT count toward forecast.
    expect(result.summary.final_approvable_hours).toBe(0);
  });
});

function serializeTimeline(slots: { date: string; startMin: number; endMin: number; source: { kind: string; submissionId?: string } }[]) {
  return slots
    .map(s => ({
      date: s.date,
      startMin: s.startMin,
      endMin: s.endMin,
      kind: s.source.kind,
      submissionId: s.source.submissionId,
    }))
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMin - b.startMin ||
      a.endMin - b.endMin,
    );
}

function stripVolatile(rows: ShiftRecommendationRow[]): Omit<ShiftRecommendationRow, 'decision_run_id'>[] {
  return rows
    .map(({ decision_run_id: _drop, ...rest }) => rest)
    .sort((a, b) =>
      a.shift_date.localeCompare(b.shift_date) ||
      a.start_min - b.start_min ||
      a.end_min - b.end_min,
    );
}
