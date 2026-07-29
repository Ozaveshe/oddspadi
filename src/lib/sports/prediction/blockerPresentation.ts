/**
 * Turns engine publication blockers into something a reader can act on.
 *
 * The match page listed raw internal strings under "Key risks" — a tennis
 * fixture showed "engine action is avoid", "calibration requires abstention"
 * and "engine actionability is blocked". That is internal vocabulary, and all
 * three say one thing: the engine declined to make a call. Printing them
 * verbatim reads as three separate problems and explains none of them.
 *
 * Each blocker maps to a plain sentence plus a `topic`. Blockers sharing a
 * topic are collapsed, so the reader sees each distinct reason once.
 */
export type PresentedBlocker = {
  topic: string;
  text: string;
};

type Rule = { match: RegExp; topic: string; text: string };

const RULES: Rule[] = [
  // All three of these mean the same thing to a reader.
  { match: /engine action is (avoid|monitor)/i, topic: "abstained", text: "The model declined to make a call on this match." },
  { match: /calibration requires abstention/i, topic: "abstained", text: "The model declined to make a call on this match." },
  { match: /engine actionability is (blocked|watch-only)/i, topic: "abstained", text: "The model declined to make a call on this match." },
  { match: /an abstention rule is active/i, topic: "abstained", text: "The model declined to make a call on this match." },

  { match: /needs at least (\d+) independent bookmakers/i, topic: "depth", text: "Too few bookmakers are pricing this market to compare prices reliably." },
  { match: /cross-book probability disagreement exceeds/i, topic: "disagreement", text: "Bookmakers disagree too much on this match for a confident read." },
  { match: /decimal odds are outside the publication range/i, topic: "odds-range", text: "The price sits outside the range OddsPadi publishes." },
  { match: /odds are stale|price is stale|odds age/i, topic: "stale", text: "The latest price is too old to publish against." },

  { match: /empirical 95% value floor is unavailable/i, topic: "unproven", text: "The model has not yet been validated on enough settled results to publish a value claim." },
  { match: /uncalibrated publication needs at least/i, topic: "unproven", text: "Without a validated track record, this match needs a larger edge than it shows." },
  { match: /no settled outcomes exist for this sport/i, topic: "unproven", text: "No finished results have been graded for this sport yet, so the model's accuracy cannot be checked." },
  { match: /plausibility ceiling/i, topic: "implausible", text: "The model's edge is implausibly large here, which usually means the model is wrong rather than the market." },

  { match: /data quality is below/i, topic: "data", text: "There is not enough reliable data on this fixture." },
  { match: /required production evidence is missing|stale, mock, or computed-only/i, topic: "data", text: "Some required match evidence is missing or out of date." },
  { match: /confidence is below/i, topic: "confidence", text: "The model is not confident enough in this read to publish it." },
  { match: /kickoff is too close/i, topic: "timing", text: "Kick-off is too close to publish a new pick." },
  { match: /robustness stress tests classify/i, topic: "fragile", text: "The read does not hold up when the numbers are stress-tested." },
  { match: /uncertainty decomposition classifies/i, topic: "fragile", text: "The uncertainty around this read is too high to publish." },
  { match: /holdout yield is not positive/i, topic: "unproven", text: "The model has not shown a positive return on held-out results." }
];

/**
 * Map raw blockers to reader-facing reasons, one per distinct topic, in the
 * order the engine reported them. Unrecognised blockers are passed through so a
 * new one is never silently dropped — better an unpolished sentence than a
 * missing reason.
 */
export function presentBlockers(blockers: readonly string[], limit = 3): PresentedBlocker[] {
  const seen = new Set<string>();
  const presented: PresentedBlocker[] = [];

  for (const blocker of blockers) {
    const trimmed = blocker?.trim();
    if (!trimmed) continue;
    const rule = RULES.find((candidate) => candidate.match.test(trimmed));
    const topic = rule?.topic ?? `raw:${trimmed.toLowerCase()}`;
    if (seen.has(topic)) continue;
    seen.add(topic);
    presented.push({ topic, text: rule?.text ?? trimmed });
    if (presented.length >= limit) break;
  }

  return presented;
}

export type EngineViewRow = {
  id: string;
  label: string;
  odds: number;
  modelProbability: number | null;
  impliedProbability: number | null;
};

/**
 * Model-vs-market read for a fixture that produced no publishable decision.
 *
 * A suspended or abstained fixture has no published pick, lean or watchlist
 * candidate, so the match page rendered only a status line — despite holding
 * both the model's probabilities and live prices, and despite promising the
 * reader "everything the engine sees". These rows are that evidence; they are
 * explicitly not a recommendation.
 */
export function buildEngineViewRows({
  selections,
  probabilities
}: {
  selections: ReadonlyArray<{ id: string; label: string; decimalOdds: number }>;
  probabilities: Record<string, number>;
}): EngineViewRow[] {
  const rows = selections.map((selection) => {
    const modelProbability = probabilities[selection.id];
    return {
      id: selection.id,
      label: selection.label,
      odds: selection.decimalOdds,
      modelProbability: typeof modelProbability === "number" && Number.isFinite(modelProbability) ? modelProbability : null,
      // Odds of 1.0 or less carry no information; treat them as absent rather
      // than dividing into a nonsense implied probability.
      impliedProbability: selection.decimalOdds > 1 ? 1 / selection.decimalOdds : null
    };
  });
  // Showing a table of dashes is worse than showing nothing.
  return rows.some((row) => row.modelProbability !== null || row.impliedProbability !== null) ? rows : [];
}
