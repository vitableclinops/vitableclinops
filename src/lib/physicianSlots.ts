import { normalizeRole } from '@/lib/clinicianRoles';
import { isOffboarded } from '@/lib/employeeVisibility';
import { parseLocalDate } from '@/lib/utils';

export interface SlotPerson { id: string; full_name: string | null; profession: string | null; credentials: string | null; employment_status: string | null }
export interface SlotAgreement {
  physicianKey: string; physicianName: string; physicianId?: string | null;
  state: string; providerIds: string[]; status: string | null;
  terminated?: string | null; start?: string | null; end?: string | null;
}
export interface SlotRule { state_abbreviation: string; np_md_ratio: string | null; np_md_ratio_limit: number | null }
export interface PhysicianSlots {
  key: string; physicianName: string; state: string; filled: number; limit: number;
  verificationLimit: number | null; providers: SlotPerson[];
}

export function physicianStateLimit(rule?: SlotRule): number | null {
  const text = rule?.np_md_ratio?.trim() ?? '';
  const limit = /^\d+$/.test(text) ? Number(text) : rule?.np_md_ratio_limit;
  return limit && limit > 0 ? limit : null;
}

export function isActiveSlotAgreement(a: { status: string | null; terminated?: string | null; start?: string | null; end?: string | null }, today = new Date()): boolean {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return ['active', 'fully_executed'].includes((a.status ?? '').toLowerCase()) && !a.terminated
    && (!a.start || parseLocalDate(a.start.slice(0, 10)) <= day)
    && (!a.end || parseLocalDate(a.end.slice(0, 10)) >= day);
}

export function physicianSlots(agreements: SlotAgreement[], people: SlotPerson[], rules: SlotRule[], today = new Date()): PhysicianSlots[] {
  const byId = new Map(people.map(p => [p.id, p]));
  const rows = new Map<string, PhysicianSlots>();
  for (const a of agreements) {
    if (!isActiveSlotAgreement(a, today)) continue;
    if (a.physicianId && isOffboarded(byId.get(a.physicianId)?.employment_status)) continue;
    const rule = rules.find(r => r.state_abbreviation === a.state);
    // Use the displayed State Requirements ratio; expose conflicting verification values.
    const limit = physicianStateLimit(rule);
    if (!limit || limit <= 0 || !a.physicianKey) continue;
    const key = `${a.physicianKey}:${a.state}`;
    const row = rows.get(key) ?? { key, physicianName: a.physicianName, state: a.state, filled: 0, limit,
      verificationLimit: rule?.np_md_ratio_limit && rule.np_md_ratio_limit !== limit ? rule.np_md_ratio_limit : null, providers: [] };
    for (const id of a.providerIds) {
      const person = byId.get(id);
      if (!person || isOffboarded(person.employment_status)) continue;
      const role = normalizeRole(person.profession);
      const isNp = ['np', 'apn', 'aprn', 'npp', 'nurse practitioner', 'nurse practitioner, certified'].includes(role)
        || (!role && /\b(np|aprn|fnp|agpcnp)\b/i.test(person.credentials ?? ''));
      if (isNp && !row.providers.some(p => p.id === id)) row.providers.push(person);
    }
    row.filled = row.providers.length;
    rows.set(key, row);
  }
  return [...rows.values()].map(r => ({ ...r, providers: r.providers.sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '')) }))
    .sort((a, b) => a.physicianName.localeCompare(b.physicianName) || a.state.localeCompare(b.state));
}