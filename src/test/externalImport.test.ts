import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildDryRun, parseWorkbook, rowsFromMatrix, summarizeLicenses, type ExistingState, type ParsedWorkbook } from '@/lib/externalImport';

const PH = ['external_provider_id', 'agency_name', 'npi_number', 'first_name', 'last_name', 'email', 'profession', 'employment_status', 'employment_type', 'license_inventory_status', 'agreement_inventory_status', 'verified_as_of', 'verified_by', 'address_type', 'address_line_1'];
const LH = ['external_provider_id', 'external_license_id', 'state', 'license_number', 'certificate_type', 'registration', 'status', 'expiration_basis', 'verification_status', 'verified_as_of', 'verified_by'];
const AH = ['external_provider_id', 'external_agreement_id', 'name', 'supervisor_profession', 'supervision_state', 'collaborative_agreement_status', 'collaborative_agreement_type', 'verified_as_of', 'verified_by'];
const prov = (id: string, npi: string | null, email: string, extra: Partial<Record<string, string | null>> = {}) =>
  PH.map((h) => (h in extra ? extra[h] : ({ external_provider_id: id, agency_name: 'DirectShifts', npi_number: npi, first_name: 'Test', last_name: id, email, profession: 'NP', employment_status: 'active', employment_type: '1099', license_inventory_status: 'complete', agreement_inventory_status: 'complete', verified_as_of: '2026-10-01', verified_by: 'Agency QA', address_type: null, address_line_1: null } as Record<string, string | null>)[h]));
const lic = (pid: string, id: string, state: string, extra: Record<string, string> = {}) =>
  LH.map((h) => extra[h] ?? ({ external_provider_id: pid, external_license_id: id, state, license_number: '00123', certificate_type: 'NP', registration: 'state', status: 'active', expiration_basis: 'dated', verification_status: 'verified', verified_as_of: '2026-10-01', verified_by: 'Agency QA' } as Record<string, string>)[h]);

function wb(p: unknown[][], l: unknown[][] = [], a: unknown[][] = []): ParsedWorkbook {
  const issues: string[] = [];
  return { sheets: { Providers: rowsFromMatrix('Providers', [PH, ...p], issues), Licenses: rowsFromMatrix('Licenses', [LH, ...l], issues), Agreements: rowsFromMatrix('Agreements', [AH, ...a], issues) }, headerIssues: issues };
}
const AG = 'ag-1';
const base = (): ExistingState => ({
  agencies: [{ id: AG, name: 'DirectShifts' }],
  profiles: [
    { id: 'p-med', full_name: 'Med Person', email: 'med@x.com', npi_number: '1111111111', employment_status: 'active', medallion_id: 'm1' },
    { id: 'p-term', full_name: 'Termed Person', email: 't@x.com', npi_number: '2222222222', employment_status: 'termed', medallion_id: null },
    { id: 'p-dup1', full_name: 'A', email: null, npi_number: '3333333333', employment_status: 'active', medallion_id: null },
    { id: 'p-dup2', full_name: 'B', email: null, npi_number: '3333333333', employment_status: 'active', medallion_id: null },
  ],
  medallion: [{ profile_id: 'p-med', npi: '1111111111', email: 'med@x.com' }],
  externalProviders: [], externalLicenses: [], externalAgreements: [], addresses: [],
});

describe('external import dry run', () => {
  it('accepts old template headers (npi_number, employment_status, name, license_number)', () => {
    const d = buildDryRun(wb([prov('E1', '4444444444', 'e1@x.com')], [], [['E1', 'A1', 'Dr Sup', 'MD', 'TX', 'active', 'primary', '2026-10-01', 'QA']]), base());
    expect(d.headerIssues).toEqual([]);
    expect(d.results.find((r) => r.sheet === 'Providers')!.patch.agency_reported_status).toBe('active');
    expect(d.results.find((r) => r.sheet === 'Agreements')!.patch.supervisor_name).toBe('Dr Sup');
  });

  it('adds new records, then re-importing the same file creates no duplicates', () => {
    const file = wb([prov('E1', '4444444444', 'e1@x.com')], [lic('E1', 'L1', 'TX')]);
    const first = buildDryRun(file, base());
    expect(first.counts.Providers.add).toBe(1);
    expect(first.counts.Licenses.add).toBe(1);
    const ex = base();
    const p = first.results[0];
    ex.externalProviders = [{ ...(p.patch as any), agency_id: AG, external_provider_id: 'E1', profile_id: 'new' }];
    ex.externalLicenses = [{ ...(first.results[1].patch as any), agency_id: AG, external_license_id: 'L1' }];
    const second = buildDryRun(file, ex);
    expect(second.counts.Providers).toEqual({ add: 0, update: 0, unchanged: 1, blocked: 0 });
    expect(second.counts.Licenses).toEqual({ add: 0, update: 0, unchanged: 1, blocked: 0 });
  });

  it('blank cells never clear existing values', () => {
    const ex = base();
    ex.externalProviders = [{ agency_id: AG, external_provider_id: 'E1', profile_id: 'x', npi: '4444444444', first_name: 'Test', last_name: 'E1', email: 'e1@x.com', profession: 'NP', phone_number: '555' } as any];
    const d = buildDryRun(wb([prov('E1', null, 'e1@x.com')]), ex);
    expect(d.results[0].patch).not.toHaveProperty('npi');
    expect(d.results[0].patch).not.toHaveProperty('phone_number');
  });

  it('never matches or overwrites Medallion-owned providers', () => {
    const d = buildDryRun(wb([prov('E2', '1111111111', 'other@x.com')]), base());
    expect(d.results[0].action).toBe('blocked');
    const e = buildDryRun(wb([prov('E3', null, 'med@x.com')]), base());
    expect(e.results[0].action).toBe('blocked');
  });

  it('keeps local termination and links by exact NPI only', () => {
    const d = buildDryRun(wb([prov('E4', '2222222222', 'new@x.com')]), base());
    expect(d.results[0].profileLink).toEqual({ profileId: 'p-term', via: 'npi' });
    expect(d.results[0].notes.join(' ')).toMatch(/stays terminated/);
    expect(d.results[0].patch).not.toHaveProperty('employment_status');
  });

  it('flags an NPI shared by two directory records as a conflict', () => {
    expect(buildDryRun(wb([prov('E5', '3333333333', 'z@x.com')]), base()).results[0].action).toBe('blocked');
  });

  it('requires a type when an address is supplied', () => {
    const d = buildDryRun(wb([prov('E6', '5555555555', 'a@x.com', { address_line_1: '1 Main St' })]), base());
    const addr = d.results.find((r) => r.sheet === 'Addresses')!;
    expect(addr.action).toBe('blocked');
  });

  it('blocks licenses for unknown providers', () => {
    const d = buildDryRun(wb([], [lic('NOPE', 'L9', 'TX')]), base());
    expect(d.results[0].action).toBe('blocked');
  });

  it('parses the empty agency template with no header issues and no rows', async () => {
    const fs = await import('fs');
    const path = '/mnt/user-uploads/External_Provider_Import_Template.xlsx';
    if (!fs.existsSync(path)) return;
    const buf = fs.readFileSync(path);
    const parsed = parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(parsed.headerIssues).toEqual([]);
    expect(parsed.sheets.Providers).toHaveLength(0);
  });
});

describe('license summary', () => {
  const L = (state: string, o: Partial<{ status: string; registration: string; verification_status: string }> = {}) => ({ state, status: 'active', registration: 'state', verification_status: 'verified', ...o });
  it('counts distinct states from active, verified state licenses only', () => {
    const s = summarizeLicenses([L('TX'), L('TX'), L('OH'), L('FL', { registration: 'dea' }), L('PA', { verification_status: 'unverified' }), L('NJ', { status: 'inactive' })], 'complete');
    expect(s.states).toEqual(['OH', 'TX']);
    expect(s.count).toBe(3);
    expect(s.incomplete).toBe(false);
  });
  it('shows incomplete rather than zero when inventory is partial or unknown', () => {
    expect(summarizeLicenses([], 'partial').label).toBe('Incomplete inventory');
    expect(summarizeLicenses([], 'unknown').label).toBe('Incomplete inventory');
    expect(summarizeLicenses([], 'not_applicable').label).toBe('Not applicable');
  });
});
void XLSX;
