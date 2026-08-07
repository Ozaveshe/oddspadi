import { canonicalSelection, type CanonicalMarket } from "@/lib/markets/canonicalMarkets";
import {
  fullGameScore,
  gameScore,
  regulationScore,
  setScore,
  type CanonicalResult
} from "@/lib/results/canonicalResult";

/**
 * The settlement engine.
 *
 * Pure: no I/O, no clock, no database. The same result revision, claim and rule
 * version always produce the same verdict, which is what makes replay free and
 * lets the fixture suite run without a database.
 *
 * Idempotency is not this function's job — it lives where it already works, in
 * `op_settle_publication()` and the one-current partial index. This function
 * only has to be deterministic; the storage layer makes repeating it harmless.
 */

export type SettlementOutcome =
  | "won"
  | "half_won"
  | "push"
  | "half_lost"
  | "lost"
  | "void"
  | "needs_review";

export type Settlement = {
  outcome: SettlementOutcome;
  /**
   * Profit per unit staked, at decimal odds `o`:
   *   won       →  o − 1
   *   half_won  → (o − 1) / 2
   *   push/void →  0
   *   half_lost → −0.5
   *   lost      → −1
   *
   * Carried rather than derived by each consumer, because a half win is the
   * case every ad-hoc ROI calculation in this repository would get wrong.
   */
  returnMultiple: (decimalOdds: number) => number;
  marketKey: string | null;
  ruleVersion: string | null;
  basis: string | null;
  reason: string;
};

function profit(outcome: SettlementOutcome): (decimalOdds: number) => number {
  switch (outcome) {
    case "won":
      return (odds) => odds - 1;
    case "half_won":
      return (odds) => (odds - 1) / 2;
    case "half_lost":
      return () => -0.5;
    case "lost":
      return () => -1;
    case "push":
    case "void":
    case "needs_review":
      return () => 0;
  }
}

function decide(
  outcome: SettlementOutcome,
  reason: string,
  market: CanonicalMarket | null = null
): Settlement {
  return {
    outcome,
    returnMultiple: profit(outcome),
    marketKey: market?.key ?? null,
    ruleVersion: market?.settlementRuleVersion ?? null,
    basis: market?.basis ?? null,
    reason
  };
}

/**
 * Terminal statuses that void every market, before any market-specific rule
 * gets a chance to read a score that is not there.
 *
 * `abandoned` is here and `retired` is not: an abandoned match stopped without
 * a result, while a retirement produces an awarded winner that some markets can
 * settle on. Collapsing the two is how a played match becomes a void.
 */
const VOIDING_STATUSES = new Set(["postponed", "cancelled", "abandoned"]);

export function settle(result: CanonicalResult, claim: { selectionKey: string }): Settlement {
  const resolved = canonicalSelection(claim.selectionKey);
  if (!resolved) {
    // An unmapped market is not a void and not a loss. It is a claim we cannot
    // grade, and saying so is the only honest option available.
    return decide("needs_review", `Selection "${claim.selectionKey}" does not resolve to a canonical market.`);
  }
  const { market, selection, line } = resolved;

  if (result.verificationState !== "verified") {
    return decide(
      "needs_review",
      `Result is ${result.verificationState}, not verified. Settlement never reads a provisional score.`,
      market
    );
  }

  if (VOIDING_STATUSES.has(result.resultStatus)) {
    return decide("void", `Fixture was ${result.resultStatus}, so the market never resolved.`, market);
  }

  if (result.resultStatus === "walkover") {
    return decide("void", "Walkover: no play took place, so no market resolved.", market);
  }

  if (result.resultStatus === "retired") {
    if (market.retirementRule === "void") {
      return decide(
        "void",
        `${market.family} voids on retirement: the match has a winner but the count never reached its final value.`,
        market
      );
    }
    if (market.retirementRule === "not_applicable") {
      return decide("needs_review", `Retirement is not a defined outcome for ${market.key}.`, market);
    }
    // settle_on_award falls through to the market rule, which reads `winner`.
  }

  switch (market.family) {
    case "1x2":
      return settleThreeWay(market, selection.id, regulationScore(result), "normal time");
    case "moneyline":
      return market.overtimeRule === "included"
        ? settleTwoWayNoDraw(market, selection.id, fullGameScore(result))
        : settleThreeWay(market, selection.id, regulationScore(result), "regulation");
    case "double_chance":
      return settleDoubleChance(market, selection.id, regulationScore(result));
    case "draw_no_bet":
      return settleDrawNoBet(market, selection.id, regulationScore(result));
    case "btts":
      return settleBtts(market, selection.id, regulationScore(result));
    case "asian_handicap":
      return settleHandicap(market, selection.id, line, regulationScore(result));
    case "spread":
      return settleHandicap(market, selection.id, line, fullGameScore(result));
    case "total_goals":
      return settleTotal(market, selection.id, line, regulationScore(result));
    case "total_points":
      return settleTotal(market, selection.id, line, fullGameScore(result));
    case "total_games":
      return settleTotal(market, selection.id, line, gameScore(result));
    case "set_handicap":
      return settleHandicap(market, selection.id, line, setScore(result));
    case "match_winner":
      return settleMatchWinner(market, selection.id, result);
    case "to_qualify":
      return settleQualification(market, selection.id, result);
    default:
      return decide("needs_review", `No settlement rule implemented for market family "${market.family}".`, market);
  }
}

type Score = { home: number; away: number } | null;

function missing(market: CanonicalMarket, what: string): Settlement {
  return decide("needs_review", `Result carries no ${what}, which ${market.key} settles on.`, market);
}

function settleThreeWay(market: CanonicalMarket, selection: string, score: Score, label: string): Settlement {
  if (!score) return missing(market, `${label} score`);
  const winner = score.home > score.away ? "home" : score.away > score.home ? "away" : "draw";
  return decide(
    selection === winner ? "won" : "lost",
    `${label} score ${score.home}-${score.away} resolved to ${winner}.`,
    market
  );
}

function settleTwoWayNoDraw(market: CanonicalMarket, selection: string, score: Score): Settlement {
  if (!score) return missing(market, "full-game score");
  if (score.home === score.away) {
    // A two-way market with no draw selection cannot express a tie. Rather than
    // pick a side, say so — this is a data problem, not an outcome.
    return decide("needs_review", `Full-game score ${score.home}-${score.away} is tied on a market with no draw selection.`, market);
  }
  const winner = score.home > score.away ? "home" : "away";
  return decide(selection === winner ? "won" : "lost", `Final score ${score.home}-${score.away} including overtime.`, market);
}

function settleDoubleChance(market: CanonicalMarket, selection: string, score: Score): Settlement {
  if (!score) return missing(market, "normal-time score");
  const winner = score.home > score.away ? "home" : score.away > score.home ? "away" : "draw";
  const covers: Record<string, string[]> = { "1x": ["home", "draw"], "12": ["home", "away"], x2: ["draw", "away"] };
  const covered = covers[selection];
  if (!covered) return decide("needs_review", `Unrecognised double chance selection "${selection}".`, market);
  return decide(
    covered.includes(winner) ? "won" : "lost",
    `Normal-time score ${score.home}-${score.away} resolved to ${winner}; selection covers ${covered.join(" and ")}.`,
    market
  );
}

function settleDrawNoBet(market: CanonicalMarket, selection: string, score: Score): Settlement {
  if (!score) return missing(market, "normal-time score");
  if (score.home === score.away) {
    return decide("push", `Normal-time score ${score.home}-${score.away} was a draw; stake returned.`, market);
  }
  const winner = score.home > score.away ? "home" : "away";
  return decide(selection === winner ? "won" : "lost", `Normal-time score ${score.home}-${score.away}.`, market);
}

function settleBtts(market: CanonicalMarket, selection: string, score: Score): Settlement {
  if (!score) return missing(market, "normal-time score");
  const both = score.home > 0 && score.away > 0;
  const won = selection === "yes" ? both : !both;
  return decide(won ? "won" : "lost", `Normal-time score ${score.home}-${score.away}; both scored: ${both}.`, market);
}

/**
 * Asian handicap and point spread.
 *
 * The line is added to the backed side's score. A margin landing exactly on a
 * whole line pushes; a quarter line is settled as two half-stakes on the
 * neighbouring half lines, which is where `half_won` and `half_lost` come from.
 * Modelling a quarter line as its nearest half would misprice every one of them
 * by half a stake, in a market this book already publishes.
 */
function settleHandicap(market: CanonicalMarket, selection: string, line: number | null, score: Score): Settlement {
  if (line === null) return decide("needs_review", `${market.key} requires a line and the claim carries none.`, market);
  if (!score) return missing(market, "score");
  const backed = selection === "home" || selection === "player_a" ? score.home : score.away;
  const opponent = selection === "home" || selection === "player_a" ? score.away : score.home;
  const margin = backed + line - opponent;

  const quarter = Math.abs(line * 2) % 1 !== 0;
  if (!quarter) {
    if (margin > 0) return decide("won", `Margin ${margin} against line ${line}.`, market);
    if (margin < 0) return decide("lost", `Margin ${margin} against line ${line}.`, market);
    return decide("push", `Margin landed exactly on line ${line}; stake returned.`, market);
  }

  // Split into the two half lines the quarter sits between and settle each with
  // half the stake.
  const lower = line - 0.25;
  const upper = line + 0.25;
  const half = (candidate: number): "won" | "lost" | "push" => {
    const m = backed + candidate - opponent;
    return m > 0 ? "won" : m < 0 ? "lost" : "push";
  };
  const a = half(lower);
  const b = half(upper);
  const detail = `Quarter line ${line} split into ${lower} (${a}) and ${upper} (${b}).`;
  if (a === "won" && b === "won") return decide("won", detail, market);
  if (a === "lost" && b === "lost") return decide("lost", detail, market);
  if (a === "won" || b === "won") return decide("half_won", detail, market);
  return decide("half_lost", detail, market);
}

function settleTotal(market: CanonicalMarket, selection: string, line: number | null, score: Score): Settlement {
  if (line === null) return decide("needs_review", `${market.key} requires a line and the claim carries none.`, market);
  if (!score) return missing(market, "score");
  const total = score.home + score.away;
  if (total === line) return decide("push", `Total ${total} landed exactly on line ${line}; stake returned.`, market);
  const over = total > line;
  const won = selection === "over" ? over : !over;
  return decide(won ? "won" : "lost", `Total ${total} against line ${line}.`, market);
}

function settleMatchWinner(market: CanonicalMarket, selection: string, result: CanonicalResult): Settlement {
  if (result.winner === "none" || result.winner === "draw") {
    return decide("needs_review", `Match winner has no awarded winner (winner=${result.winner}).`, market);
  }
  // `player_a` is the home-side participant; tennis fixtures carry the two
  // players in the same orientation as team sports.
  const backed = selection === "player_a" ? "home" : "away";
  return decide(
    backed === result.winner ? "won" : "lost",
    `Match awarded to ${result.winner}${result.winnerBasis ? ` by ${result.winnerBasis}` : ""}.`,
    market
  );
}

function settleQualification(market: CanonicalMarket, selection: string, result: CanonicalResult): Settlement {
  if (result.winner === "none" || result.winner === "draw") {
    return decide("needs_review", "No side advanced according to the result.", market);
  }
  return decide(
    selection === result.winner ? "won" : "lost",
    `${result.winner} advanced by ${result.winnerBasis ?? "unknown basis"}.`,
    market
  );
}
