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

/** Single letters in a name, folded and lowercased: the initials it states. */
function statedInitials(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((token) => token.length === 1)
  );
}

/**
 * True when two names state initials that cannot be the same person.
 *
 * Compares sets rather than positions because both orders occur in the wild —
 * the tennis corpus writes `Popyrin A.` while providers write `A. Popyrin`.
 * Absent initials on either side are not evidence of conflict, so a bare
 * surname never blocks a match.
 */
export function initialsConflict(left: string, right: string): boolean {
  const leftInitials = statedInitials(left);
  const rightInitials = statedInitials(right);
  if (!leftInitials.size || !rightInitials.size) return false;
  return ![...leftInitials].some((letter) => rightInitials.has(letter));
}

/**
 * Name alignment for people rather than clubs.
 *
 * `teamNamesAlign` discards tokens under three characters, which is right for
 * clubs and wrong for players: it makes initials invisible, so every `Zverev`
 * aligns with every other `Zverev`, as does every `Williams`. For a corpus join
 * that costs a row; for attaching bookmaker prices to a fixture it prices one
 * match from another match's odds, which is the false positive the club matcher
 * is explicitly built to avoid.
 *
 * Kept separate from `teamNamesAlign` rather than folded into it so football's
 * behaviour is byte-for-byte unchanged.
 */
export function personNamesAlign(left: string, right: string): boolean {
  return teamNamesAlign(left, right) && !initialsConflict(left, right);
}
