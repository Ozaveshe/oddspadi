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
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "abandoned" | "suspended";
  homeScore: number | null;
  awayScore: number | null;
  /**
   * Our reading of the evidence, when it has been reconciled.
   *
   * `status` is the provider's last word and `lifecycleState` is ours, and the
   * only reason settlement needs both is that they can disagree. `unresolved`
   * is the disagreement that matters here: it means the match should have
   * finished and no result reached us, which is not a fact about the match.
   */
  lifecycleState?: string | null;
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
  // A quarantined fixture is an unknown, and an unknown is not a void.
  //
  // This branch used to be a comment admitting the opposite: `abandoned`
  // reached here two ways, the provider reporting it and the stale sweep
  // inventing it, and both were graded void so the queue would drain. Draining
  // the queue is not worth the price it charged — 50 of 134 settled
  // publications were void, and ~50 of those were matches that were played.
  //
  // The sweep now writes `lifecycle_state = 'unresolved'` and leaves `status`
  // alone, so the two cases are distinguishable at last. An unsettled claim is
  // a claim we have not graded yet; a void claim is one we say never resolved.
  // Only the provider can put us in the second case.
  if (fixture.lifecycleState === "unresolved") {
    return decided(
      "needs_review",
      "The fixture is past its plausible window with no provider result. We do not know the outcome, which is not the same as there not having been one."
    );
  }
  if (fixture.status === "cancelled" || fixture.status === "postponed" || fixture.status === "abandoned") {
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

  // Team totals read one side of the score the way match totals read the sum.
  const teamTotal = /^(home|away)_team_over_under_\d+$/.exec(market);
  if (teamTotal) {
    const total = totalGoalsSelection(selection);
    if (!total) return decided("needs_review", `Unrecognised team-totals selection "${selection}".`);
    const scored = teamTotal[1] === "home" ? home : away;
    if (scored === total.line) return decided("push", `${teamTotal[1]} total ${scored} landed exactly on the ${total.line} line.`);
    const wentOver = scored > total.line;
    const won = total.side === "over" ? wentOver : !wentOver;
    return decided(won ? "won" : "lost", `${teamTotal[1]} scored ${scored} against the ${total.line} line.`);
  }

  if (market === "clean_sheet_home" || market === "clean_sheet_away") {
    if (selection !== "yes" && selection !== "no") {
      return decided("needs_review", `Unrecognised clean-sheet selection "${selection}".`);
    }
    const conceded = market === "clean_sheet_home" ? away : home;
    const kept = conceded === 0;
    return decided((selection === "yes") === kept ? "won" : "lost", `Final score ${home}-${away}; clean sheet kept: ${kept}.`);
  }

  if (market === "correct_score") {
    const exact = /^(\d+)_(\d+)$/.exec(selection);
    // `other` aggregates every scoreline the model did not list individually;
    // the decision row does not carry that list, so it cannot be graded.
    if (!exact) return decided("needs_review", `Correct-score selection "${selection}" cannot be settled without the listed scorelines.`);
    const won = Number(exact[1]) === home && Number(exact[2]) === away;
    return decided(won ? "won" : "lost", `Final score ${home}-${away} against selection ${exact[1]}-${exact[2]}.`);
  }

  // Handicaps and spreads need the line the price was struck at, which the
  // decision row does not carry. Guessing would corrupt the calibration curve.
  return decided("needs_review", `Market "${market}" cannot be settled from a final score alone.`);
}
