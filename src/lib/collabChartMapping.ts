export interface CollabChartMapping {
  id: string;
  spreadsheetUrl: string;
  title: string;
  state: string;
  month: string;
  tabUrl: string;
}

export const COLLAB_CHART_CONFIG_KEY = 'collab_chart_mapping';

const spreadsheetIds = [
  '12tk5M4sa9iathNKRR775mWfNt5XtbaVdUXTDI5CMNy4',
  '13MOiOoFe9A_9pafNGZ-GhHXexgUlxbK1FTs9zfG-GJY',
  '19C9pP3OKaDyw5_PD5QS_6zoig_iZ4mtODTNSCtxxDZQ',
  '1EfCvKGTTMiu4z2LXyDywMZT6qFm2w4wGnK-H0Q3qVvs',
  '1HfNPExz9QE9hHa5EyE_9fG__u0OwWTayTVOUlSzY4_k',
  '1OSBLiVdCA5lKhfhmUoacX9Nm3nycgv-qhLUd1yr53yY',
  '1cx1e8WAGEsUTVtzelUtBO4XotlE-xJn55ch3Dvv1C0g',
  '1gpMC6PFPNeM7gO8cNYfVPTfUR3pQv39zB8gzKIRt4PQ',
  '1pb-1bDY_H825791wbY_8uMQiYnznTXrQZxgt8AdpPv4',
  '1vQ5wJI-Vc3yy5UkhIpra8b_Jz4nkUQZA_ghzyCv5cmA',
];

export const initialCollabChartMappings: CollabChartMapping[] = spreadsheetIds.map((id) => ({
  id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`,
  title: '', state: '', month: '', tabUrl: '',
}));

export function isSpreadsheetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'docs.google.com' && /^\/spreadsheets\/d\/[\w-]+\//.test(url.pathname);
  } catch { return false; }
}

export function meetingChartMonth(date: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(new Date(date));
  return `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}`;
}

export function matchingChartUrls(rows: CollabChartMapping[], states: string[], month: string): string[] {
  const selected = new Set(states.map(s => s.toUpperCase()));
  return [...new Set(rows.filter(row => selected.has(row.state.toUpperCase()) && row.month === month && isSpreadsheetUrl(row.tabUrl)).map(row => row.tabUrl))];
}