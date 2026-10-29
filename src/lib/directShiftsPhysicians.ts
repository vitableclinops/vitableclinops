/** DirectShifts supervising physicians: agreements they lead never need an attached document link. */
export const DIRECT_SHIFTS_PHYSICIANS = [
  'Dr. Anika Ramos (Direct Shifts)',
  'Dr. Dave Webster (Direct Shifts)',
] as const;

const key = (s: string) => s.toLowerCase().replace(/\(.*?\)|\bdr\.?\s*/g, '').replace(/[^a-z]/g, '');
const EXEMPT = new Set(['anikaramos', 'davewebster', 'davidwebster'].map(key));

export function isDocumentExemptPhysician(name: string | null | undefined): boolean {
  return !!name && EXEMPT.has(key(name));
}
