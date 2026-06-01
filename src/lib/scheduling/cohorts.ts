// Cohort lookup for the July 2026 scheduling workbench. Source: ClinOps
// demand methodology (see CLAUDE.md "Demand methodology" block).

export type Cohort = 'Core' | 'Growth' | 'MD-Only' | 'DMV' | 'DE' | '021';

const COHORT_MAP: Record<string, Cohort> = {
  PA: 'Core', NJ: 'Core',
  TX: 'Growth', OH: 'Growth', FL: 'Growth',
  AL: 'MD-Only', IN: 'MD-Only', GA: 'MD-Only', MS: 'MD-Only',
  MO: 'MD-Only', SC: 'MD-Only', TN: 'MD-Only', LA: 'MD-Only',
  DC: 'DMV', MD: 'DMV', VA: 'DMV',
  DE: 'DE',
};

export function cohortFor(state: string | null | undefined): Cohort {
  if (!state) return '021';
  return COHORT_MAP[state.toUpperCase()] ?? '021';
}

export const COHORT_BUFFER_PCT: Record<Cohort, number> = {
  Core: 17.5,
  Growth: 20,
  'MD-Only': 20,
  DMV: 15,
  DE: 15,
  '021': 15,
};