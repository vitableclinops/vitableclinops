/**
 * External (agency) provider import: parse, validate and diff an agency
 * workbook against what we already hold. Pure functions — nothing here writes.
 *
 * Ownership rules enforced here:
 *  - Agency data lives only in external_* tables, keyed by agency + external ID.
 *  - Medallion-linked providers are never touched (identity conflict instead).
 *  - Blank cells never clear values; rows missing from a file are left alone.
 *  - Local employment status / termination is never changed by an import.
 *  - No field can set PCP coverage or EHR data (no such columns exist).
 */
import * as XLSX from 'xlsx';

export type SheetName = 'Providers' | 'Licenses' | 'Agreements';
export type Row = Record<string, string | null>;
export interface ParsedWorkbook { sheets: Record<SheetName, Row[]>; headerIssues: string[] }

/** Old template header -> current header. Both are accepted. */
export const HEADER_ALIASES: Record<SheetName, Record<string, string>> = {
  Providers: { npi_number: 'npi', employment_status: 'agency_reported_status', employment_type: 'agency_classification' },
  Licenses: {},
  Agreements: { name: 'supervisor_name', license_number: 'supervisor_license_number' },
};

export const PROVIDER_FIELDS = ['external_provider_id', 'agency_name', 'npi', 'first_name', 'last_name', 'preferred_name', 'email', 'phone_number', 'profession', 'credentials', 'agency_reported_status', 'agency_classification', 'employment_start_date', 'employment_end_date', 'primary_specialty', 'secondary_specialty', 'primary_taxonomy', 'secondary_taxonomy', 'languages', 'practice_restrictions', 'license_inventory_status', 'agreement_inventory_status', 'verified_as_of', 'verified_by'] as const;
export const ADDRESS_FIELDS = ['address_line_1', 'address_line_2', 'address_city', 'address_state', 'postal_code', 'country'] as const;
export const LICENSE_FIELDS = ['external_provider_id', 'external_license_id', 'state', 'license_number', 'certificate_type', 'registration', 'status', 'issue_date', 'expiration_date', 'expiration_basis', 'using_compact', 'rx_authority', 'verification_status', 'verification_source', 'document_reference', 'verified_as_of', 'verified_by'] as const;
export const AGREEMENT_FIELDS = ['external_provider_id', 'external_agreement_id', 'supervisor_external_id', 'supervisor_name', 'supervisor_npi', 'supervisor_profession', 'supervision_state', 'supervisor_license_number', 'collaborative_agreement_status', 'collaborative_agreement_type', 'supervision_start_date', 'supervision_end_date', 'contact_email', 'contact_phone', 'document_title', 'document_reference', 'notes', 'verified_as_of', 'verified_by'] as const;

const REQUIRED: Record<SheetName, string[]> = {
  Providers: ['external_provider_id', 'agency_name', 'first_name', 'last_name', 'email', 'profession', 'agency_reported_status', 'agency_classification', 'license_inventory_status', 'agreement_inventory_status', 'verified_as_of', 'verified_by'],
  Licenses: ['external_provider_id', 'external_license_id', 'state', 'license_number', 'certificate_type', 'registration', 'status', 'expiration_basis', 'verification_status', 'verified_as_of', 'verified_by'],
  Agreements: ['external_provider_id', 'external_agreement_id', 'supervisor_name', 'supervisor_profession', 'supervision_state', 'collaborative_agreement_status', 'collaborative_agreement_type', 'verified_as_of', 'verified_by'],
};

const INVENTORY = ['complete', 'partial', 'unknown', 'not_applicable'];
export const ENUMS: Record<string, string[]> = {
  profession: ['NP', 'RN', 'MD', 'DO', 'LPC', 'LCSW', 'mental_health_coach'],
  agency_reported_status: ['active', 'inactive', 'termed', 'onboarding', 'unknown'],
  address_type: ['practice', 'mailing', 'home'],
  license_inventory_status: INVENTORY,
  agreement_inventory_status: INVENTORY,
  registration: ['state', 'dea', 'state_controlled'],
  status: ['active', 'pending', 'inactive', 'superceded', 'unknown'],
  expiration_basis: ['dated', 'no_expiration', 'unknown'],
  using_compact: ['yes', 'no', 'unknown'],
  verification_status: ['verified', 'unverified', 'unknown'],
  collaborative_agreement_status: ['active', 'inactive', 'unknown'],
  collaborative_agreement_type: ['primary', 'backup', 'unknown'],
};
const DATE_FIELDS = new Set(['employment_start_date', 'employment_end_date', 'verified_as_of', 'issue_date', 'expiration_date', 'supervision_start_date', 'supervision_end_date']);
const STATE_FIELDS = new Set(['state', 'supervision_state', 'address_state']);
const NPI_FIELDS = new Set(['npi', 'supervisor_npi']);

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

function cellToString(v: unknown): string | null {
  if (blank(v)) return null;
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).trim();
}

/** Normalise a value the way it will be stored (case, synonyms). */
export function normalizeValue(field: string, v: string | null): string | null {
  if (v === null) return null;
  if (field === 'status' && v.toLowerCase() === 'superseded') return 'superceded';
  if (field === 'profession') {
    const hit = ENUMS.profession.find((e) => e.toLowerCase() === v.toLowerCase());
    if (hit) return hit;
    if (v.toLowerCase() === 'health_coach') return 'mental_health_coach';
    return v;
  }
  if (ENUMS[field]) return v.toLowerCase();
  if (STATE_FIELDS.has(field) || field === 'country') return v.toUpperCase();
  if (field === 'email' || field === 'contact_email') return v.toLowerCase();
  return v;
}

export function rowsFromMatrix(sheet: SheetName, matrix: unknown[][], issues: string[]): Row[] {
  if (!matrix.length) { issues.push(`${sheet}: sheet is empty (no header row).`); return []; }
  const known = new Set<string>([
    ...(sheet === 'Providers' ? [...PROVIDER_FIELDS, ...ADDRESS_FIELDS, 'address_type'] : sheet === 'Licenses' ? LICENSE_FIELDS : AGREEMENT_FIELDS),
  ]);
  const headers = (matrix[0] ?? []).map((h) => {
    const raw = cellToString(h) ?? '';
    return HEADER_ALIASES[sheet][raw] ?? raw;
  });
  headers.forEach((h) => { if (h && !known.has(h)) issues.push(`${sheet}: unknown header "${h}" will be ignored.`); });
  for (const req of REQUIRED[sheet]) if (!headers.includes(req)) issues.push(`${sheet}: required header "${req}" is missing.`);
  const out: Row[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (r.every(blank)) continue;
    const row: Row = { __row: String(i + 1) };
    headers.forEach((h, c) => { if (h && known.has(h)) row[h] = normalizeValue(h, cellToString(r[c])); });
    out.push(row);
  }
  return out;
}

export function parseWorkbook(data: ArrayBuffer): ParsedWorkbook {
  const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true });
  const issues: string[] = [];
  const sheets = {} as Record<SheetName, Row[]>;
  for (const name of ['Providers', 'Licenses', 'Agreements'] as SheetName[]) {
    const ws = wb.Sheets[name];
    if (!ws) { issues.push(`Sheet "${name}" is missing.`); sheets[name] = []; continue; }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    sheets[name] = rowsFromMatrix(name, matrix, issues);
  }
  return { sheets, headerIssues: issues };
}

// ---------------------------------------------------------------- diffing

export interface ExistingState {
  agencies: { id: string; name: string }[];
  profiles: { id: string; full_name: string | null; email: string | null; npi_number: string | null; employment_status: string | null; medallion_id: string | null }[];
  medallion: { profile_id: string | null; npi: string | null; email: string | null }[];
  externalProviders: (Row & { agency_id: string; external_provider_id: string; profile_id: string | null })[];
  externalLicenses: (Row & { agency_id: string; external_license_id: string })[];
  externalAgreements: (Row & { agency_id: string; external_agreement_id: string })[];
  addresses: (Row & { agency_id: string; external_provider_id: string; address_type: string })[];
}

export type Action = 'add' | 'update' | 'unchanged' | 'blocked';
export interface FieldChange { field: string; before: string | null; after: string }
export interface RowResult {
  sheet: SheetName | 'Addresses';
  key: string;
  row: string;
  label: string;
  action: Action;
  changes: FieldChange[];
  missing: string[];
  invalid: string[];
  conflicts: string[];
  notes: string[];
  /** Fields to write (non-blank, changed). */
  patch: Record<string, string | string[] | null>;
  agencyId: string | null;
  profileLink?: { profileId: string | null; via: 'existing' | 'npi' | 'new' | 'none' };
}
export interface DryRun {
  results: RowResult[];
  headerIssues: string[];
  counts: Record<string, { add: number; update: number; unchanged: number; blocked: number }>;
}

const normNpi = (v: string | null | undefined) => (v ? v.replace(/\D/g, '') || null : null);
const stored = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join('; ');
  return String(v);
};

function validateFields(sheet: SheetName, row: Row, fields: readonly string[], r: RowResult) {
  for (const f of REQUIRED[sheet]) if (blank(row[f])) r.missing.push(f);
  for (const f of fields) {
    const v = row[f];
    if (blank(v)) continue;
    if (ENUMS[f] && !ENUMS[f].includes(v!)) r.invalid.push(`${f}: "${v}" is not one of ${ENUMS[f].join(', ')}`);
    if (DATE_FIELDS.has(f) && !/^\d{4}-\d{2}-\d{2}$/.test(v!)) r.invalid.push(`${f}: "${v}" is not a date`);
    if (STATE_FIELDS.has(f) && !/^[A-Z]{2}$/.test(v!)) r.invalid.push(`${f}: "${v}" is not a 2-letter state`);
    if (NPI_FIELDS.has(f) && !/^\d{10}$/.test(v!)) r.invalid.push(`${f}: "${v}" is not a 10-digit NPI`);
  }
}

function diffFields(row: Row, before: Row | undefined, fields: readonly string[], r: RowResult, skip: string[] = []) {
  for (const f of fields) {
    if (skip.includes(f)) continue;
    const after = row[f];
    if (blank(after)) continue; // blank never clears
    const prev = before ? stored(before[f]) : null;
    if (prev !== after) {
      r.changes.push({ field: f, before: prev, after: after! });
      r.patch[f] = f === 'languages' ? after!.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : after!;
    }
  }
}

function finish(r: RowResult, exists: boolean) {
  if (r.missing.length || r.invalid.length || r.conflicts.length) r.action = 'blocked';
  else if (!exists) r.action = 'add';
  else r.action = r.changes.length ? 'update' : 'unchanged';
}

export function buildDryRun(parsed: ParsedWorkbook, ex: ExistingState): DryRun {
  const results: RowResult[] = [];
  const agencyByName = new Map(ex.agencies.map((a) => [a.name.trim().toLowerCase(), a.id]));
  const medallionProfiles = new Set<string>([
    ...ex.profiles.filter((p) => p.medallion_id).map((p) => p.id),
    ...ex.medallion.map((m) => m.profile_id).filter(Boolean) as string[],
  ]);
  const medallionNpis = new Set(ex.medallion.map((m) => normNpi(m.npi)).filter(Boolean) as string[]);
  const medallionEmails = new Set([
    ...ex.medallion.map((m) => m.email?.toLowerCase()),
    ...ex.profiles.filter((p) => medallionProfiles.has(p.id)).map((p) => p.email?.toLowerCase()),
  ].filter(Boolean) as string[]);
  const profilesByNpi = new Map<string, string[]>();
  for (const p of ex.profiles) {
    const n = normNpi(p.npi_number); if (!n) continue;
    profilesByNpi.set(n, [...(profilesByNpi.get(n) ?? []), p.id]);
  }
  const profileById = new Map(ex.profiles.map((p) => [p.id, p]));
  const extProvKey = (a: string, id: string) => `${a}::${id}`;
  const existingProv = new Map(ex.externalProviders.map((p) => [extProvKey(p.agency_id, p.external_provider_id), p]));
  const existingLic = new Map(ex.externalLicenses.map((l) => [extProvKey(l.agency_id, l.external_license_id), l]));
  const existingAgr = new Map(ex.externalAgreements.map((a) => [extProvKey(a.agency_id, a.external_agreement_id), a]));
  const existingAddr = new Map(ex.addresses.map((a) => [`${a.agency_id}::${a.external_provider_id}::${a.address_type}`, a]));

  // Provider id -> agency id (from this file, else from what we hold).
  const providerAgency = new Map<string, string>();
  const knownProviderIds = new Map<string, Set<string>>();
  for (const p of ex.externalProviders) {
    if (!knownProviderIds.has(p.external_provider_id)) knownProviderIds.set(p.external_provider_id, new Set());
    knownProviderIds.get(p.external_provider_id)!.add(p.agency_id);
  }

  const seen = new Set<string>();
  const npiInFile = new Map<string, string>();
  for (const row of parsed.sheets.Providers) {
    const id = row.external_provider_id ?? '';
    const r: RowResult = { sheet: 'Providers', key: id, row: row.__row!, label: [row.first_name, row.last_name].filter(Boolean).join(' ') || id || `row ${row.__row}`, action: 'add', changes: [], missing: [], invalid: [], conflicts: [], notes: [], patch: {}, agencyId: null };
    validateFields('Providers', row, [...PROVIDER_FIELDS, 'address_type', ...ADDRESS_FIELDS], r);
    const agencyId = row.agency_name ? agencyByName.get(row.agency_name.toLowerCase()) ?? null : null;
    if (row.agency_name && !agencyId) r.invalid.push(`agency_name: "${row.agency_name}" is not a known agency (use the exact name, e.g. "DirectShifts")`);
    r.agencyId = agencyId;
    if (id) {
      if (seen.has(id)) r.conflicts.push(`external_provider_id "${id}" appears more than once in this file`);
      seen.add(id);
      if (agencyId) providerAgency.set(id, agencyId);
    }
    const before = agencyId && id ? existingProv.get(extProvKey(agencyId, id)) : undefined;

    // Identity: existing link, else exact NPI. Names never establish identity.
    const npi = normNpi(row.npi);
    if (npi) {
      const other = npiInFile.get(npi);
      if (other && other !== id) r.conflicts.push(`NPI ${npi} is also on ${other} in this file`);
      npiInFile.set(npi, id);
      if (medallionNpis.has(npi)) r.conflicts.push(`NPI ${npi} belongs to a Medallion provider — Medallion owns that record`);
    }
    if (row.email && medallionEmails.has(row.email)) r.conflicts.push(`email ${row.email} belongs to a Medallion provider — Medallion owns that record`);
    if (before?.npi && npi && normNpi(before.npi) !== npi) r.conflicts.push(`NPI differs from the one already imported (${before.npi} → ${npi}); not changed automatically`);

    let profileId: string | null = before?.profile_id ?? null;
    let via: 'existing' | 'npi' | 'new' | 'none' = profileId ? 'existing' : 'none';
    if (!profileId && npi) {
      const hits = profilesByNpi.get(npi) ?? [];
      if (hits.length > 1) r.conflicts.push(`NPI ${npi} is on ${hits.length} directory records — needs review`);
      else if (hits.length === 1) {
        if (medallionProfiles.has(hits[0])) r.conflicts.push(`NPI ${npi} matches a Medallion-linked directory record`);
        else { profileId = hits[0]; via = 'npi'; }
      }
    }
    if (!profileId && !r.conflicts.length) {
      via = 'new';
      if (!npi) r.notes.push('No NPI — a directory record can be created, but PCP coverage cannot link until a verified NPI is supplied.');
    }
    if (profileId && medallionProfiles.has(profileId)) r.conflicts.push('Linked directory record is Medallion-owned');
    const prof = profileId ? profileById.get(profileId) : undefined;
    if (prof?.employment_status === 'termed' && row.agency_reported_status && row.agency_reported_status !== 'termed') {
      r.notes.push(`Locally terminated — stays terminated; agency says "${row.agency_reported_status}".`);
    }
    r.profileLink = { profileId, via };

    diffFields(row, before, PROVIDER_FIELDS, r, ['agency_name']);
    finish(r, !!before);
    results.push(r);

    // Address (separate restricted record; type is mandatory).
    const hasAddr = ADDRESS_FIELDS.some((f) => !blank(row[f]));
    if (hasAddr || !blank(row.address_type)) {
      const a: RowResult = { sheet: 'Addresses', key: `${id}:${row.address_type ?? '?'}`, row: row.__row!, label: `${r.label} — ${row.address_type ?? 'untyped'} address`, action: 'add', changes: [], missing: [], invalid: [], conflicts: [], notes: [], patch: {}, agencyId };
      if (blank(row.address_type)) a.missing.push('address_type (required when an address is supplied)');
      if (r.action === 'blocked') a.conflicts.push('Provider row is blocked');
      if (row.address_type && row.address_type !== 'practice') a.notes.push('Visible to admins only.');
      const aBefore = agencyId && row.address_type ? existingAddr.get(`${agencyId}::${id}::${row.address_type}`) : undefined;
      diffFields(row, aBefore, ADDRESS_FIELDS, a);
      finish(a, !!aBefore);
      results.push(a);
    }
  }

  const resolveAgency = (pid: string): string | null => {
    if (providerAgency.has(pid)) return providerAgency.get(pid)!;
    const known = knownProviderIds.get(pid);
    return known && known.size === 1 ? [...known][0] : null;
  };
  const blockedProviders = new Set(results.filter((x) => x.sheet === 'Providers' && x.action === 'blocked').map((x) => x.key));

  const child = (sheet: 'Licenses' | 'Agreements', idField: string, fields: readonly string[], existing: Map<string, Row>) => {
    const seenIds = new Set<string>();
    for (const row of parsed.sheets[sheet]) {
      const id = row[idField] ?? '';
      const pid = row.external_provider_id ?? '';
      const label = sheet === 'Licenses' ? `${pid} · ${row.state ?? '?'} ${row.license_number ?? ''}`.trim() : `${pid} · ${row.supervisor_name ?? '?'} (${row.supervision_state ?? '?'})`;
      const r: RowResult = { sheet, key: id, row: row.__row!, label, action: 'add', changes: [], missing: [], invalid: [], conflicts: [], notes: [], patch: {}, agencyId: null };
      validateFields(sheet, row, fields, r);
      if (id) { if (seenIds.has(id)) r.conflicts.push(`${idField} "${id}" appears more than once in this file`); seenIds.add(id); }
      const agencyId = pid ? resolveAgency(pid) : null;
      if (pid && !agencyId) r.conflicts.push(`external_provider_id "${pid}" is not on the Providers sheet or already imported`);
      if (pid && blockedProviders.has(pid)) r.conflicts.push('Provider row is blocked');
      r.agencyId = agencyId;
      if (sheet === 'Licenses' && row.expiration_basis === 'dated' && blank(row.expiration_date)) r.notes.push('Marked dated but no expiration date given.');
      if (sheet === 'Licenses' && row.status === 'active' && row.verification_status !== 'verified') r.notes.push('Active but not verified — not counted toward licensed states.');
      const before = agencyId && id ? existing.get(extProvKey(agencyId, id)) : undefined;
      if (before && before.external_provider_id !== pid && pid) r.conflicts.push(`${idField} already belongs to provider ${before.external_provider_id}`);
      diffFields(row, before, fields, r);
      finish(r, !!before);
      results.push(r);
    }
  };
  child('Licenses', 'external_license_id', LICENSE_FIELDS, existingLic);
  child('Agreements', 'external_agreement_id', AGREEMENT_FIELDS, existingAgr);

  const counts: DryRun['counts'] = {};
  for (const r of results) {
    counts[r.sheet] ??= { add: 0, update: 0, unchanged: 0, blocked: 0 };
    counts[r.sheet][r.action]++;
  }
  return { results, headerIssues: parsed.headerIssues, counts };
}

// ---------------------------------------------------------------- licenses

export interface LicenseSummary { count: number; states: string[]; incomplete: boolean; label: string }

/** Licensed states/count from validated rows only: state registration, active, verified. DEA/controlled never count as a state. */
export function summarizeLicenses(
  licenses: { state: string | null; status: string | null; registration: string | null; verification_status: string | null }[],
  inventory: string | null,
): LicenseSummary {
  const valid = licenses.filter((l) => l.registration === 'state' && l.status === 'active' && l.verification_status === 'verified' && l.state);
  const states = [...new Set(valid.map((l) => l.state!))].sort();
  const incomplete = inventory !== 'complete' && inventory !== 'not_applicable';
  let label: string;
  if (inventory === 'not_applicable' && !licenses.length) label = 'Not applicable';
  else if (!states.length) label = incomplete ? 'Incomplete inventory' : 'None';
  else label = states.join(', ') + (incomplete ? ' (incomplete)' : '');
  return { count: valid.length, states, incomplete, label };
}
