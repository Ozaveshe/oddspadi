import { formatSelectionKey } from "@/lib/markets/canonicalKey";
import { canonicalSelection, type CanonicalSport } from "@/lib/markets/canonicalMarkets";

/**
 * Resolving the market strings already stored in the database.
 *
 * `op_publications`, `op_market_decisions` and `op_odds_snapshots` hold 335k+
 * rows of legacy market and selection text — `over_under_25`/`over_25`,
 * `match_winner`/`home`, `spread`/`home_cover`. Rewriting those columns is the
 * thing the design forbids: history keeps the text it was written with, and
 * canonical identity is resolved on read.
 *
 * This is the read-side resolver for that text. It is deliberately narrow —
 * exact known strings only, no fuzzy matching, no nearest-line rounding. An
 * unrecognised string returns null and raises `unknown_market`, because a
 * guessed mapping settles a real claim against a market nobody quoted.
 */

/**
 * Decode a line from the legacy naming convention.
 *
 * `over_under_25` is the 2.5 line and `over_under_505` is 50.5: the trailing
 * digits carry an implied decimal point before the last one. `over_under_3`
 * with a single digit is the whole line 3.
 */
export function decodeLegacyLine(digits: string): number | null {
  if (!/^\d+$/.test(digits)) return null;
  const value = digits.length >= 2 ? Number(`${digits.slice(0, -1)}.${digits.slice(-1)}`) : Number(digits);
  return Number.isFinite(value) ? value : null;
}

type LegacyClaim = {
  sport: CanonicalSport;
  market: string;
  selection: string;
  /** `market_line` from the publication, where the row carries one. */
  marketLine?: number | null;
};

const TOTALS_MARKETS = new Set(["total_goals", "totals", "over_under", "total_points", "total_games"]);

/**
 * Map a stored claim onto a canonical selection key.
 *
 * Returns null rather than a best guess. The caller turns that into an
 * `unknown_market` exception, which is a claim we cannot grade — not a void,
 * which would be a claim we say never resolved.
 */
export function legacySelectionKey(claim: LegacyClaim): string | null {
  const market = claim.market.trim().toLowerCase();
  const selection = claim.selection.trim().toLowerCase();

  if (market === "match_winner" || market === "moneyline" || market === "1x2") {
    if (claim.sport === "football") {
      return has(`football.1x2.regulation.${selection}`);
    }
    if (claim.sport === "basketball") {
      // Legacy basketball moneyline is the full-game market: no stored decision
      // ever distinguished the regulation variant, and assuming it did would
      // silently re-grade every historical basketball claim.
      return has(`basketball.moneyline.full_game_incl_ot.${selection}`);
    }
    if (claim.sport === "tennis") {
      const player = selection === "home" ? "player_a" : selection === "away" ? "player_b" : selection;
      return has(`tennis.match_winner.full_match.${player}`);
    }
    return null;
  }

  if (market === "both_teams_to_score" || market === "btts") {
    return has(`football.btts.regulation.${selection}`);
  }

  if (market === "double_chance") {
    // The stored vocabulary is `home_or_draw`, not `1x`. Measured against
    // production: 1,692 rows, every one of which resolved to unknown_market
    // until this mapping existed. The canonical spelling was chosen from the
    // brief's examples; the database had already chosen a different one.
    const spellings: Record<string, string> = {
      home_or_draw: "1x",
      draw_or_home: "1x",
      home_or_away: "12",
      away_or_home: "12",
      draw_or_away: "x2",
      away_or_draw: "x2",
      "1x": "1x",
      "12": "12",
      x2: "x2"
    };
    const canonical = spellings[selection];
    return canonical ? has(`football.double_chance.regulation.${canonical}`) : null;
  }

  if (market === "draw_no_bet") {
    return has(`football.draw_no_bet.regulation.${selection}`);
  }

  const totalsMatch = /^over_under_(\d+)$/.exec(market);
  if (totalsMatch || TOTALS_MARKETS.has(market)) {
    const side = /^(over|under)/.exec(selection)?.[1];
    if (!side) return null;
    const line =
      claim.marketLine ??
      decodeLegacyLine(totalsMatch?.[1] ?? "") ??
      decodeLegacyLine(/^(?:over|under)_(\d+)$/.exec(selection)?.[1] ?? "");
    if (line === null) return null;

    const marketKey =
      claim.sport === "football"
        ? "football.total_goals.regulation"
        : claim.sport === "basketball"
          ? "basketball.total_points.full_game_incl_ot"
          : "tennis.total_games.full_match";
    return has(formatSelectionKey(marketKey, side, line));
  }

  if (market === "spread") {
    // `home_cover` / `away_cover` with the line on the row. A spread claim with
    // no stored line is exactly the case that must not be guessed — it is the
    // reason these decisions were ungradeable, and inventing a line now would
    // convert an honest gap into a wrong verdict.
    if (claim.marketLine === null || claim.marketLine === undefined) return null;
    const side = selection.startsWith("home") ? "home" : selection.startsWith("away") ? "away" : null;
    if (!side) return null;
    return has(formatSelectionKey("basketball.spread.full_game_incl_ot", side, claim.marketLine));
  }

  if (market === "asian_handicap") {
    if (claim.marketLine === null || claim.marketLine === undefined) return null;
    const side = selection.startsWith("home") ? "home" : selection.startsWith("away") ? "away" : null;
    if (!side) return null;
    return has(formatSelectionKey("football.asian_handicap.regulation", side, claim.marketLine));
  }

  if (market === "set_handicap") {
    if (claim.marketLine === null || claim.marketLine === undefined) return null;
    const side = selection.startsWith("home") ? "player_a" : selection.startsWith("away") ? "player_b" : null;
    if (!side) return null;
    return has(formatSelectionKey("tennis.set_handicap.full_match", side, claim.marketLine));
  }

  return null;
}

/** Only return a key the registry actually knows, so a typo here cannot ship. */
function has(key: string): string | null {
  return canonicalSelection(key) ? key : null;
}
