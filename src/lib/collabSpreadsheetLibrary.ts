export interface MonthTab {
  month: string; // full month name, e.g. 'October'
  url: string;
}

export interface LibrarySpreadsheet {
  id: string; // spreadsheet ID parsed from the URL
  url: string; // base spreadsheet link
  title: string;
  states: string[]; // uppercase state abbreviations this spreadsheet covers
  tabs: MonthTab[]; // direct links to each month's tab
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const COLLAB_SPREADSHEET_LIBRARY_KEY = 'collab_spreadsheet_library';

const DEFAULT_URLS = [
  'https://docs.google.com/spreadsheets/d/12tk5M4sa9iathNKRR775mWfNt5XtbaVdUXTDI5CMNy4/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/13MOiOoFe9A_9pafNGZ-GhHXexgUlxbK1FTs9zfG-GJY/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/19C9pP3OKaDyw5_PD5QS_6zoig_iZ4mtODTNSCtxxDZQ/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/1EfCvKGTTMiu4z2LXyDywMZT6qFm2w4wGnK-H0Q3qVvs/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/1HfNPExz9QE9hHa5EyE_9fG__u0OwWTayTVOUlSzY4_k/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/1OSBLiVdCA5lKhfhmUoacX9Nm3nycgv-qhLUd1yr53yY/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/1cx1e8WAGEsUTVtzelUtBO4XotlE-xJn55ch3Dvv1C0g/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/1gpMC6PFPNeM7gO8cNYfVPTfUR3pQv39zB8gzKIRt4PQ/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/1pb-1bDY_H825791wbY_8uMQiYnznTXrQZxgt8AdpPv4/edit?usp=sharing',
  'https://docs.google.com/spreadsheets/d/1vQ5wJI-Vc3yy5UkhIpra8b_Jz4nkUQZA_ghzyCv5cmA/edit?usp=sharing',
];

export function parseSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export const DEFAULT_SPREADSHEETS: LibrarySpreadsheet[] = DEFAULT_URLS.map((url) => ({
  id: parseSpreadsheetId(url) || url,
  url,
  title: '',
  states: [],
  tabs: [],
}));

/** Month name of a meeting date in Eastern Time (meetings are scheduled in ET). */
export function meetingMonthName(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'America/New_York' }).format(new Date(isoDate));
}

/** Direct tab link for a month, falling back to the spreadsheet's base link. */
export function tabUrlForMonth(sheet: LibrarySpreadsheet, monthName: string): string {
  const target = monthName.trim().toLowerCase();
  const tab = sheet.tabs.find((t) => t.month.trim().toLowerCase() === target && t.url.trim());
  return tab?.url.trim() || sheet.url;
}

/**
 * Tab links for a provider's selected states: one link per matching spreadsheet,
 * month-resolved. States with no registered spreadsheet are skipped (callers may
 * fall back to agreement chart links for those).
 */
export function libraryUrlsForStates(
  library: LibrarySpreadsheet[],
  states: string[],
  monthName: string,
): { url: string; state: string }[] {
  const out: { url: string; state: string }[] = [];
  for (const state of states) {
    const sheet = library.find((s) => s.states.includes(state.toUpperCase()));
    if (!sheet) continue;
    const url = tabUrlForMonth(sheet, monthName);
    if (!out.some((o) => o.url === url)) out.push({ url, state });
  }
  return out;
}

/** Merge a saved library with the built-in links so newly shared sheets appear. */
export function mergeLibraryDefaults(saved: LibrarySpreadsheet[] | null | undefined): LibrarySpreadsheet[] {
  const rows = (saved || []).filter((s) => s?.id);
  const merged = [...rows];
  for (const def of DEFAULT_SPREADSHEETS) {
    if (!merged.some((s) => s.id === def.id)) merged.push({ ...def });
  }
  return merged;
}

export function normalizeLibraryRow(row: LibrarySpreadsheet): LibrarySpreadsheet {
  return {
    ...row,
    states: [...new Set(row.states.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))].sort(),
    tabs: row.tabs.filter((t) => t.url.trim()),
  };
}
