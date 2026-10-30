/** DirectShifts supervising physicians: agreements they lead never need an attached document link. */
export const DIRECT_SHIFTS_PHYSICIANS = [
  'Dr. Anika Ramos (Direct Shifts)',
  'Dr. Dave Webster (Direct Shifts)',
  'Dr. Annie Casta (Direct Shifts)',
] as const;

const key = (s: string) => s.toLowerCase().replace(/\(.*?\)|\bdr\.?\s*/g, '').replace(/[^a-z]/g, '');
const EXEMPT = new Set(['anikaramos', 'davewebster', 'davidwebster', 'anniecasta'].map(key));

export function isDocumentExemptPhysician(name: string | null | undefined): boolean {
  return !!name && (EXEMPT.has(key(name)) || /\bdirect\s*shifts\b/i.test(name));
}

/** Remove a leading "Dr."/"Dr" so displays that prepend "Dr." never double it. */
export function stripDrPrefix(name: string | null | undefined): string {
  return (name || '').replace(/^\s*dr\.?\s+/i, '');
}
