import { sheetLicenseStatus, type SheetLicense } from '@/lib/stateSheetRequirements';
import { pcpCellFor, isTestAccountDirectoryRecord, OUT_OF_SCOPE_PROFILE_IDS, type EhrIdentity } from '@/lib/pcpCoverage';
import { isOffboarded } from '@/lib/employeeVisibility';
import { isClinician, isIndependentPhysician, isNonNpBehavioralRole } from '@/lib/clinicianRoles';

export interface ReadinessProfile {
  id: string; profession: string | null; credentials?: string | null; npi_number: string | null;
  employment_status?: string | null; directory_visibility?: string | null; directory_visibility_reason?: string | null;
}

/** Absence or unresolved identity never proves EHR inactivity. No activation records are written. */
export function licensedStateReadiness<P extends ReadinessProfile>(profiles: P[], licenses: SheetLicense[], coverage: { identities: EhrIdentity[] } | null | undefined, day = new Date()) {
  return profiles.flatMap(provider => {
    // Independent physicians (MD/DO) never need NP requirement reviews.
    if (!isClinician(provider) || isIndependentPhysician(provider) || isNonNpBehavioralRole(provider) || isOffboarded(provider.employment_status) || isTestAccountDirectoryRecord(provider) || OUT_OF_SCOPE_PROFILE_IDS[provider.id]) return [];
    const cell = pcpCellFor(provider, coverage);
    const states = [...new Set(licenses.filter(l => l.profileId === provider.id).map(l => l.state))].sort();
    return states.flatMap(state => {
      if (sheetLicenseStatus(provider.id, state, licenses, [], day) !== 'valid') return [];
      if (cell.states.includes(state)) return [];
      return [{ provider, state, activation: cell.kind === 'states' ? 'not_active' as const : 'unconfirmed' as const, activationDetail: cell.detail }];
    });
  });
}