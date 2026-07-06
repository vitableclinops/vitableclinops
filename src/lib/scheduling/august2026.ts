export const AUGUST_2026_MONTH = '2026-08-01';
export const AUGUST_2026_JOTFORM_DEADLINE_LABEL = 'July 7, 2026';
export const AUGUST_2026_FAIRNESS_TOLERANCE_PCT = 25;
export const AUGUST_2026_TOTAL_TARGET_HOURS = 2250;
export const AUGUST_2026_TOTAL_TARGET_SLOTS = 4500;
export const AUGUST_2026_TARGET_METHODOLOGY_VERSION = 'august_2026_2250_state_targets_v3';
export const AUGUST_2026_DS_NP_MIN_HOURS = 60;
export const AUGUST_2026_DS_NP_TARGET_HOURS = 80;

export type August2026StateTarget = {
  state: string;
  targetHours: number;
  targetSlots: number;
  baselineHours: number;
  maxHours: number;
  inactive?: boolean;
};

export const AUGUST_2026_STATE_TARGETS: August2026StateTarget[] = [
  { state: 'PA', targetHours: 809, targetSlots: 1618, baselineHours: 809, maxHours: 809 },
  { state: 'NJ', targetHours: 208, targetSlots: 416, baselineHours: 208, maxHours: 208 },
  { state: 'TX', targetHours: 165, targetSlots: 330, baselineHours: 165, maxHours: 165 },
  { state: 'FL', targetHours: 165, targetSlots: 330, baselineHours: 165, maxHours: 165 },
  { state: 'DE', targetHours: 150, targetSlots: 300, baselineHours: 150, maxHours: 150 },
  { state: 'OH', targetHours: 93, targetSlots: 186, baselineHours: 93, maxHours: 93 },
  { state: 'VA', targetHours: 68, targetSlots: 136, baselineHours: 68, maxHours: 68 },
  { state: 'WA', targetHours: 66, targetSlots: 132, baselineHours: 66, maxHours: 66 },
  { state: 'IN', targetHours: 64, targetSlots: 128, baselineHours: 64, maxHours: 64 },
  { state: 'MD', targetHours: 54, targetSlots: 108, baselineHours: 54, maxHours: 54 },
  { state: 'IL', targetHours: 40, targetSlots: 80, baselineHours: 40, maxHours: 40 },
  { state: 'GA', targetHours: 36, targetSlots: 72, baselineHours: 36, maxHours: 36 },
  { state: 'CO', targetHours: 36, targetSlots: 72, baselineHours: 36, maxHours: 36 },
  { state: 'NC', targetHours: 32, targetSlots: 64, baselineHours: 32, maxHours: 32 },
  { state: 'MI', targetHours: 32, targetSlots: 64, baselineHours: 32, maxHours: 32 },
  { state: 'CA', targetHours: 29, targetSlots: 58, baselineHours: 29, maxHours: 29 },
  { state: 'AZ', targetHours: 21, targetSlots: 42, baselineHours: 21, maxHours: 21 },
  { state: 'MN', targetHours: 20, targetSlots: 40, baselineHours: 20, maxHours: 20 },
  { state: 'CT', targetHours: 17, targetSlots: 34, baselineHours: 17, maxHours: 17 },
  { state: 'MA', targetHours: 15, targetSlots: 30, baselineHours: 15, maxHours: 15 },
  { state: 'AL', targetHours: 13, targetSlots: 26, baselineHours: 13, maxHours: 13 },
  { state: 'NH', targetHours: 11, targetSlots: 22, baselineHours: 11, maxHours: 11 },
  { state: 'KY', targetHours: 11, targetSlots: 22, baselineHours: 11, maxHours: 11 },
  { state: 'OR', targetHours: 11, targetSlots: 22, baselineHours: 11, maxHours: 11 },
  { state: 'MO', targetHours: 8, targetSlots: 16, baselineHours: 8, maxHours: 8 },
  { state: 'SC', targetHours: 8, targetSlots: 16, baselineHours: 8, maxHours: 8 },
  { state: 'TN', targetHours: 8, targetSlots: 16, baselineHours: 8, maxHours: 8 },
  { state: 'UT', targetHours: 8, targetSlots: 16, baselineHours: 8, maxHours: 8 },
  { state: 'LA', targetHours: 6, targetSlots: 12, baselineHours: 6, maxHours: 6 },
  { state: 'NM', targetHours: 6, targetSlots: 12, baselineHours: 6, maxHours: 6 },
  { state: 'RI', targetHours: 6, targetSlots: 12, baselineHours: 6, maxHours: 6 },
  { state: 'KS', targetHours: 6, targetSlots: 12, baselineHours: 6, maxHours: 6 },
  { state: 'NY', targetHours: 5, targetSlots: 10, baselineHours: 5, maxHours: 5 },
  { state: 'ME', targetHours: 5, targetSlots: 10, baselineHours: 5, maxHours: 5 },
  { state: 'AK', targetHours: 4, targetSlots: 8, baselineHours: 4, maxHours: 4 },
  { state: 'AR', targetHours: 3, targetSlots: 6, baselineHours: 3, maxHours: 3 },
  { state: 'WV', targetHours: 2, targetSlots: 4, baselineHours: 2, maxHours: 2 },
  { state: 'DC', targetHours: 2, targetSlots: 4, baselineHours: 2, maxHours: 2 },
  { state: 'MS', targetHours: 1, targetSlots: 2, baselineHours: 1, maxHours: 1 },
  { state: 'NV', targetHours: 1, targetSlots: 2, baselineHours: 1, maxHours: 1 },
  { state: 'WI', targetHours: 1, targetSlots: 2, baselineHours: 1, maxHours: 1 },
  { state: 'ID', targetHours: 1, targetSlots: 2, baselineHours: 1, maxHours: 1 },
  { state: 'WY', targetHours: 1, targetSlots: 2, baselineHours: 1, maxHours: 1 },
  { state: 'OK', targetHours: 1, targetSlots: 2, baselineHours: 1, maxHours: 1 },
  { state: 'NE', targetHours: 1, targetSlots: 2, baselineHours: 1, maxHours: 1 },
];

export const AUGUST_2026_STATE_TARGET_BY_STATE = new Map(
  AUGUST_2026_STATE_TARGETS.map(target => [target.state, target]),
);

export const AUGUST_2026_DIRECTSHIFTS_NP_NAMES = [
  'Akosua Norgbey',
  'Brittney Afram',
  'Cassondra Hawkins',
  'Jarrod Nero',
  'Stephanie Lumsden',
] as const;

const normalizedName = (name: string | null | undefined) =>
  (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const AUGUST_2026_DIRECTSHIFTS_NP_NAME_SET = new Set(
  AUGUST_2026_DIRECTSHIFTS_NP_NAMES.map(normalizedName),
);

export const isAugust2026Month = (month: string | null | undefined) =>
  (month ?? '').slice(0, 10) === AUGUST_2026_MONTH;

export const isAugust2026DirectShiftsNp = (name: string | null | undefined) =>
  AUGUST_2026_DIRECTSHIFTS_NP_NAME_SET.has(normalizedName(name));

export const august2026DsNpStatus = (submittedHours: number, acceptedHours: number) => {
  if (submittedHours > AUGUST_2026_DS_NP_TARGET_HOURS && acceptedHours >= AUGUST_2026_DS_NP_TARGET_HOURS) {
    return 'Above target (held)';
  }
  if (acceptedHours >= AUGUST_2026_DS_NP_TARGET_HOURS) return 'At target';
  if (acceptedHours >= AUGUST_2026_DS_NP_MIN_HOURS) return 'At minimum';
  return 'Under minimum';
};
