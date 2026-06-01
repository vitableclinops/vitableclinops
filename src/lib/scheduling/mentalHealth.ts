export type MentalHealthServiceLine = 'mh_coaching' | 'therapy';

const MH_COACHING_PROFESSIONS = new Set([
  'mental_health_coach',
  'mh_coach',
  'health_coach',
]);

const THERAPY_PROFESSIONS = new Set([
  'lpc',
  'lcsw',
  'licsw',
  'lmft',
  'mft',
  'lmhc',
  'therapist',
  'licensed_clinical_social_worker',
  'licensed_professional_counselor',
]);

const MENTAL_HEALTH_PROVIDER_OVERRIDES = new Map<string, MentalHealthServiceLine>([
  ['matthew vazquez', 'mh_coaching'],
  ['matthew vasquez', 'mh_coaching'],
  ['jamie fuentes', 'mh_coaching'],
  ['jennifer yost', 'mh_coaching'],
  ['esha shah', 'mh_coaching'],
  ['liana griebsch', 'mh_coaching'],
  ['li griebsch', 'mh_coaching'],
  ['li greibsch', 'mh_coaching'],
  ['michelle diederich', 'mh_coaching'],
  ['margaret margo mulgrew', 'therapy'],
  ['margaret mulgrew', 'therapy'],
  ['margo mulgrew', 'therapy'],
  ['richard travis rash', 'therapy'],
  ['richard rash', 'therapy'],
  ['mishelle lockerby', 'therapy'],
  ['mishelle lockerby direct shifts', 'therapy'],
]);

const normKey = (value: string | null | undefined) =>
  (value ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const normProviderName = (name: string | null | undefined) =>
  (name ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

export const SERVICE_LINE_LABEL: Record<MentalHealthServiceLine, string> = {
  mh_coaching: 'MH Coaching',
  therapy: 'Therapy / LPC',
};

export const mentalHealthServiceLineForProfession = (
  profession: string | null | undefined,
): MentalHealthServiceLine | null => {
  const norm = normKey(profession);
  if (MH_COACHING_PROFESSIONS.has(norm)) return 'mh_coaching';
  if (THERAPY_PROFESSIONS.has(norm)) return 'therapy';
  return null;
};

export const mentalHealthServiceLineForProvider = (
  profession: string | null | undefined,
  providerName?: string | null,
): MentalHealthServiceLine | null => {
  const override = MENTAL_HEALTH_PROVIDER_OVERRIDES.get(normProviderName(providerName));
  if (override) return override;
  return mentalHealthServiceLineForProfession(profession);
};

export const isMentalHealthProvider = (
  profession: string | null | undefined,
  providerName?: string | null,
) => mentalHealthServiceLineForProvider(profession, providerName) !== null;
