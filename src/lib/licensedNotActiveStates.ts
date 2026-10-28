import type { PcpCell } from '@/lib/pcpCoverage';

export const LICENSED_NOT_ACTIVE_UNAVAILABLE = 'Coverage unavailable';
export const LICENSED_NOT_ACTIVE_REVIEW = 'Identity needs review';
export const LICENSED_NOT_ACTIVE_NONE = 'None';

/** Presentation-only set difference; never changes licenses or EHR activation. */
export function licensedNotActiveStates(licensed: string[], active: string[]): string[] {
  const normalize = (values: string[]) => values.map(s => s.trim().toUpperCase()).filter(Boolean);
  const activeSet = new Set(normalize(active));
  return [...new Set(normalize(licensed))].filter(s => !activeSet.has(s)).sort();
}

export function licensedNotActiveLabel(licensed: string[], coverage: PcpCell | null | undefined): string | null {
  if (!licensed.length) return null;
  if (!coverage || coverage.kind === 'unavailable') return LICENSED_NOT_ACTIVE_UNAVAILABLE;
  if (coverage.kind === 'needs_review' && !coverage.states.length) return LICENSED_NOT_ACTIVE_REVIEW;
  return licensedNotActiveStates(licensed, coverage.states).join(', ') || LICENSED_NOT_ACTIVE_NONE;
}

/**
 * The cell text is either a real state list or a status message. Only the
 * former is worth a full-list hover popup.
 */
export function licensedNotActiveStateList(label: string | null | undefined): string | null {
  const text = (label || '').trim();
  if (!text || text === LICENSED_NOT_ACTIVE_UNAVAILABLE || text === LICENSED_NOT_ACTIVE_REVIEW || text === LICENSED_NOT_ACTIVE_NONE) {
    return null;
  }
  return text;
}