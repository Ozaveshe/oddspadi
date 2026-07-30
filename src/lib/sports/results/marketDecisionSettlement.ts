/**
 * Grades stored market decisions against a finished fixture's score.
 *
 * Settlement previously ran only over `op_public_picks`, which has never had a
 * single row — so across 335,636 market decisions the engine had never once
 * recorded whether it was right. That is why the calibration corpus could not
 * grow, why no candidate could earn promotion, and ultimately why the empirical
 * value floor was permanently unavailable:
 *
 *   publication blocked -> no public picks -> nothing settled ->
 *   no settled outcomes -> no promotion -> publication blocked
 *
 * Grading decisions directly breaks that loop. Every decision the engine makes
 * becomes training evidence whether or not it was published, so the model can
 * learn from withheld calls too — with no money at risk.
 *
 * Only selections that a final score fully determines are graded here. Anything
 * needing a line, a handicap or a period breakdown returns `needs_review`
 * rather than a guess: a wrong label is worse than an absent one, because it
 * silently corrupts the calibration curve.
 */
export type MarketDecisionResult = "won" | "lost" | "push" | "void" | "needs_review";

export type SettleableFixtureResult = {
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "suspended";
  homeScore: number | null;
  awayScore: number | null;
};

export type MarketDecisionGrade = {
  result: MarketDecisionResult;
  reason: string;
};

function decided(result: MarketDecisionResult, reason: string): MarketDecisionGrade {
  return { result, reason };
}

function totalGoalsSelection(selection: string): { side: "over" | "under"; line: number } | null {
  const match = /^(over|under)_(\d+)$/.exec(selection);
  if (!match) return null;
  // `over_25` encodes the 2.5 line; `over_15` encodes 1.5.
  const digits = match[2]!;
  const line = digits.length >= 2 ? Number(`${digits.slice(0, -1)}.${digits.slice(-1)}`) : Number(digits);
  return Number.isFinite(line) ? { side: match[1] as "over" | "under", line } : null;
}

export function gradeMarketDecision({
  market,
  selection,
  fixture
}: {
  market: string;
  selection: string;
  fixture: SettleableFixtureResult;
}): MarketDecisionGrade {
  if (fixture.status === "cancelled" || fixture.status === "postponed") {
    return decided("void", `Fixture was ${fixture.status}, so the market never resolved.`);
  }
  if (fixture.status !== "finished") {
    return decided("needs_review", "Fixture has not finished, so no outcome exists yet.");
  }
  const { homeScore: home, awayScore: away } = fixture;
  if (home === null || away === null || !Number.isFinite(home) || !Number.isFinite(away)) {
    return decided("needs_review", "Fixture finished without a usable final score.");
  }

  if (market === "match_winner" || market === "moneyline") {
    const winner = home > away ? "home" : away > home ? "away" : "draw";
    if (selection !== "home" && selection !== "away" && selection !== "draw") {
      return decided("needs_review", `Unrecognised match-winner selection "${selection}".`);
    }
    // A draw selection is only offered where a draw is possible; if a sport
    // cannot draw, the score simply never produces one.
    return decided(selection === winner ? "won" : "lost", `Final score ${home}-${away} resolved to ${winner}.`);
  }

  if (market === "both_teams_to_score") {
    if (selection !== "yes" && selection !== "no") {
      return decided("needs_review", `Unrecognised both-teams-to-score selection "${selection}".`);
    }
    const bothScored = home > 0 && away > 0;
    const won = selection === "yes" ? bothScored : !bothScored;
    return decided(won ? "won" : "lost", `Final score ${home}-${away}; both teams scored: ${bothScored}.`);
  }

  // `over_under_25` and friends carry the line in both the market name and the
  // selection (`over_25` = the 2.5 line). Only the bare aliases were accepted,
  // which left every `over_under_25` decision permanently at needs_review — 422
  // settled football fixtures' worth — despite the selection being exactly as
  // unambiguous as on the accepted names. Basketball's `total_points` grades the
  // same way from the final total.
  if (market === "total_goals" || market === "totals" || market === "over_under" || market === "total_points" || /^over_under_\d+$/.test(market)) {
    const total = totalGoalsSelection(selection);
    if (!total) return decided("needs_review", `Unrecognised totals selection "${selection}".`);
    const scored = home + away;
    if (scored === total.line) return decided("push", `Total ${scored} landed exactly on the ${total.line} line.`);
    const wentOver = scored > total.line;
    const won = total.side === "over" ? wentOver : !wentOver;
    return decided(won ? "won" : "lost", `Total ${scored} against the ${total.line} line.`);
  }

  // Handicaps and spreads need the line the price was struck at, which the
  // decision row does not carry. Guessing would corrupt the calibration curve.
  return decided("needs_review", `Market "${market}" cannot be settled from a final score alone.`);
}
