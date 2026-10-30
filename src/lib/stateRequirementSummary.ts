// Plain-language "Requirements:" line for a state's NP practice rules.
export function stateRequirementSummary(state: string, collabType?: string | null, caRequired?: boolean | null): string {
  const s = state.toUpperCase();
  if (s === 'VA') return '"Autonomous Practice" + "Rx Authority" License Designations OR "Rx Authority" License Designation + Collab Agreement';
  if (s === 'NY') return 'Collab Agreement OR Verified Independent Practice (only needed without prescriptive authority)';
  if (s === 'WV' || s === 'OK') return 'Collab Agreement OR Verified Independent Practice';
  const t = (collabType ?? '').toLowerCase();
  if (t === 'md_only') return 'Physicians (MD/DO) only. NPs cannot practice here';
  if (t === 'never') return 'No collaborative agreement needed';
  if (t === 'conditional') return 'Collab Agreement (only in some cases; see state notes)';
  if (t === 'ttp') return 'Collab Agreement until transition-to-practice hours are met';
  if (t === 'always' || caRequired) return 'Collab Agreement';
  return 'No collaborative agreement needed';
}
