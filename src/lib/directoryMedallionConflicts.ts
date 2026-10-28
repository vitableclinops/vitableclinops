type Conflict = { field: string; local: string | null; medallion: string | null };

/** Acknowledges only the reviewed classification difference; future changes remain visible. */
export function directoryMedallionConflicts(profileId: string, conflicts: Conflict[]) {
  return conflicts.filter(c => !(profileId === 'c69f6935-34eb-4ba2-b4c0-794d95370027'
    && c.field === 'employment_type' && c.local === '1099' && c.medallion === 'prn'));
}