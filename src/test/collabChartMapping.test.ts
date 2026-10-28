import { describe, expect, it } from 'vitest';
import { initialCollabChartMappings, matchingChartUrls, meetingChartMonth } from '../lib/collabChartMapping';

describe('collab chart mapping', () => {
  const url = initialCollabChartMappings[0].spreadsheetUrl + '#gid=123';
  const row = { ...initialCollabChartMappings[0], title: 'CA charts', state: 'CA', month: '2026-10', tabUrl: url };
  it('seeds all 10 supplied spreadsheets', () => { expect(initialCollabChartMappings).toHaveLength(10); expect(initialCollabChartMappings[9].spreadsheetUrl).toContain('1vQ5wJI-Vc3yy5UkhIpra8b_Jz4nkUQZA_ghzyCv5cmA'); });
  it('matches selected states only', () => { expect(matchingChartUrls([row], ['TX'], '2026-10')).toEqual([]); expect(matchingChartUrls([row], ['CA'], '2026-10')).toEqual([url]); });
  it('matches the event month only', () => { expect(matchingChartUrls([row], ['CA'], '2026-11')).toEqual([]); });
  it('never infers states for legacy events', () => { expect(matchingChartUrls([row], [], '2026-10')).toEqual([]); });
  it('opens shared tabs only once', () => { expect(matchingChartUrls([row, { ...row, id: 'duplicate' }], ['CA'], '2026-10')).toEqual([url]); });
  it('ignores unfinished and unsafe links', () => { expect(matchingChartUrls([{ ...row, tabUrl: '' }, { ...row, tabUrl: 'javascript:alert(1)' }], ['CA'], '2026-10')).toEqual([]); });
  it('uses the Eastern meeting month at UTC boundaries', () => { expect(meetingChartMonth('2026-11-01T02:00:00Z')).toBe('2026-10'); });
});