/**
 * The canonical market key grammar.
 *
 * Bookmaker display text has been the market identity in this repository since
 * the beginning, encoded as a flat string union in `src/lib/sports/types.ts`
 * with the line baked into the name — `over_under_25`, `over_under_505`,
 * `over_under_545`. Seven union members for one market, and each new line was a
 * new member. Worse, `spread`, `set_handicap` and `total_games` carried no line
 * at all, so a basketball spread decision never recorded the number it was
 * taken against. That is why those decisions could only ever reach
 * `needs_review`: not a missing rule, a missing dimension.
 *
 * Identity is two levels. A market key names what is bet on; a selection key
 * names one outcome within it:
 *
 *   market key:     <sport>.<family>.<period>
 *   selection key:  <market key>.<selection>[.<line>]
 *
 *   football.1x2.regulation.home
 *   football.asian_handicap.regulation.home.-0_25
 *   basketball.moneyline.full_game_incl_ot.home
 *   tennis.match_winner.full_match.player_a
 *
 * Overtime lives in the period segment (`full_game_incl_ot` versus
 * `regulation`) rather than as its own segment. A segment that is mandatory for
 * basketball and meaningless for tennis cannot be parsed without first knowing
 * the sport; folding it into the period keeps the grammar context-free at no
 * cost to the information carried.
 */

/** Decimal point becomes `_` so a key stays a single dotted path. */
export function encodeLine(line: number): string {
  if (!Number.isFinite(line)) throw new Error(`Line must be finite, received ${line}.`);
  // `-0` and `0` are the same line; normalising here keeps `home.0` unique.
  const normalized = line === 0 ? 0 : line;
  return String(normalized).replace(".", "_");
}

export function decodeLine(encoded: string): number | null {
  if (!/^-?\d+(_\d+)?$/.test(encoded)) return null;
  const value = Number(encoded.replace("_", "."));
  return Number.isFinite(value) ? value : null;
}

export type ParsedSelectionKey = {
  marketKey: string;
  sport: string;
  family: string;
  period: string;
  selection: string;
  line: number | null;
};

/**
 * Parse a selection key without consulting the registry.
 *
 * Deliberately structural: this answers "is this well-formed and what are its
 * parts", not "does this market exist". Callers that need existence ask the
 * registry, and keeping the two separate means a malformed key and an unknown
 * key produce different errors — which matters when the first is a bug and the
 * second is an unmapped provider market.
 */
export function parseSelectionKey(key: string): ParsedSelectionKey | null {
  const parts = key.split(".");
  if (parts.length < 4 || parts.length > 5) return null;
  const [sport, family, period, selection, encodedLine] = parts;
  if (!sport || !family || !period || !selection) return null;
  if (parts.some((part) => part.length === 0)) return null;

  let line: number | null = null;
  if (encodedLine !== undefined) {
    line = decodeLine(encodedLine);
    // A fifth segment that is not a line is not a selection key with a spare
    // part; it is a different shape entirely, and guessing which is malformed
    // is how a `-0.25` handicap silently becomes a `0` one.
    if (line === null) return null;
  }

  return { marketKey: `${sport}.${family}.${period}`, sport, family, period, selection, line };
}

export function formatSelectionKey(marketKey: string, selection: string, line?: number | null): string {
  const base = `${marketKey}.${selection}`;
  return line === undefined || line === null ? base : `${base}.${encodeLine(line)}`;
}
