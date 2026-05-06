import Papa from 'papaparse';
import { providerKey, normEmail } from './normalize';
import { toAbbreviation } from '../stateNormalization';

export interface LicenseProviderRow {
  key: string;
  name: string;
  email: string | null;
  profession: string;
  states: Set<string>;
}

// Medallion CSV: Full name, Email, First Name, Middle Name, Last Name, Profession, Licenses, Actively licensed states
// 'Licenses' is a multi-line block with `Status : active` and `State : XX` per entry.
// 'Actively licensed states' may already contain a comma list — use it if present.
export function parseLicensesCsv(text: string): LicenseProviderRow[] {
  const r = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const out: LicenseProviderRow[] = [];
  for (const row of r.data) {
    const name = (row['Full name'] ?? '').trim();
    if (!name) continue;
    const email = normEmail(row['Email']);
    const profession = (row['Profession'] ?? '').trim() || 'NP';
    const states = new Set<string>();

    const activeList = row['Actively licensed states'] ?? '';
    if (activeList) {
      for (const tok of activeList.split(/[,;\n]/)) {
        const a = toAbbreviation(tok);
        if (a) states.add(a);
      }
    }

    const blob = row['Licenses'] ?? '';
    if (blob) {
      // Split on numbered entries; for each, look for "Status : active" + "State : XX"
      const entries = blob.split(/\n\s*\d+\.\s/);
      for (const ent of entries) {
        const isActive = /Status\s*:\s*active/i.test(ent);
        if (!isActive) continue;
        const m = ent.match(/State\s*:\s*([A-Za-z .]+)/);
        if (m) {
          const a = toAbbreviation(m[1]);
          if (a) states.add(a);
        }
      }
    }

    out.push({
      key: providerKey(name, email),
      name,
      email,
      profession,
      states,
    });
  }
  return out;
}