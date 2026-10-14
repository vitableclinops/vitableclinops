/**
 * PCP coverage (Metabase question 2940) helpers.
 *
 * The question's rows are synced daily into metabase_raw_exports as
 * report_key 'pcp_state_coverage' with rows shaped:
 *   { "State": "CA", "Provider Full Name": "Jane Doe", ... }
 *
 * Exclusion rules (set by ClinOps, Oct 2026):
 *   - Heidi Hershberger, Emily Van-Otoo, Crystal Jones, LaStasha Jackson no
 *     longer work at Vitable: excluded from current coverage, history kept.
 *   - Matthew Vasquez is a health coach (unlicensed role): outside the PCP
 *     coverage scope entirely — never flagged for missing licensure.
 * The Metabase question already omits all five; this list is a local
 * safeguard so a future unfiltered export cannot re-add them.
 *
 * Matching is by canonical FULL name only — never first name alone
 * (e.g. "Lastasha" in the query is LaStasha Jackson, not Antonia Jackson).
 */

import { canonicalName } from '@/lib/nameNormalization';

export interface PcpCoverageRow {
  State?: string;
  'Provider Full Name'?: string;
  [key: string]: unknown;
}

/** Canonical full names excluded from PCP coverage, with the reason. */
export const PCP_COVERAGE_EXCLUSIONS: Record<string, string> = {
  [canonicalName('Heidi Hershberger')]: 'No longer at Vitable',
  [canonicalName('Emily Van-Otoo')]: 'No longer at Vitable',
  [canonicalName('Crystal Jones')]: 'No longer at Vitable',
  [canonicalName('LaStasha Jackson')]: 'No longer at Vitable',
  [canonicalName('Matthew Vasquez')]: 'Health coach — outside PCP coverage scope',
};

/** True when a provider full name is excluded from PCP coverage. */
export function isPcpCoverageExcluded(fullName: string | null | undefined): boolean {
  const key = canonicalName(fullName);
  return key !== '' && key in PCP_COVERAGE_EXCLUSIONS;
}

/**
 * Builds canonical-name → sorted unique state list from raw question rows.
 * Excluded names are dropped regardless of what the export contains.
 */
export function buildPcpCoverageMap(rows: PcpCoverageRow[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = row['Provider Full Name'];
    const state = row.State?.trim();
    if (!name || !state || isPcpCoverageExcluded(name)) continue;
    const key = canonicalName(name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(state);
  }
  return new Map([...map.entries()].map(([k, v]) => [k, [...v].sort()]));
}

/** Looks up a provider's PCP coverage states by their profile full name. */
export function pcpCoverageStatesFor(
  map: Map<string, string[]> | undefined,
  fullName: string | null | undefined,
): string[] {
  if (!map || !fullName || isPcpCoverageExcluded(fullName)) return [];
  return map.get(canonicalName(fullName)) ?? [];
}
