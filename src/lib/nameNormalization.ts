/**
 * Provider name normalization utilities.
 *
 * Produces a canonical key from a provider's full name by:
 *   1. Stripping common credentials (MD, NP, APRN, PA-C, RN, DNP, PhD, etc.)
 *   2. Stripping suffixes (Jr., Sr., II, III)
 *   3. Removing middle names / initials
 *   4. Normalizing "Last, First" → "First Last"
 *   5. Lowercasing and trimming
 *
 * This canonical key is used as the join key between Homebase employee names
 * and provider profile full_name / first_name + last_name.
 */

const CREDENTIAL_PATTERN =
  /\b(md|do|np|aprn|pa-c|pa|rn|bsn|msn|dnp|phd|fnp|fnp-c|fnp-bc|agacnp|agpcnp|pmhnp|crna|cnm|dnp-c|lcsw|lpc|mft|psyd)\b\.?/gi;

const SUFFIX_PATTERN = /\b(jr\.?|sr\.?|ii|iii|iv)\b\.?/gi;

const COMMA_LAST_FIRST = /^([^,]+),\s*(.+)$/;

/**
 * Produces a lowercase canonical key for a full name string.
 * Used for fuzzy matching between Homebase employees and profiles.
 *
 * Examples:
 *   "Smith, Jane A. MD"   → "jane smith"
 *   "Dr. John D. Doe NP"  → "john doe"
 *   "emily johnson fnp-c" → "emily johnson"
 */
export function canonicalName(raw: string | null | undefined): string {
  if (!raw) return '';

  let s = raw.trim();

  // "Last, First [Middle]" → "First [Middle] Last"
  const commaMatch = COMMA_LAST_FIRST.exec(s);
  if (commaMatch) {
    s = `${commaMatch[2].trim()} ${commaMatch[1].trim()}`;
  }

  // Strip credentials and suffixes
  s = s.replace(CREDENTIAL_PATTERN, ' ');
  s = s.replace(SUFFIX_PATTERN, ' ');

  // Strip leading "Dr." or "Dr "
  s = s.replace(/^dr\.?\s+/i, '');

  // Collapse whitespace
  const parts = s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  // Remove single-character middle initials/names (keep only first + last)
  if (parts.length >= 3) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    return `${first} ${last}`;
  }

  return parts.join(' ');
}

/**
 * Jaccard similarity on character bigrams.
 * Returns 0–1 (1 = identical).
 */
function jaccardBigrams(a: string, b: string): number {
  if (!a || !b) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Levenshtein distance (edit distance).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Combined fuzzy score (0–1). ≥ 0.85 is considered a confident match.
 */
export function fuzzyScore(a: string, b: string): number {
  const ca = canonicalName(a);
  const cb = canonicalName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  const jaccard = jaccardBigrams(ca, cb);
  const maxLen = Math.max(ca.length, cb.length);
  const lev = maxLen === 0 ? 1 : 1 - levenshtein(ca, cb) / maxLen;

  // Weight Jaccard slightly more for name matching
  return 0.6 * jaccard + 0.4 * lev;
}

/** Minimum fuzzy score to consider a match confident. */
export const FUZZY_MATCH_THRESHOLD = 0.85;
