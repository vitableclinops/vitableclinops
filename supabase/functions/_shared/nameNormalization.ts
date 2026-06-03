/** Deno-compatible copy of src/lib/nameNormalization.ts */

const CREDENTIAL_PATTERN =
  /\b(md|do|np|aprn|crnp|pa-c|pa|rn|bsn|msn|dnp|phd|fnp|fnp-c|fnp-bc|agacnp|agpcnp|pmhnp|crna|cnm|dnp-c|lcsw|lpc|mft|psyd)\b\.?/gi;

const SUFFIX_PATTERN = /\b(jr\.?|sr\.?|ii|iii|iv)\b\.?/gi;

const COMMA_LAST_FIRST = /^([^,]+),\s*(.+)$/;

export function canonicalName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.trim();

  const commaMatch = COMMA_LAST_FIRST.exec(s);
  if (commaMatch) s = `${commaMatch[2].trim()} ${commaMatch[1].trim()}`;

  s = s.replace(CREDENTIAL_PATTERN, ' ');
  s = s.replace(SUFFIX_PATTERN, ' ');
  s = s.replace(/^dr\.?\s+/i, '');

  const parts = s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  if (parts.length >= 3) {
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }
  return parts.join(' ');
}

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

export function fuzzyScore(a: string, b: string): number {
  const ca = canonicalName(a);
  const cb = canonicalName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const jaccard = jaccardBigrams(ca, cb);
  const maxLen = Math.max(ca.length, cb.length);
  const lev = maxLen === 0 ? 1 : 1 - levenshtein(ca, cb) / maxLen;
  return 0.6 * jaccard + 0.4 * lev;
}

export const FUZZY_MATCH_THRESHOLD = 0.85;
