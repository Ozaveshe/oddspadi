/**
 * Name alignment shared by every provider join.
 *
 * Lifted verbatim out of `providerBackedProvider` so offline loaders (corpus
 * backfills, ops scripts) can reuse the exact matcher the runtime uses instead
 * of growing a second, subtly different one. `providerBackedProvider` re-exports
 * `teamNamesAlign`, so existing importers are unaffected.
 *
 * This module deliberately has no imports: the runtime file pulls in the whole
 * provider stack via `@/` aliases, which a plain `node scripts/*.mjs` run cannot
 * resolve.
 */

// Suffixes and prefixes that identify a club's legal form rather than the club.
// The two providers disagree constantly outside the top five ("Sutjeska" vs
// "FK Sutjeska Nikšić", "ML Vitebsk" vs "FC Vitebsk"), which left in-season
// fixtures priced by nobody because the exact-key lookup never hit.
const CLUB_AFFIX_TOKENS = new Set([
  "fc", "cf", "afc", "sc", "ac", "fk", "kf", "sk", "nk", "hk", "bk", "if", "ks", "cd", "ca",
  "cs", "ss", "ssc", "ud", "sd", "rc", "mfk", "ofk", "club", "calcio", "futbol", "football"
]);

export function teamNameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !CLUB_AFFIX_TOKENS.has(token));
}

function teamNameTokenMatches(left: string, right: string): boolean {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  // "Klaksvik" vs "Klaksvikar" — a transliteration ending, not a different club.
  return shorter.length >= 5 && longer.startsWith(shorter);
}

/**
 * True when two spellings denote the same club. Deliberately a subset test
 * rather than an overlap test: "Manchester United" and "Manchester City" share
 * a token but neither is a subset of the other, so they must not align.
 */
export function teamNamesAlign(left: string, right: string): boolean {
  const leftTokens = teamNameTokens(left);
  const rightTokens = teamNameTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const [fewer, more] = leftTokens.length <= rightTokens.length ? [leftTokens, rightTokens] : [rightTokens, leftTokens];
  return fewer.every((token) => more.some((candidate) => teamNameTokenMatches(token, candidate)));
}
