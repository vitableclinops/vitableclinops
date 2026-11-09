/**
 * Clinician identity for directory scope.
 *
 * The directory exists to track clinicians — the licensed and member-facing
 * roles Vitable sends to members. Staff records (admins, ops logins, support
 * mailboxes) live in the same `profiles` table but carry no clinical Type, so
 * they are hidden from the default directory view and reached with the
 * "Everyone" scope switch.
 */

export interface ClinicianIdentifiable {
  profession?: string | null;
  credentials?: string | null;
}

/** Normalized clinical role names accepted as a provider Type. */
const CLINICIAN_ROLES = new Set([
  // Physicians
  'md', 'do', 'md do', 'physician',
  // Nursing
  'np', 'apn', 'aprn', 'rn', 'npp', 'pa',
  'nurse practitioner', 'nurse practitioner, certified',
  'registered nurse', 'advanced practice registered nurse',
  // Therapy / counseling
  'lpc', 'lcsw', 'licsw', 'lmft', 'mft', 'lmhc', 'lfcs', 'psyd', 'phd',
  'therapist', 'licensed professional counselor', 'licensed clinical social worker',
  // Coaching service lines (member-facing)
  'mental health coach', 'mh coach', 'health coach',
]);

/** Tokens that mark a credentials string as clinical (e.g. "MSN, FNP-BC"). */
const CLINICIAN_CREDENTIAL_TOKENS = new Set([
  'md', 'do', 'np', 'apn', 'aprn', 'rn', 'npp', 'pa',
  'fnp', 'enp', 'pnp', 'agpcnp', 'fnpbc', 'whnp', 'cnm', 'crna',
  'lpc', 'lcsw', 'licsw', 'lmft', 'mft', 'lmhc', 'lfcs', 'lpcmhsp',
]);

/** Values that explicitly mean "not a clinical Type". */
const NON_CLINICIAN_ROLES = new Set(['', '-', 'admin', 'staff', 'ops', 'n/a', 'na', 'internal']);

/** Lowercase, collapse separators: "Nurse_Practitioner" -> "nurse practitioner". */
export function normalizeRole(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function credentialsIndicateClinician(credentials: string | null | undefined): boolean {
  const normalized = normalizeRole(credentials);
  if (!normalized) return false;
  if (CLINICIAN_ROLES.has(normalized)) return true;
  return normalized
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some(token => CLINICIAN_CREDENTIAL_TOKENS.has(token));
}

/** True when the record carries a clinical Type (or clinical credentials). */
export function isIndependentPhysician(record: ClinicianIdentifiable | null | undefined): boolean {
  if (!record) return false;
  const role = normalizeRole(record.profession);
  return ['md', 'do', 'md do', 'md/do', 'physician', 'doctor of medicine', 'doctor of osteopathic medicine'].includes(role)
    || /\b(?:md|do|m\.d\.?|d\.o\.?)\b/i.test(record.credentials ?? '');
}

export function isClinician(record: ClinicianIdentifiable | null | undefined): boolean {
  if (!record) return false;
  const profession = normalizeRole(record.profession);
  if (profession && !NON_CLINICIAN_ROLES.has(profession)) {
    if (CLINICIAN_ROLES.has(profession)) return true;
    // Unrecognized but populated Types stay visible: never silently hide a provider.
    return true;
  }
  return credentialsIndicateClinician(record.credentials);
}

/** Directory-scope label used by the header: "clinicians" vs "everyone". */
export function directoryScopeLabel(showEveryone: boolean): string {
  return showEveryone ? 'everyone' : 'clinicians';
}

/**
 * Canonical profession keys for filtering and display. Stored values vary
 * ("MH Coach" vs "mental_health_coach", "NP" vs "nurse_practitioner"); the
 * directory treats each group as one profession.
 */
export function canonicalProfessionKey(record: ClinicianIdentifiable | null | undefined): string {
  if (!record) return 'admin';
  const role = normalizeRole(record.profession);
  const creds = normalizeRole(record.credentials);
  const text = role || creds;
  if (!text || NON_CLINICIAN_ROLES.has(text)) return 'admin';
  if (isIndependentPhysician(record)) return 'physician';
  if (['np', 'apn', 'aprn', 'npp', 'nurse practitioner', 'nurse practitioner, certified'].includes(text)
    || (!role && /\b(np|aprn|fnp|agpcnp)\b/i.test(record.credentials ?? ''))) return 'np';
  if (['lpc', 'lcsw', 'licsw', 'lmft', 'mft', 'lmhc', 'lfcs', 'psyd', 'phd', 'therapist',
    'licensed professional counselor', 'licensed clinical social worker'].includes(text)) return 'therapist';
  if (['mental health coach', 'mh coach'].includes(text)) return 'mh_coach';
  if (text === 'health coach') return 'health_coach';
  if (['rn', 'registered nurse'].includes(text)) return 'rn';
  return text.replace(/\s+/g, '_');
}

/** Display label for a canonical profession key. */
export function professionDisplayLabel(key: string): string {
  switch (key) {
    case 'physician': return 'Physician (MD/DO)';
    case 'np': return 'Nurse Practitioner (NP/APN)';
    case 'therapist': return 'Therapist (LPC/LCSW)';
    case 'mh_coach': return 'MH Coach';
    case 'health_coach': return 'Health Coach';
    case 'rn': return 'RN';
    case 'admin': return 'Admin';
    default: return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

/** Therapy, social work and coaching roles never carry NP state requirements. */
export function isNonNpBehavioralRole(record: ClinicianIdentifiable | null | undefined): boolean {
  if (!record) return false;
  const text = `${normalizeRole(record.profession)} ${normalizeRole(record.credentials)}`;
  return /\b(msw|lcsw|licsw|lsw|lpc|lmft|mft|lmhc|lfcs|psyd|therapist|therapy|counselor|social worker|coach)\b/.test(text);
}
