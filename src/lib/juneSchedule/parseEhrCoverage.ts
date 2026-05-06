import Papa from 'papaparse';
import { providerKey } from './normalize';
import { toAbbreviation } from '../stateNormalization';

export interface EhrProviderRow {
  key: string;
  name: string;
  states: Set<string>;
}

// First column is "Provider Full Name", subsequent columns are state abbreviations.
// A "1" (or any truthy non-empty) means the provider is active in that state.
// Last column is "Row totals" — ignore.
export function parseEhrCoverageCsv(text: string): EhrProviderRow[] {
  const r = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = r.data;
  if (rows.length < 2) return [];
  const header = rows[0];
  const stateCols: Array<{ idx: number; abbr: string }> = [];
  for (let i = 1; i < header.length; i++) {
    const h = (header[i] ?? '').trim();
    if (!h || /^row totals?$/i.test(h)) continue;
    const a = toAbbreviation(h);
    if (a) stateCols.push({ idx: i, abbr: a });
  }
  const out: EhrProviderRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[0] ?? '').trim();
    if (!name) continue;
    const states = new Set<string>();
    for (const { idx, abbr } of stateCols) {
      const v = (row[idx] ?? '').trim();
      if (v && v !== '0') states.add(abbr);
    }
    out.push({ key: providerKey(name, null), name, states });
  }
  return out;
}