import { describe, it, expect } from 'vitest';
import {
  validateInterval,
  findProviderOverride,
  normalizeProviderAvailability,
  formatTime,
  parseTimeOfDay,
  AVAILABILITY_OVERRIDES,
  DEFAULT_VALIDATION_CONFIG,
  type ProviderOverride,
  type RawInterval,
  type ValidationConfig,
} from '@/lib/availabilityValidation';

const cassondra = findProviderOverride({ name: 'Cassondra Hawkins' });
const akosua = findProviderOverride({ name: 'Akosua Norgbey' });
const melissa = findProviderOverride({ name: 'Melissa Harris-Perotti' });
const shadae = findProviderOverride({ name: 'Shadae McMillan' });

describe('parseTimeOfDay / formatTime', () => {
  it('parses canonical AM/PM strings', () => {
    expect(parseTimeOfDay('9:00 AM')?.totalMinutes).toBe(9 * 60);
    expect(parseTimeOfDay('5:00 PM')?.totalMinutes).toBe(17 * 60);
    expect(parseTimeOfDay('12:00 AM')?.totalMinutes).toBe(0);
    expect(parseTimeOfDay('12:00 PM')?.totalMinutes).toBe(12 * 60);
    expect(parseTimeOfDay('11:59 PM')?.totalMinutes).toBe(23 * 60 + 59);
  });
  it('rejects malformed times', () => {
    expect(parseTimeOfDay('25:00')).toBeNull();
    expect(parseTimeOfDay('hello')).toBeNull();
    expect(parseTimeOfDay('9:60 AM')).toBeNull();
  });
  it('round-trips through formatTime', () => {
    expect(formatTime(parseTimeOfDay('9:00 AM')!.totalMinutes)).toBe('9:00 AM');
    expect(formatTime(parseTimeOfDay('5:00 PM')!.totalMinutes)).toBe('5:00 PM');
    expect(formatTime(parseTimeOfDay('12:00 PM')!.totalMinutes)).toBe('12:00 PM');
  });
});

describe('findProviderOverride', () => {
  it('matches by canonical name', () => {
    expect(findProviderOverride({ name: 'Cassondra Hawkins, NP' })?.fullName).toBe('Cassondra Hawkins');
    expect(findProviderOverride({ name: 'cassondra  hawkins' })?.fullName).toBe('Cassondra Hawkins');
  });
  it('returns null when no match', () => {
    expect(findProviderOverride({ name: 'Nobody Special' })).toBeNull();
  });
  it('prefers email when supplied', () => {
    const customOverrides: ProviderOverride[] = [
      {
        fullName: 'Test Provider',
        email: 'test@vitable.health',
        rules: [{ rawStart: '12:00 AM', rawEnd: '6:00 PM', normalizedStart: '12:00 PM', normalizedEnd: '6:00 PM' }],
      },
    ];
    expect(
      findProviderOverride({ email: 'TEST@vitable.health' }, customOverrides)?.fullName,
    ).toBe('Test Provider');
  });
});

describe('Cassondra Hawkins overrides', () => {
  it('Friday 4:00 AM–9:00 PM corrects to 4:00 PM–9:00 PM', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Friday', rawStart: '4:00 AM', rawEnd: '9:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, cassondra);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_start_time).toBe('4:00 PM');
    expect(result.normalized_end_time).toBe('9:00 PM');
    expect(result.original_duration_hours).toBe(17);
    expect(result.normalized_duration_hours).toBe(5);
    expect(result.correction_confidence).toBe('high');
    expect(result.correction_reason).toContain('provider_override');
    expect(result.used_in_forecast).toBe(true);
  });

  it('Sunday 9:00 AM–12:00 AM corrects to 9:00 AM–12:00 PM', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Sunday', rawStart: '9:00 AM', rawEnd: '12:00 AM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, cassondra);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_start_time).toBe('9:00 AM');
    expect(result.normalized_end_time).toBe('12:00 PM');
    expect(result.normalized_duration_hours).toBe(3);
    expect(result.used_in_forecast).toBe(true);
  });

  it('does not apply Friday rule on Tuesday', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Tuesday', rawStart: '4:00 AM', rawEnd: '9:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, cassondra);
    // No override applied; falls through to default correction (early-AM start + evening end + > 12h)
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.correction_reason).not.toContain('provider_override');
  });
});

describe('Melissa Harris-Perotti override', () => {
  it('12:00 AM–6:00 PM corrects to 12:00 PM–6:00 PM', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Wednesday', rawStart: '12:00 AM', rawEnd: '6:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, melissa);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_start_time).toBe('12:00 PM');
    expect(result.normalized_end_time).toBe('6:00 PM');
    expect(result.normalized_duration_hours).toBe(6);
    expect(result.correction_confidence).toBe('high');
  });
});

describe('Shadae McMillan override', () => {
  it('12:00 AM–3:00 PM corrects to 12:00 PM–3:00 PM', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Thursday', rawStart: '12:00 AM', rawEnd: '3:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, shadae);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_start_time).toBe('12:00 PM');
    expect(result.normalized_end_time).toBe('3:00 PM');
    expect(result.normalized_duration_hours).toBe(3);
  });
});

describe('Akosua Norgbey 8 AM–11:59 PM full-day pattern', () => {
  it('with provider override → corrected to 8 AM–12 PM', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Monday', rawStart: '8:00 AM', rawEnd: '11:59 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, akosua);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_start_time).toBe('8:00 AM');
    expect(result.normalized_end_time).toBe('12:00 PM');
    expect(result.normalized_duration_hours).toBe(4);
  });
  it('without override → flagged as needs_review (not silently treated as full-day capacity)', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Monday', rawStart: '8:00 AM', rawEnd: '11:59 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('needs_review');
    expect(result.used_in_forecast).toBe(false);
    expect(result.needs_manual_review).toBe(true);
    expect(result.validation_warnings.some(w => /entire day/i.test(w))).toBe(true);
  });
});

describe('Default deterministic corrections', () => {
  it('12:00 AM–3:00 PM is auto-corrected without an override (high confidence)', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Tuesday', rawStart: '12:00 AM', rawEnd: '3:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_start_time).toBe('12:00 PM');
    expect(result.normalized_end_time).toBe('3:00 PM');
    expect(result.correction_confidence).toBe('high');
  });
  it('4:00 AM–9:00 PM is auto-corrected (start moves to PM) when duration would exceed 12h', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Tuesday', rawStart: '4:00 AM', rawEnd: '9:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_start_time).toBe('4:00 PM');
    expect(result.normalized_end_time).toBe('9:00 PM');
    expect(result.correction_confidence).toBe('medium');
  });
  it('9:00 AM–12:00 AM with default config → end becomes 12:00 PM', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Tuesday', rawStart: '9:00 AM', rawEnd: '12:00 AM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('auto_corrected');
    expect(result.normalized_end_time).toBe('12:00 PM');
  });
});

describe('Valid shifts pass unchanged', () => {
  it('9:00 AM–5:00 PM stays valid', () => {
    const raw: RawInterval = { kind: 'recurring', dayOfWeek: 'Monday', rawStart: '9:00 AM', rawEnd: '5:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('valid');
    expect(result.normalized_start_time).toBe('9:00 AM');
    expect(result.normalized_end_time).toBe('5:00 PM');
    expect(result.normalized_duration_hours).toBe(8);
    expect(result.correction_reason).toBeNull();
    expect(result.used_in_forecast).toBe(true);
  });
});

describe('Overnight handling', () => {
  const overnightAllowed: ValidationConfig = { ...DEFAULT_VALIDATION_CONFIG, allow_overnight_shifts: true };
  it('end before start is accepted as overnight when allow_overnight_shifts=true', () => {
    const raw: RawInterval = { kind: 'one_off', date: '2026-06-04', rawStart: '8:00 PM', rawEnd: '2:00 AM' };
    const result = validateInterval(raw, overnightAllowed, null);
    expect(result.validation_status).toBe('valid');
    expect(result.normalized_duration_hours).toBe(6);
    expect(result.used_in_forecast).toBe(true);
  });
  it('end before start is flagged when allow_overnight_shifts=false (default)', () => {
    const raw: RawInterval = { kind: 'one_off', date: '2026-06-04', rawStart: '8:00 PM', rawEnd: '2:00 AM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('needs_review');
    expect(result.used_in_forecast).toBe(false);
  });
});

describe('Threshold flags', () => {
  it('single shift > max_single_shift_hours → flagged for review', () => {
    const raw: RawInterval = { kind: 'one_off', date: '2026-06-04', rawStart: '6:00 AM', rawEnd: '11:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('needs_review');
    expect(result.validation_warnings.some(w => /single shift duration/i.test(w))).toBe(true);
  });

  it('weekly hours > max_weekly_hours generates a synthetic report row', () => {
    // Disable the operating-hours window so the test exercises the weekly
    // threshold path on its own. With the default 9-9 weekday / 9-12 weekend
    // window applied, weekend hours past noon would be clamped.
    const config: ValidationConfig = {
      ...DEFAULT_VALIDATION_CONFIG,
      weekday_window_start_min: 0,
      weekday_window_end_min: 1440,
      weekend_window_start_min: 0,
      weekend_window_end_min: 1440,
    };
    const intervals: RawInterval[] = [];
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      intervals.push({ kind: 'recurring', dayOfWeek: day, rawStart: '9:00 AM', rawEnd: '7:00 PM' });
    }
    const result = normalizeProviderAvailability({
      identity: { name: 'Test Provider' },
      submissions: [{ submissionId: 'S1', submittedAt: '2026-05-01T00:00:00Z', intervals }],
      targetMonth: '2026-06-01',
      config,
    });
    const synth = result.report.find(r => r.warnings.some(w => /Weekly hours exceed/.test(w)));
    expect(synth).toBeDefined();
  });

  it('day with > max_daily_hours produces a synthetic row', () => {
    const config: ValidationConfig = { ...DEFAULT_VALIDATION_CONFIG, max_daily_hours: 8 };
    const intervals: RawInterval[] = [
      { kind: 'one_off', date: '2026-06-04', rawStart: '8:00 AM', rawEnd: '4:00 PM' },
      { kind: 'one_off', date: '2026-06-04', rawStart: '5:00 PM', rawEnd: '8:00 PM' },
    ];
    const result = normalizeProviderAvailability({
      identity: { name: 'Test Provider' },
      submissions: [{ submissionId: 'S1', submittedAt: '2026-05-01T00:00:00Z', intervals }],
      targetMonth: '2026-06-01',
      config,
    });
    expect(result.report.some(r => r.warnings.some(w => /max_daily_hours/.test(w)))).toBe(true);
  });
});

describe('Malformed times are rejected', () => {
  it('rejects unparseable strings', () => {
    const raw: RawInterval = { kind: 'one_off', date: '2026-06-04', rawStart: 'banana', rawEnd: '5:00 PM' };
    const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
    expect(result.validation_status).toBe('rejected_or_unusable');
    expect(result.used_in_forecast).toBe(false);
    expect(result.needs_manual_review).toBe(true);
  });
});

describe('Operating hours window (9 AM-9 PM weekday, 9 AM-12 PM weekend)', () => {
  it('clamps a weekday shift that runs past 9 PM', () => {
    // Use 8:30 AM - 8:30 PM (12h, at the max_single_shift threshold) so the
    // shift validates and we exercise the operating-hours clamp.
    const result = normalizeProviderAvailability({
      identity: { name: 'Window Test' },
      submissions: [{
        submissionId: 'S1',
        submittedAt: '2026-05-01T00:00:00Z',
        intervals: [{ kind: 'one_off', date: '2026-06-01', rawStart: '8:30 AM', rawEnd: '8:30 PM' }],
      }],
      targetMonth: '2026-06-01',
    });
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].startMin).toBe(540);
    expect(result.timeline[0].endMin).toBe(1230);
    // Trim hours: 8:30-9:00 = 0.5
    expect(result.summary.hours_removed_for_operating_hours).toBe(0.5);
  });

  it('cuts a weekday shift that ends before 9 AM', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'Window Test' },
      submissions: [{
        submissionId: 'S1',
        submittedAt: '2026-05-01T00:00:00Z',
        intervals: [{ kind: 'one_off', date: '2026-06-01', rawStart: '7:00 AM', rawEnd: '8:00 AM' }],
      }],
      targetMonth: '2026-06-01',
    });
    expect(result.timeline).toHaveLength(0);
    expect(result.summary.hours_removed_for_operating_hours).toBe(1);
  });

  it('clamps a weekend shift to the 9 AM-12 PM window', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'Window Test' },
      submissions: [{
        submissionId: 'S1',
        submittedAt: '2026-05-01T00:00:00Z',
        intervals: [{ kind: 'one_off', date: '2026-06-06', rawStart: '9:00 AM', rawEnd: '1:30 PM' }],
      }],
      targetMonth: '2026-06-01',
    });
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].endMin).toBe(720);
    expect(result.summary.hours_removed_for_operating_hours).toBe(1.5);
  });

  it('does not apply window to in-home shifts', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'Window Test' },
      submissions: [{
        submissionId: 'S1',
        submittedAt: '2026-05-01T00:00:00Z',
        intervals: [{ kind: 'in_home', date: '2026-06-04', rawStart: '4:00 PM', rawEnd: '6:00 PM' }],
      }],
      targetMonth: '2026-06-01',
    });
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0].startMin).toBe(960);
    expect(result.timeline[0].endMin).toBe(1080);
    expect(result.summary.hours_removed_for_operating_hours).toBe(0);
    expect(result.outOfHoursTimeline).toHaveLength(0);
  });

  it('reports the original out-of-hours fragment for a clamped shift', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'Window Test' },
      submissions: [{
        submissionId: 'S1',
        submittedAt: '2026-05-01T00:00:00Z',
        intervals: [{ kind: 'one_off', date: '2026-06-01', rawStart: '8:30 AM', rawEnd: '8:30 PM' }],
      }],
      targetMonth: '2026-06-01',
    });
    expect(result.outOfHoursTimeline).toHaveLength(1);
    expect(result.outOfHoursTimeline[0].date).toBe('2026-06-01');
    expect(result.outOfHoursTimeline[0].startMin).toBe(510); // 8:30 AM
    expect(result.outOfHoursTimeline[0].endMin).toBe(540);   // 9:00 AM
  });

  it('reports the entire shift as out-of-hours when fully outside the window', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'Window Test' },
      submissions: [{
        submissionId: 'S1',
        submittedAt: '2026-05-01T00:00:00Z',
        intervals: [{ kind: 'one_off', date: '2026-06-01', rawStart: '7:00 AM', rawEnd: '8:00 AM' }],
      }],
      targetMonth: '2026-06-01',
    });
    expect(result.timeline).toHaveLength(0);
    expect(result.outOfHoursTimeline).toHaveLength(1);
    expect(result.outOfHoursTimeline[0].startMin).toBe(420); // 7:00 AM
    expect(result.outOfHoursTimeline[0].endMin).toBe(480);   // 8:00 AM
  });
});

describe('Pipeline: dedup + later submission overwrites', () => {
  it('identical (date, start, end) submissions collapse', () => {
    const intervals: RawInterval[] = [
      { kind: 'one_off', date: '2026-06-04', rawStart: '9:00 AM', rawEnd: '5:00 PM' },
    ];
    const result = normalizeProviderAvailability({
      identity: { name: 'Dup Provider' },
      submissions: [
        { submissionId: 'S1', submittedAt: '2026-05-01T00:00:00Z', intervals },
        { submissionId: 'S2', submittedAt: '2026-05-02T00:00:00Z', intervals },
      ],
      targetMonth: '2026-06-01',
    });
    expect(result.timeline.length).toBe(1);
    expect(result.timeline[0].endMin - result.timeline[0].startMin).toBe(8 * 60);
    expect(result.summary.hours_removed_for_duplicates).toBeGreaterThanOrEqual(8);
    expect(result.summary.final_approvable_hours).toBe(8);
  });

  it('a later overlapping slot overwrites the earlier slot', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'Override Provider' },
      submissions: [
        {
          submissionId: 'S1',
          submittedAt: '2026-05-01T00:00:00Z',
          intervals: [{ kind: 'one_off', date: '2026-06-04', rawStart: '9:00 AM', rawEnd: '5:00 PM' }],
        },
        {
          submissionId: 'S2',
          submittedAt: '2026-05-02T00:00:00Z',
          intervals: [{ kind: 'one_off', date: '2026-06-04', rawStart: '1:00 PM', rawEnd: '3:00 PM' }],
        },
      ],
      targetMonth: '2026-06-01',
    });
    // Original 9-5 (8h) is split: 9-1 (4h) + (1-3 dropped) + 3-5 (2h), then S2 1-3 (2h) added → 8h total.
    // S2 covers what was already S1's 1-3, so dedup hours = 2.
    expect(result.summary.final_approvable_hours).toBe(8);
    const sorted = [...result.timeline].sort((a, b) => a.startMin - b.startMin);
    expect(sorted.map(s => `${s.startMin}-${s.endMin}`)).toEqual([
      `${9 * 60}-${13 * 60}`,
      `${13 * 60}-${15 * 60}`,
      `${15 * 60}-${17 * 60}`,
    ]);
  });

  it('a later non-overlapping slot is added', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'New Slot Provider' },
      submissions: [
        {
          submissionId: 'S1',
          submittedAt: '2026-05-01T00:00:00Z',
          intervals: [{ kind: 'one_off', date: '2026-06-04', rawStart: '9:00 AM', rawEnd: '12:00 PM' }],
        },
        {
          submissionId: 'S2',
          submittedAt: '2026-05-02T00:00:00Z',
          intervals: [{ kind: 'one_off', date: '2026-06-05', rawStart: '9:00 AM', rawEnd: '12:00 PM' }],
        },
      ],
      targetMonth: '2026-06-01',
    });
    expect(result.summary.final_approvable_hours).toBe(6);
    expect(result.timeline.length).toBe(2);
  });
});

describe('Pipeline: recurring expansion + unavailable subtraction', () => {
  it('recurring Mondays in June 2026 expand to 5 dates and subtract a listed unavailable date', () => {
    const result = normalizeProviderAvailability({
      identity: { name: 'Recurring Provider' },
      submissions: [
        {
          submissionId: 'S1',
          submittedAt: '2026-05-01T00:00:00Z',
          intervals: [{ kind: 'recurring', dayOfWeek: 'Monday', rawStart: '9:00 AM', rawEnd: '12:00 PM' }],
        },
      ],
      targetMonth: '2026-06-01',
      unavailableDates: ['2026-06-15'], // a Monday
    });
    // June 2026 Mondays: 1, 8, 15, 22, 29 → 5 occurrences × 3h = 15h, minus 3h unavailable = 12h
    expect(result.summary.final_approvable_hours).toBe(12);
    expect(result.summary.hours_removed_for_unavailability).toBe(3);
  });
});

describe('Forecast usage', () => {
  it('used_in_forecast is true only for valid + auto_corrected', () => {
    const cases: Array<[RawInterval, boolean]> = [
      [{ kind: 'recurring', dayOfWeek: 'Monday', rawStart: '9:00 AM', rawEnd: '5:00 PM' }, true],
      [{ kind: 'recurring', dayOfWeek: 'Monday', rawStart: '12:00 AM', rawEnd: '3:00 PM' }, true],
      [{ kind: 'one_off', date: '2026-06-04', rawStart: 'malformed', rawEnd: '5:00 PM' }, false],
      [{ kind: 'recurring', dayOfWeek: 'Monday', rawStart: '8:00 AM', rawEnd: '11:59 PM' }, false],
    ];
    for (const [raw, expected] of cases) {
      const result = validateInterval(raw, DEFAULT_VALIDATION_CONFIG, null);
      expect(result.used_in_forecast).toBe(expected);
    }
  });
});

describe('Default override config covers required providers', () => {
  it('has rules for the four named providers', () => {
    expect(AVAILABILITY_OVERRIDES.find(o => o.fullName === 'Cassondra Hawkins')).toBeDefined();
    expect(AVAILABILITY_OVERRIDES.find(o => o.fullName === 'Akosua Norgbey')).toBeDefined();
    expect(AVAILABILITY_OVERRIDES.find(o => o.fullName === 'Melissa Harris-Perotti')).toBeDefined();
    expect(AVAILABILITY_OVERRIDES.find(o => o.fullName === 'Shadae McMillan')).toBeDefined();
  });
});
