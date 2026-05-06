import * as XLSX from 'xlsx';
import { providerKey } from './normalize';
import { toAbbreviation } from '../stateNormalization';

export interface SupervisionProviderRow {
  key: string;
  name: string;
  states: Set<string>;
}

// The supervision workbook uses a vertical-stacked layout:
// Two NP "blocks" per row stripe — block A occupies cols A-D, block B occupies cols F-I.
// Header row at index 0; row 1 has the NP name in col 0 (and col 5 for second NP),
// then rows below stack the state abbreviations across cols 1-3 (Independent / Needs collab+reg / Needs collab no reg).
// A block ends when the next non-null name appears in its name column.
export function parseSupervisionXlsx(buf: ArrayBuffer): SupervisionProviderRow[] {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (rows.length < 2) return [];

  // Two blocks: name column 0 with state cols 1,2,3 ; name column 5 with state cols 6,7,8.
  const blocks: Array<{ nameCol: number; stateCols: number[] }> = [
    { nameCol: 0, stateCols: [1, 2, 3] },
    { nameCol: 5, stateCols: [6, 7, 8] },
  ];

  type Acc = { name: string; states: Set<string> };
  const out: Acc[] = [];

  for (const block of blocks) {
    let current: Acc | null = null;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const nameCell = row[block.nameCol];
      const name = typeof nameCell === 'string' ? nameCell.trim() : '';
      if (name) {
        if (current) out.push(current);
        current = { name, states: new Set<string>() };
      }
      if (!current) continue;
      for (const c of block.stateCols) {
        const cell = row[c];
        if (typeof cell !== 'string') continue;
        const a = toAbbreviation(cell);
        if (a) current.states.add(a);
      }
    }
    if (current) out.push(current);
  }

  return out.map(b => ({
    key: providerKey(b.name, null),
    name: b.name,
    states: b.states,
  }));
}