/**
 * Unified search across teams, players, competitions and fixtures.
 *
 * Everything resolves to a canonical entity. A result that says "Arsenal"
 * without saying *which* Arsenal — the club, the women's side, or a fixture
 * they are in — sends the reader somewhere they did not ask for, and a search
 * that guesses between them is worse than one that offers both.
 *
 * So a result always carries its kind and its canonical id, and ties are shown
 * rather than resolved.
 */

export type SearchEntityKind = "team" | "player" | "competition" | "fixture";

export type SearchableEntity = {
  kind: SearchEntityKind;
  /** Canonical identifier. The thing the route is built from. */
  id: string;
  name: string;
  /** Disambiguating context: country for a team, competition for a fixture. */
  context: string | null;
  /** Aliases and alternate spellings, already normalised by the caller. */
  aliases?: string[];
  /**
   * Editorial weight, not a match score. A top-flight club outranks a
   * fourth-tier namesake at equal textual similarity — which is the common
   * case, not an edge case.
   */
  prominence?: number;
  /** Fixtures only: used to prefer the imminent over the long past. */
  kickoffAt?: string | null;
};

export type SearchResult = {
  entity: SearchableEntity;
  score: number;
  /** Which string actually matched, so the UI can show why. */
  matchedOn: string;
  matchKind: "exact" | "prefix" | "word_prefix";
};

export type SearchOptions = {
  kinds?: SearchEntityKind[];
  limit?: number;
  now?: Date;
};

/**
 * Fold accents and punctuation so a reader typing plain ASCII finds
 * "Atlético" and "Bayern München".
 *
 * The database already carries `unaccent` for the same reason; this is the
 * client-side equivalent so both sides agree on what "the same name" means.
 */
export function normaliseQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MATCH_POINTS = { exact: 100, prefix: 70, word_prefix: 50 } as const;

function classify(haystack: string, needle: string): SearchResult["matchKind"] | null {
  if (haystack === needle) return "exact";
  if (haystack.startsWith(needle)) return "prefix";
  // A word-boundary prefix, so "utd" finds "Manchester Utd" and "madrid" finds
  // "Atlético Madrid".
  //
  // There is deliberately no substring tier below this. A mid-word match makes
  // "land" find Sunderland, "art" find Sparta and Charlton, and every one of
  // those is noise a reader has to read past to reach what they typed. The
  // earlier draft had one, and the comment above it claimed the opposite of
  // what the code did.
  if (haystack.split(" ").some((word) => word.startsWith(needle))) return "word_prefix";
  return null;
}

/**
 * Fixtures decay with distance from now, in both directions.
 *
 * A match tonight is what someone searching a team name almost always wants;
 * one from last March is not, and one in three months is not either.
 */
function fixtureRecency(kickoffAt: string | null | undefined, now: Date): number {
  if (!kickoffAt) return 0;
  const hours = Math.abs(new Date(kickoffAt).getTime() - now.getTime()) / 3_600_000;
  if (!Number.isFinite(hours)) return 0;
  if (hours <= 24) return 25;
  if (hours <= 24 * 7) return 12;
  if (hours <= 24 * 30) return 4;
  return 0;
}

export function searchEntities(
  query: string,
  entities: SearchableEntity[],
  options: SearchOptions = {}
): SearchResult[] {
  const needle = normaliseQuery(query);
  // One character matches most of the catalogue and ranks it by prominence,
  // which is a popularity list rather than a search result.
  if (needle.length < 2) return [];

  const now = options.now ?? new Date();
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const results: SearchResult[] = [];

  for (const entity of entities) {
    if (kinds && !kinds.has(entity.kind)) continue;

    const candidates = [entity.name, ...(entity.aliases ?? [])];
    let best: { kind: SearchResult["matchKind"]; on: string } | null = null;

    for (const candidate of candidates) {
      const matchKind = classify(normaliseQuery(candidate), needle);
      if (!matchKind) continue;
      if (!best || MATCH_POINTS[matchKind] > MATCH_POINTS[best.kind]) {
        best = { kind: matchKind, on: candidate };
      }
    }
    if (!best) continue;

    const score =
      MATCH_POINTS[best.kind] +
      (entity.prominence ?? 0) +
      (entity.kind === "fixture" ? fixtureRecency(entity.kickoffAt, now) : 0) +
      // A name matched directly beats the same quality of match on an alias:
      // an alias is evidence the entity is known by that string, not that the
      // string is its name.
      (best.on === entity.name ? 5 : 0);

    results.push({ entity, score, matchedOn: best.on, matchKind: best.kind });
  }

  return results
    .sort((a, b) => b.score - a.score || a.entity.name.localeCompare(b.entity.name))
    .slice(0, Math.max(1, options.limit ?? 20));
}

/**
 * Group results by kind while preserving rank inside each group.
 *
 * A flat list sorted purely by score buries the one competition among nine
 * teams. Grouping lets a reader see that all four kinds matched without the
 * ranking having to fight the layout.
 */
export function groupResults(results: SearchResult[]): Array<{ kind: SearchEntityKind; results: SearchResult[] }> {
  const order: SearchEntityKind[] = ["team", "player", "competition", "fixture"];
  return order
    .map((kind) => ({ kind, results: results.filter((result) => result.entity.kind === kind) }))
    .filter((group) => group.results.length > 0);
}

/**
 * Whether the top two results are too close to call.
 *
 * Two entities of the same kind with the same score are genuinely ambiguous —
 * two clubs called Arsenal, say — and picking one silently is how a reader
 * ends up on the wrong page believing it is the right one.
 */
export function isAmbiguous(results: SearchResult[]): boolean {
  if (results.length < 2) return false;
  const [first, second] = results;
  return first!.score === second!.score && first!.entity.kind === second!.entity.kind;
}
