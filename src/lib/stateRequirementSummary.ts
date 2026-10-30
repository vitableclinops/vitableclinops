// Plain-language "Requirements:" line for a state's NP practice rules.
export function stateRequirementSummary(state: string, collabType?: string | null, caRequired?: boolean | null): string {
  const s = state.toUpperCase();
  if (s === 'VA') return 'Autonomous Practice + Rx Authority OR Rx Authority + Collaborative Agreement';
  if (s === 'NY') return 'Collaborative Agreement OR Verified Independent Practice (only needed without prescriptive authority)';
  if (s === 'WV' || s === 'OK') return 'Collaborative Agreement OR Verified Independent Practice';
  const t = (collabType ?? '').toLowerCase();
  if (t === 'md_only') return 'Physicians (MD/DO) only. NPs cannot practice here';
  if (t === 'never') return 'No collaborative agreement needed';
  if (t === 'conditional') return 'Collaborative Agreement (only in some cases; see state notes)';
  if (t === 'ttp') return 'Collaborative Agreement until transition-to-practice hours are met';
  if (t === 'always' || caRequired) return 'Collaborative Agreement';
  return 'No collaborative agreement needed';
}
