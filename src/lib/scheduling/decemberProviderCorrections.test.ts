import { describe, expect, it } from 'vitest';
import { buildSubmissionTimeline } from '@/lib/submissionTimeline';

const recurring = (day: string, start: string, end: string) => ({ 'Day of Week': day, 'Start Time (ET)': start, 'End Time (ET)': end });
describe('December provider corrections', () => {
  it('uses Desire’s one-offs on late-month Wednesdays without changing Mondays and Thursdays', () => {
    const result = buildSubmissionTimeline([{ id: 'desire', submitted_at: '2026-10-01T00:00:00Z', parsed_shifts: {
      recurring_virtual: [recurring('Monday', '10:00 AM', '03:00 PM'), recurring('Thursday', '10:00 AM', '04:00 PM'), recurring('Wednesday', '05:00 PM', '07:00 PM'), recurring('Friday', '04:00 PM', '06:30 PM')],
      excluded_recurring_dates: ['2026-12-23', '2026-12-25', '2026-12-30'],
      one_off_virtual: [{ Date: '12-23-2026', 'Start Time (ET)': '08:00 AM', 'End Time (ET)': '03:00 PM' }, { Date: '12-30-2026', 'Start Time (ET)': '09:00 AM', 'End Time (ET)': '05:00 PM' }],
    } }], { email: 'desire.brown@vitablehealth.com' }, '2026-12-01');
    expect(result.timeline.filter(s => s.date === '2026-12-23').map(s => [s.startMin, s.endMin])).toEqual([[540, 900]]);
    expect(result.timeline.filter(s => s.date === '2026-12-30').map(s => [s.startMin, s.endMin])).toEqual([[540, 1020]]);
    expect(result.timeline.filter(s => s.date === '2026-12-28').map(s => [s.startMin, s.endMin])).toEqual([[600, 900]]);
    expect(result.timeline.filter(s => s.date === '2026-12-31').map(s => [s.startMin, s.endMin])).toEqual([[600, 960]]);
    expect(result.timeline.some(s => s.date === '2026-12-25')).toBe(false);
  });
  it('expands Michelle’s Monday/Tuesday/Wednesday form to 14 shifts and 79 hours', () => {
    const result = buildSubmissionTimeline([{ id: 'michelle', submitted_at: '2026-11-02T22:04:21Z', parsed_shifts: {
      recurring_virtual: [recurring('Monday', '01:00 PM', '07:00 PM'), recurring('Tuesday', '01:00 PM', '07:00 PM'), recurring('Wednesday', '03:00 PM', '08:00 PM')],
    } }], { email: 'michelle@vitablehealth.com' }, '2026-12-01');
    expect(result.timeline).toHaveLength(14);
    expect(result.summary.final_approvable_hours).toBe(79);
    expect(result.timeline.filter(s => s.date === '2026-12-01').map(s => [s.startMin, s.endMin])).toEqual([[780, 1140]]);
    expect(result.timeline.filter(s => s.date === '2026-12-02').map(s => [s.startMin, s.endMin])).toEqual([[900, 1200]]);
  });
});