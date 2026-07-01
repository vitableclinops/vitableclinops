export const AUGUST_2026_MONTH = '2026-08-01';
export const AUGUST_2026_JOTFORM_DEADLINE_LABEL = 'July 7, 2026';
export const AUGUST_2026_FAIRNESS_TOLERANCE_PCT = 25;
export const AUGUST_2026_BUFFER_PCT = 17.5;
export const AUGUST_2026_DS_NP_MIN_HOURS = 60;
export const AUGUST_2026_DS_NP_TARGET_HOURS = 80;

export type August2026StateTarget = {
  state: string;
  baselineHours: number;
  maxHours: number;
  inactive?: boolean;
};

export const AUGUST_2026_STATE_TARGETS: August2026StateTarget[] = [
  { state: 'PA', baselineHours: 429, maxHours: 504 },
  { state: 'NJ', baselineHours: 110, maxHours: 130 },
  { state: 'TX', baselineHours: 87, maxHours: 102 },
  { state: 'FL', baselineHours: 88, maxHours: 103 },
  { state: 'DE', baselineHours: 79, maxHours: 93 },
  { state: 'OH', baselineHours: 49, maxHours: 58 },
  { state: 'VA', baselineHours: 36, maxHours: 42 },
  { state: 'WA', baselineHours: 35, maxHours: 41 },
  { state: 'IN', baselineHours: 34, maxHours: 40 },
  { state: 'MD', baselineHours: 29, maxHours: 34 },
  { state: 'IL', baselineHours: 21, maxHours: 25 },
  { state: 'GA', baselineHours: 19, maxHours: 23 },
  { state: 'CO', baselineHours: 19, maxHours: 23 },
  { state: 'NC', baselineHours: 17, maxHours: 20 },
  { state: 'MI', baselineHours: 17, maxHours: 20 },
  { state: 'CA', baselineHours: 15, maxHours: 18 },
  { state: 'AZ', baselineHours: 11, maxHours: 13 },
  { state: 'MN', baselineHours: 10, maxHours: 12 },
  { state: 'CT', baselineHours: 9, maxHours: 11 },
  { state: 'MA', baselineHours: 8, maxHours: 10 },
  { state: 'AL', baselineHours: 7, maxHours: 8 },
  { state: 'NH', baselineHours: 6, maxHours: 7 },
  { state: 'KY', baselineHours: 6, maxHours: 7 },
  { state: 'OR', baselineHours: 6, maxHours: 7 },
  { state: 'MO', baselineHours: 4, maxHours: 5 },
  { state: 'SC', baselineHours: 4, maxHours: 5 },
  { state: 'TN', baselineHours: 4, maxHours: 5 },
  { state: 'UT', baselineHours: 4, maxHours: 5 },
  { state: 'LA', baselineHours: 3, maxHours: 4 },
  { state: 'NM', baselineHours: 3, maxHours: 4 },
  { state: 'RI', baselineHours: 3, maxHours: 4 },
  { state: 'KS', baselineHours: 3, maxHours: 4 },
  { state: 'NY', baselineHours: 3, maxHours: 3 },
  { state: 'ME', baselineHours: 2, maxHours: 3 },
  { state: 'AK', baselineHours: 2, maxHours: 2 },
  { state: 'AR', baselineHours: 2, maxHours: 2 },
  { state: 'WV', baselineHours: 1, maxHours: 1 },
  { state: 'DC', baselineHours: 1, maxHours: 1 },
  { state: 'MS', baselineHours: 0, maxHours: 1 },
  { state: 'NV', baselineHours: 0, maxHours: 1 },
  { state: 'WI', baselineHours: 0, maxHours: 1 },
  { state: 'ID', baselineHours: 0, maxHours: 1 },
  { state: 'WY', baselineHours: 0, maxHours: 0, inactive: true },
  { state: 'OK', baselineHours: 0, maxHours: 0, inactive: true },
  { state: 'NE', baselineHours: 0, maxHours: 0, inactive: true },
];

export const AUGUST_2026_STATE_TARGET_BY_STATE = new Map(
  AUGUST_2026_STATE_TARGETS.map(target => [target.state, target]),
);

export const AUGUST_2026_DIRECTSHIFTS_NP_NAMES = [
  'Abby Grant',
  'Akosua Norgbey',
  'Brittney Afram',
  'Cassondra Hawkins',
  'Jarrod Nero',
  'Nycole Cox',
  'Stacy Lynn',
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
