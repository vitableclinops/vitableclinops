export const CONFIRMED_PHYSICIAN_COUNTS_KEY = 'confirmed_physician_counts';

export function confirmedPhysicianCount(value: unknown, physicianId: string | null, state: string): number | null {
  if (!physicianId || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = (value as Record<string, unknown>)[physicianId];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const counts = (record as Record<string, unknown>).counts;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
  const count = (counts as Record<string, unknown>)[state];
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}