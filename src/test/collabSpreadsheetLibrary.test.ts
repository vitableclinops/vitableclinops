import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPREADSHEETS,
  libraryUrlsForStates,
  meetingMonthName,
  mergeLibraryDefaults,
  parseSpreadsheetId,
  tabUrlForMonth,
  type LibrarySpreadsheet,
} from '@/lib/collabSpreadsheetLibrary';

const sheet = (over: Partial<LibrarySpreadsheet>): LibrarySpreadsheet => ({
  id: 'abc',
  url: 'https://docs.google.com/spreadsheets/d/abc/edit',
  title: '',
  states: [],
  tabs: [],
  ...over,
});

describe('parseSpreadsheetId', () => {
  it('extracts the id from a sharing link', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/12tk5M4sa9iathNKRR775mWfNt5XtbaVdUXTDI5CMNy4/edit?usp=sharing'))
      .toBe('12tk5M4sa9iathNKRR775mWfNt5XtbaVdUXTDI5CMNy4');
  });
});

describe('meetingMonthName', () => {
  it('uses the Eastern month of the meeting date', () => {
    expect(meetingMonthName('2026-10-30T17:00:00+00:00')).toBe('October');
  });

  it('does not roll into the next month when UTC has but Eastern has not', () => {
    // Oct 31, 10:30 PM Eastern = Nov 1 in UTC
    expect(meetingMonthName('2026-11-01T02:30:00+00:00')).toBe('October');
  });
});

describe('tabUrlForMonth', () => {
  it('returns the matching month tab link', () => {
    const s = sheet({ tabs: [{ month: 'October', url: 'https://x/edit#gid=5' }] });
    expect(tabUrlForMonth(s, 'October')).toBe('https://x/edit#gid=5');
  });

  it('matches month names case-insensitively', () => {
    const s = sheet({ tabs: [{ month: 'october', url: 'https://x/edit#gid=5' }] });
    expect(tabUrlForMonth(s, 'October')).toBe('https://x/edit#gid=5');
  });

  it('falls back to the base link when the month has no tab', () => {
    const s = sheet({ tabs: [{ month: 'September', url: 'https://x/edit#gid=9' }] });
    expect(tabUrlForMonth(s, 'October')).toBe(s.url);
  });
});

describe('libraryUrlsForStates', () => {
  const lib = [
    sheet({ id: 'pa', url: 'https://x/pa', states: ['PA', 'NJ'], tabs: [{ month: 'October', url: 'https://x/pa#gid=10' }] }),
    sheet({ id: 'tx', url: 'https://x/tx', states: ['TX'] }),
  ];

  it('resolves the month tab for each matching state spreadsheet', () => {
    expect(libraryUrlsForStates(lib, ['PA'], 'October')).toEqual([{ url: 'https://x/pa#gid=10', state: 'PA' }]);
  });

  it('dedupes states that share one spreadsheet', () => {
    expect(libraryUrlsForStates(lib, ['PA', 'NJ'], 'October')).toHaveLength(1);
  });

  it('skips states with no registered spreadsheet', () => {
    expect(libraryUrlsForStates(lib, ['CA'], 'October')).toEqual([]);
  });
});

describe('mergeLibraryDefaults', () => {
  it('keeps saved rows and appends missing default links once', () => {
    const saved = [sheet({ id: DEFAULT_SPREADSHEETS[0].id, title: 'PA charts' })];
    const merged = mergeLibraryDefaults(saved);
    expect(merged.find((s) => s.id === DEFAULT_SPREADSHEETS[0].id)?.title).toBe('PA charts');
    expect(merged).toHaveLength(DEFAULT_SPREADSHEETS.length);
  });
});
