import Papa from 'papaparse';
import type { DemandRow } from './types';
import { toAbbreviation } from '../stateNormalization';

// Expects state-level demand rows with State and Adjusted Monthly Hours columns.
export function parseDemandCsv(text: string): DemandRow[] {
  const r = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const out: DemandRow[] = [];
  for (const row of r.data) {
    const stateRaw = row['State'] ?? '';
    if (!stateRaw || stateRaw.toUpperCase() === 'TOTAL') continue;
    const abbr = toAbbreviation(stateRaw);
    if (!abbr) continue;
    const hours = Number(row['Adjusted Monthly Hours'] ?? 0);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    out.push({ state: abbr, monthlyHours: hours });
  }
  return out;
}
