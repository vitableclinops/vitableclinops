type Conflict = { field: string; local: string | null; medallion: string | null };

/** Employment classifications are locally owned and need not match Medallion. */
export function directoryMedallionConflicts<T extends Conflict>(_profileId: string, conflicts: T[]): T[] {
  return conflicts.filter(c => c.field !== 'employment_type');
}