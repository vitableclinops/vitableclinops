/**
 * Active PCP Telemedicine States — EHR coverage linked to directory records
 * by verified identity, never by name.
 *
 * Source: sync-pcp-coverage (read-only query over the same warehouse table
 * and scope filters as Metabase question 2940, but returning the EHR
 * provider_id and NPI). Stored in metabase_raw_exports as
 * report_key 'pcp_coverage_by_provider_id'.
 *
 * Identity rules:
 *   - An EHR provider_id links to a directory profile only when its NPI
 *     exactly equals the profile's NPI or the NPI of the Medallion record
 *     linked to that profile. Names are informational only.
 *   - 0 candidates → unmatched; >1 candidate, or two EHR IDs claiming the
 *     same profile → ambiguous. Both are flagged, never guessed.
 *   - Exclusions are tied to verified EHR provider_id + NPI (former staff)
 *     or a verified profile id (out-of-scope health coach).
 *   - Being absent from this query never means inactive or unlicensed.
 */

import { canonicalName } from '@/lib/nameNormalization';

export interface EhrCoverageRow {
  provider_id?: string | null;
  original_provider_id?: string | null;
  provider_full_name?: string | null;
  state?: string | null;
  npi?: string | null;
}

export interface DirectoryIdentity { id: string; full_name: string | null; npi_number: string | null }
export interface MedallionIdentity { profile_id: string | null; npi: string | null }

export type IdentityStatus = 'matched' | 'unmatched' | 'ambiguous' | 'excluded';

export interface EhrIdentity {
  ehrProviderId: string;
  ehrName: string;
  npi: string | null;
  states: string[];
  status: IdentityStatus;
  profileId: string | null;
  /** Matched by NPI but the EHR name differs from the directory name. */
  nameDiffers: boolean;
  reason: string;
  /** Directory records an ambiguous identity could belong to. */
  candidateProfileIds?: string[];
}

/** Former employees: excluded from current coverage, history retained. */
export const FORMER_STAFF_EHR_EXCLUSIONS: Record<string, { npi: string; name: string }> = {
  'd5027156-3519-4620-97c2-c781743f9e5b': { npi: '1962936542', name: 'Heidi Hershberger' },
  'd4754d85-1b68-4ebd-b05f-3601cc93312e': { npi: '1649662925', name: 'Emily Van-Otoo' },
  '4b4b4d58-01d5-4548-a3c8-096052584127': { npi: '1063965978', name: 'Crystal Oramadike' },
  '8fa1e0f2-5227-4c3a-a5cd-ed9809dbe86a': { npi: '1356911325', name: 'LaStasha Jackson' },
};

/** Out-of-scope roles (verified profile ids). Not terminated, not a licensure gap. */
export const OUT_OF_SCOPE_PROFILE_IDS: Record<string, string> = {
  'a3917d41-d677-4110-bf05-d7115879ef53': 'Matthew Vazquez — health coach, outside PCP coverage scope',
};

const normNpi = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '') || null;

export function matchEhrCoverage(
  rows: EhrCoverageRow[],
  profiles: DirectoryIdentity[],
  medallion: MedallionIdentity[] = [],
): { identities: EhrIdentity[]; statesByProfile: Map<string, string[]> } {
  // Group rows by EHR provider id.
  const byEhr = new Map<string, { name: string; npis: Set<string>; states: Set<string> }>();
  for (const r of rows) {
    const id = r.provider_id?.trim();
    if (!id) continue;
    const g = byEhr.get(id) ?? { name: r.provider_full_name ?? '', npis: new Set(), states: new Set() };
    const n = normNpi(r.npi);
    if (n) g.npis.add(n);
    if (r.state?.trim()) g.states.add(r.state.trim().toUpperCase());
    byEhr.set(id, g);
  }

  const npiToProfiles = new Map<string, Set<string>>();
  const add = (npi: string | null, pid: string | null) => {
    if (!npi || !pid) return;
    if (!npiToProfiles.has(npi)) npiToProfiles.set(npi, new Set());
    npiToProfiles.get(npi)!.add(pid);
  };
  for (const p of profiles) add(normNpi(p.npi_number), p.id);
  for (const m of medallion) add(normNpi(m.npi), m.profile_id);
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  const identities: EhrIdentity[] = [];
  for (const [ehrId, g] of byEhr) {
    const npis = [...g.npis];
    const base = { ehrProviderId: ehrId, ehrName: g.name, npi: npis[0] ?? null, states: [...g.states].sort(), profileId: null, nameDiffers: false };
    const ex = FORMER_STAFF_EHR_EXCLUSIONS[ehrId];
    if (ex) {
      identities.push(npis.length === 1 && npis[0] === ex.npi
        ? { ...base, status: 'excluded', reason: 'Former employee — excluded from current coverage' }
        : { ...base, status: 'ambiguous', reason: `Excluded EHR ID but NPI does not match the verified ${ex.npi}` });
      continue;
    }
    if (npis.length === 0) { identities.push({ ...base, status: 'unmatched', reason: 'No NPI in EHR record' }); continue; }
    if (npis.length > 1) { identities.push({ ...base, status: 'ambiguous', reason: 'EHR record has more than one NPI' }); continue; }
    const cands = [...(npiToProfiles.get(npis[0]) ?? [])];
    if (cands.length === 0) { identities.push({ ...base, status: 'unmatched', reason: 'NPI not found in directory or Medallion' }); continue; }
    if (cands.length > 1) { identities.push({ ...base, candidateProfileIds: cands, status: 'ambiguous', reason: 'NPI belongs to more than one directory record' }); continue; }
    const pid = cands[0];
    const nameDiffers = canonicalName(nameById.get(pid)) !== canonicalName(g.name);
    if (OUT_OF_SCOPE_PROFILE_IDS[pid]) {
      identities.push({ ...base, profileId: pid, nameDiffers, status: 'excluded', reason: OUT_OF_SCOPE_PROFILE_IDS[pid] });
      continue;
    }
    identities.push({ ...base, profileId: pid, nameDiffers, status: 'matched', reason: 'Verified by NPI' });
  }

  // Two EHR IDs claiming one profile → both ambiguous.
  const claims = new Map<string, EhrIdentity[]>();
  for (const i of identities) if (i.status === 'matched' && i.profileId) {
    claims.set(i.profileId, [...(claims.get(i.profileId) ?? []), i]);
  }
  for (const list of claims.values()) if (list.length > 1) {
    for (const i of list) { i.candidateProfileIds = [i.profileId!]; i.status = 'ambiguous'; i.reason = 'Several EHR IDs share this directory record'; }
  }

  const statesByProfile = new Map<string, string[]>();
  for (const i of identities) if (i.status === 'matched' && i.profileId) statesByProfile.set(i.profileId, i.states);
  return { identities, statesByProfile };
}

/** Snapshot older than this (hours since our fetch) is labeled stale. */
export const PCP_STALE_AFTER_HOURS = 36;

export function isSnapshotStale(pulledAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!pulledAt) return true;
  const t = new Date(pulledAt).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > PCP_STALE_AFTER_HOURS * 3600_000;
}

/** Professions in scope of the query (provider_type = NursePractitioner). */
const IN_SCOPE_PROFESSIONS = new Set(['NP', 'APN']);

export type PcpCellKind = 'states' | 'not_applicable' | 'needs_review' | 'excluded' | 'none_returned' | 'unavailable';
export interface PcpCell { kind: PcpCellKind; text: string; states: string[]; detail: string }

/**
 * Per-provider cell for Active PCP Telemedicine States. "Not applicable" is
 * only used when the provider's recorded profession is outside the query's
 * scope — never inferred from absence in the result.
 */
export function pcpCellFor(
  profile: { id: string; profession: string | null; npi_number: string | null },
  data: { identities: EhrIdentity[] } | null | undefined,
): PcpCell {
  const mk = (kind: PcpCellKind, text: string, detail: string, states: string[] = []): PcpCell => ({ kind, text, detail, states });
  if (OUT_OF_SCOPE_PROFILE_IDS[profile.id]) return mk('excluded', 'Excluded', OUT_OF_SCOPE_PROFILE_IDS[profile.id]);
  if (!data) return mk('unavailable', 'Unavailable', 'No coverage snapshot could be loaded');
  const mine = data.identities.filter((i) => i.profileId === profile.id || i.candidateProfileIds?.includes(profile.id));
  const ex = mine.find((i) => i.status === 'excluded');
  if (ex) return mk('excluded', 'Excluded', ex.reason);
  const amb = mine.find((i) => i.status === 'ambiguous');
  if (amb) return mk('needs_review', 'Identity needs review', amb.reason);
  const m = mine.find((i) => i.status === 'matched');
  if (m) return m.nameDiffers
    ? mk('needs_review', m.states.join(', '), `Matched by NPI; EHR name "${m.ehrName}" differs — name review needed`, m.states)
    : mk('states', m.states.join(', '), 'Matched by NPI', m.states);
  if (!profile.profession) return mk('unavailable', 'Unavailable', 'Profession not recorded, so scope cannot be determined');
  if (!IN_SCOPE_PROFESSIONS.has(profile.profession)) return mk('not_applicable', 'Not applicable', 'Profession is outside PCP telemedicine (query covers nurse practitioners only)');
  if (!normNpi(profile.npi_number)) return mk('needs_review', 'Identity needs review', 'No NPI on this record, so it cannot be linked to the EHR');
  return mk('none_returned', 'No coverage returned', 'NPI not present in the latest query result');
}
