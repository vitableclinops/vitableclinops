import { describe, expect, it } from 'vitest';
import {
  canonicalizeParsedShifts,
  diffParsedShifts,
  filterCanonicalSubmissionByMonth,
} from '@/lib/scheduling/submissionDiff';

const parsed = ({
  recurring = [],
  oneOff = [],
  inHome = [],
  unavailable = [],
}: {
  recurring?: Record<string, string>[];
  oneOff?: Record<string, string>[];
  inHome?: Record<string, string>[];
  unavailable?: Record<string, string>[];
}) => ({
  recurring_virtual: recurring,
  one_off_virtual: oneOff,
  in_home_clinic: inHome,
  unavailable_dates: unavailable,
});

describe('resubmission diffs by target month', () => {
  it('keeps July dated changes and suppresses June dated changes for July review', () => {
    const before = parsed({});
    const after = parsed({
      oneOff: [
        {
          Date: '06-11-2026',
          'Start Time (ET)': '1:00 PM',
          'End Time (ET)': '3:00 PM',
        },
        {
          Date: '07-10-2026',
          'Start Time (ET)': '10:00 AM',
          'End Time (ET)': '12:00 PM',
        },
      ],
      unavailable: [
        { 'Start Date': '06-26-2026', 'End Date': '06-26-2026' },
        { 'Start Date': '07-15-2026', 'End Date': '07-15-2026' },
      ],
    });

    const diff = diffParsedShifts(before, after, {
      ignoreDatesBefore: '2026-06-01',
      targetMonth: '2026-07-01',
    });

    expect(diff.hasChanges).toBe(true);
    expect(diff.summary.join('\n')).toContain('Added one-off Jul 10');
    expect(diff.summary.join('\n')).toContain('Added 1 day off: Jul 15');
    expect(diff.summary.join('\n')).not.toContain('Jun');
  });

  it('does not mark a July resubmission actionable when only June dated fields changed', () => {
    const before = parsed({});
    const after = parsed({
      oneOff: [
        {
          Date: '06-11-2026',
          'Start Time (ET)': '1:00 PM',
          'End Time (ET)': '3:00 PM',
        },
      ],
      unavailable: [{ 'Start Date': '06-26-2026', 'End Date': '06-26-2026' }],
    });

    const diff = diffParsedShifts(before, after, {
      ignoreDatesBefore: '2026-06-01',
      targetMonth: '2026-07',
    });

    expect(diff.hasChanges).toBe(false);
    expect(diff.summary).toEqual([]);
  });

  it('filters canonical dated fields to the selected month while keeping recurring availability', () => {
    const canonical = canonicalizeParsedShifts(
      parsed({
        recurring: [
          {
            'Day of Week': 'Friday',
            'Start Time (ET)': '9:00 AM',
            'End Time (ET)': '11:00 AM',
          },
        ],
        oneOff: [
          {
            Date: '06-11-2026',
            'Start Time (ET)': '1:00 PM',
            'End Time (ET)': '3:00 PM',
          },
          {
            Date: '07-10-2026',
            'Start Time (ET)': '10:00 AM',
            'End Time (ET)': '12:00 PM',
          },
        ],
        unavailable: [
          { 'Start Date': '06-26-2026', 'End Date': '06-26-2026' },
          { 'Start Date': '07-15-2026', 'End Date': '07-15-2026' },
        ],
      }),
    );

    const july = filterCanonicalSubmissionByMonth(canonical, '2026-07-01');

    expect(july.recurring).toHaveLength(1);
    expect(july.oneOff.map(r => r.date)).toEqual(['2026-07-10']);
    expect(july.unavailableDates).toEqual(['2026-07-15']);
  });
});
