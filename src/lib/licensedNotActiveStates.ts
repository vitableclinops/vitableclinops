import type { PcpCell } from '@/lib/pcpCoverage';

/** Presentation-only set difference; never changes licenses or EHR activation. */
export function licensedNotActiveStates(licensed: string[], active: string[]): string[] {
  const normalize = (values: string[]) => values.map(s => s.trim().toUpperCase()).filter(Boolean);
  const activeSet = new Set(normalize(active));
  return [...new Set(normalize(licensed))].filter(s => !activeSet.has(s)).sort();
}

export function licensedNotActiveLabel(licensed: string[], coverage: PcpCell | null | undefined): string | null {
  if (!licensed.length) return null;
  if (!coverage || coverage.kind === 'unavailable') return 'Coverage unavailable';
  if (coverage.kind === 'needs_review' && !coverage.states.length) return 'Identity needs review';
  return licensedNotActiveStates(licensed, coverage.states).join(', ') || 'None';
}