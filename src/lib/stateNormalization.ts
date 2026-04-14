/**
 * State normalization utilities.
 * Converts between 2-letter abbreviations and full state names,
 * and normalizes any mixed input to a canonical form.
 */

const STATE_MAP: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

// Reverse map: full name (lowercase) → abbreviation
const NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_MAP).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

// Additional aliases
const ALIASES: Record<string, string> = {
  'washington dc': 'DC',
  'washington, dc': 'DC',
  'd.c.': 'DC',
  'dc': 'DC',
  'district of columbia': 'DC',
};

/** Returns the 2-letter abbreviation for any state input, or null if unrecognized. */
export function toAbbreviation(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Already a 2-letter code
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    return upper in STATE_MAP ? upper : null;
  }

  const lower = trimmed.toLowerCase();
  return ALIASES[lower] ?? NAME_TO_ABBR[lower] ?? null;
}

/** Returns the full state name for a 2-letter abbreviation, or null. */
export function toFullName(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  return STATE_MAP[abbr.trim().toUpperCase()] ?? null;
}

/** Normalizes to 2-letter abbreviation, throwing if unrecognized. */
export function normalizeState(input: string): string {
  const abbr = toAbbreviation(input);
  if (!abbr) throw new Error(`Unrecognized state: "${input}"`);
  return abbr;
}

/** Returns true if the string is a valid 2-letter state abbreviation. */
export function isValidAbbreviation(s: string): boolean {
  return s.trim().toUpperCase() in STATE_MAP;
}

/** All 51 valid abbreviations (50 states + DC). */
export const ALL_STATE_ABBREVIATIONS: readonly string[] = Object.keys(STATE_MAP);
