import { describe, expect, it } from 'vitest';
import { buildSubmissionTimeline } from '../..//lib/submissionTimeline';

describe('Sara Hammond verified December availability', () => {
  it('adds 84 hours from Monday, Wednesday and Thursday 9:15 AM–3:15 PM without Christmas shifts', () => {
    const result = buildSubmissionTimeline([{ id: 'sara-december', submitted_at: '2026-11-10T18:17:24Z', parsed_shifts: {
      email: 'sara.hammond@vitablehealth.com',
      recurring_virtual: JSON.stringify(['Monday', 'Wednesday', 'Thursday'].map(day => ({ 'Day of Week': day, 'Start Time (ET)': '09:15 AM', 'End Time (ET)': '03:15 PM' }))),
    } }], { providerName: 'Sara Hammond', email: 'sara.hammond@vitablehealth.com' }, '2026-12-01');
    expect(result.summary.final_approvable_hours).toBe(84);
    expect(result.timeline).toHaveLength(14);
    expect(result.timeline.some(row => row.date === '2026-12-25')).toBe(false);
  });
});