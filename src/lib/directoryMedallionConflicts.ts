type Conflict = { field: string; local: string | null; medallion: string | null };

const EQUIVALENT_EMPLOYMENT_TYPES = new Set(['1099', 'contractor', 'prn']);

/** Filter equivalent employment terminology only; preserve all substantive differences. */
export function directoryMedallionConflicts<T extends Conflict>(_profileId: string, conflicts: T[]): T[] {
  return conflicts.filter(c => !(c.field === 'employment_type'
    && EQUIVALENT_EMPLOYMENT_TYPES.has((c.local ?? '').trim().toLowerCase())
    && EQUIVALENT_EMPLOYMENT_TYPES.has((c.medallion ?? '').trim().toLowerCase())));
}