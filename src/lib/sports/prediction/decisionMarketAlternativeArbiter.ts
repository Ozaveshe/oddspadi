import type { DecisionOddsBoard, DecisionOddsBoardSelection } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionProbabilityFusionAudit, DecisionProbabilityFusionCandidate } from "@/lib/sports/prediction/decisionProbabilityFusionAudit";
import type { Sport } from "@/lib/sports/types";

export type DecisionMarketAlternativeArbiterStatus = "shadow-ready" | "needs-price" | "avoid-only" | "blocked";
export type DecisionMarketAlternativeRecommendation = "prefer-primary" | "prefer-safer-alternative" | "needs-price" | "avoid-market";
export type DecisionMarketAlternativeStatus = "priced-value" | "priced-watch" | "watch-no-price" | "avoid" | "needs-provider-price";

export type DecisionMarketAlternativeOption = {
  id: string;
  source: "priced-market" | "derived-football-safety" | "strategy-note";
  marketId: string;
  marketName: string;
  selectionId: string;
  selection: string;
  status: DecisionMarketAlternativeStatus;
  probability: number | null;
  odds: number | null;
  noVigProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  risk: string;
  rationale: string;
  verifyUrl: string | null;
};

export type DecisionMarketAlternativeCandidate = {
  matchId: string;
  match: string;
  sport: Sport;
  league: string;
  primary: {
    selection: string | null;
    verdict: DecisionProbabilityFusionCandidate["verdict"];
    fusedProbability: number | null;
    fusedEdge: number | null;
    fusedExpectedValue: number | null;
    odds: number | null;
    blockers: string[];
  };
  recommendation: DecisionMarketAlternativeRecommendation;
  recommendedAlternative: DecisionMarketAlternativeOption | null;
  alternatives: DecisionMarketAlternativeOption[];
  risks: string[];
  rationale: string;
};

export type DecisionMarketAlternativeArbiter = {
  mode: "market-alternative-arbiter";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMarketAlternativeArbiterStatus;
  arbiterHash: string;
  summary: string;
  totals: {
    candidates: number;
    alternatives: number;
    pricedAlternatives: number;
    derivedAlternatives: number;
    preferPrimary: number;
    preferSaferAlternative: number;
    needsPrice: number;
    avoidMarket: number;
  };
  topCandidate: DecisionMarketAlternativeCandidate | null;
  candidates: DecisionMarketAlternativeCandidate[];
  controls: {
    canInspectReadOnly: true;
    canApplyRecommendation: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function round(value: number | null | undefined, digits = 4): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function compact(text: string, max = 190): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function statusForSelection(selection: DecisionOddsBoardSelection): DecisionMarketAlternativeStatus {
  if (selection.action === "avoid") return "avoid";
  if (selection.action === "value" && selection.expectedValue > 0 && selection.edge > 0) return "priced-value";
  return "priced-watch";
}

function pricedAlternative(selection: DecisionOddsBoardSelection): DecisionMarketAlternativeOption {
  return {
    id: selection.id,
    source: "priced-market",
    marketId: selection.marketId,
    marketName: selection.marketName,
    selectionId: selection.selectionId,
    selection: selection.selection,
    status: statusForSelection(selection),
    probability: selection.modelProbability,
    odds: selection.odds,
    noVigProbability: selection.noVigImpliedProbability,
    edge: selection.edge,
    expectedValue: selection.expectedValue,
    risk: selection.risk,
    rationale: compact(selection.saferAlternative || selection.whyModelLikesIt || selection.riskNote),
    verifyUrl: selection.verifyUrl
  };
}

function alternativeRank(option: DecisionMarketAlternativeOption): number {
  const statusScore =
    option.status === "priced-value" ? 300 : option.status === "priced-watch" ? 170 : option.status === "watch-no-price" ? 115 : option.status === "needs-provider-price" ? 80 : -60;
  return statusScore + (option.expectedValue ?? 0) * 100 + (option.edge ?? 0) * 80 + (option.probability ?? 0) * 20;
}

function uniqueOptions(options: DecisionMarketAlternativeOption[]): DecisionMarketAlternativeOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.marketId}:${option.selectionId}:${option.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function includesAny(value: string, words: string[]): boolean {
  const lower = value.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function findMatchWinnerProbabilities(selections: DecisionOddsBoardSelection[]) {
  const winner = selections.filter((selection) => selection.marketId === "match_winner");
  const home = winner.find((selection) => includesAny(selection.selectionId, ["home"]) || (!includesAny(selection.selectionId, ["draw", "away"]) && !includesAny(selection.selection, ["draw"])));
  const draw = winner.find((selection) => includesAny(selection.selectionId, ["draw"]) || includesAny(selection.selection, ["draw"]));
  const away = winner.find((selection) => includesAny(selection.selectionId, ["away"]));
  return {
    home,
    draw,
    away
  };
}

function splitTeams(match: string): { home: string; away: string } {
  const parts = match.split(" vs ");
  return {
    home: parts[0] ?? "Home",
    away: parts[1] ?? "Away"
  };
}

function derivedFootballAlternatives(candidate: DecisionProbabilityFusionCandidate, selections: DecisionOddsBoardSelection[]): DecisionMarketAlternativeOption[] {
  if (candidate.sport !== "football") return [];
  const { home, draw, away } = findMatchWinnerProbabilities(selections);
  if (!home || !draw || !away) return [];

  const teams = splitTeams(candidate.match);
  const homeProbability = home.modelProbability;
  const drawProbability = draw.modelProbability;
  const awayProbability = away.modelProbability;
  const homeAwayTotal = homeProbability + awayProbability;

  const options: DecisionMarketAlternativeOption[] = [
    {
      id: `${candidate.matchId}:double_chance:home_draw`,
      source: "derived-football-safety",
      marketId: "double_chance",
      marketName: "Double chance",
      selectionId: "home_draw",
      selection: `${teams.home} or Draw`,
      status: "needs-provider-price",
      probability: round(homeProbability + drawProbability),
      odds: null,
      noVigProbability: null,
      edge: null,
      expectedValue: null,
      risk: "lower",
      rationale: "Derived from 1X2 model probabilities; needs provider odds before value can be calculated.",
      verifyUrl: null
    },
    {
      id: `${candidate.matchId}:double_chance:away_draw`,
      source: "derived-football-safety",
      marketId: "double_chance",
      marketName: "Double chance",
      selectionId: "away_draw",
      selection: `${teams.away} or Draw`,
      status: "needs-provider-price",
      probability: round(awayProbability + drawProbability),
      odds: null,
      noVigProbability: null,
      edge: null,
      expectedValue: null,
      risk: "lower",
      rationale: "Derived from 1X2 model probabilities; needs provider odds before value can be calculated.",
      verifyUrl: null
    },
    {
      id: `${candidate.matchId}:draw_no_bet:home`,
      source: "derived-football-safety",
      marketId: "draw_no_bet",
      marketName: "Draw no bet",
      selectionId: "home",
      selection: `${teams.home} DNB`,
      status: "needs-provider-price",
      probability: homeAwayTotal > 0 ? round(homeProbability / homeAwayTotal) : null,
      odds: null,
      noVigProbability: null,
      edge: null,
      expectedValue: null,
      risk: "medium-low",
      rationale: "Removes the draw from the win/loss decision; requires priced DNB odds before EV is valid.",
      verifyUrl: null
    },
    {
      id: `${candidate.matchId}:draw_no_bet:away`,
      source: "derived-football-safety",
      marketId: "draw_no_bet",
      marketName: "Draw no bet",
      selectionId: "away",
      selection: `${teams.away} DNB`,
      status: "needs-provider-price",
      probability: homeAwayTotal > 0 ? round(awayProbability / homeAwayTotal) : null,
      odds: null,
      noVigProbability: null,
      edge: null,
      expectedValue: null,
      risk: "medium-low",
      rationale: "Removes the draw from the win/loss decision; requires priced DNB odds before EV is valid.",
      verifyUrl: null
    }
  ];

  return options
    .filter((option) => option.probability !== null && option.probability >= 0.54)
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
    .slice(0, 3);
}

function strategicAlternative(candidate: DecisionProbabilityFusionCandidate): DecisionMarketAlternativeOption {
  const sportMarket =
    candidate.sport === "basketball"
      ? "Spread or total points"
      : candidate.sport === "tennis"
        ? "Set handicap or total games"
        : "Totals, BTTS, DNB, or double chance";
  return {
    id: `${candidate.matchId}:strategy-note`,
    source: "strategy-note",
    marketId: "strategy_note",
    marketName: sportMarket,
    selectionId: "wait_for_price",
    selection: "Wait for priced lower-variance market",
    status: "watch-no-price",
    probability: candidate.fusedProbability,
    odds: null,
    noVigProbability: null,
    edge: null,
    expectedValue: null,
    risk: "controlled",
    rationale: "No priced safer alternative beat the primary yet; watch lineup, injury, and odds movement before action.",
    verifyUrl: null
  };
}

function buildAlternatives(candidate: DecisionProbabilityFusionCandidate, board: DecisionOddsBoard): DecisionMarketAlternativeOption[] {
  const matchSelections = board.selections.filter((selection) => selection.matchId === candidate.matchId);
  const primarySelection = (candidate.selection ?? "").toLowerCase();
  const priced = matchSelections
    .filter((selection) => selection.selection.toLowerCase() !== primarySelection)
    .map(pricedAlternative)
    .filter((option) => option.status !== "avoid")
    .sort((a, b) => alternativeRank(b) - alternativeRank(a))
    .slice(0, 4);
  const derived = derivedFootballAlternatives(candidate, matchSelections);
  const options = uniqueOptions([...priced, ...derived]).sort((a, b) => alternativeRank(b) - alternativeRank(a)).slice(0, 6);
  return options.length ? options : [strategicAlternative(candidate)];
}

function chooseRecommendation(
  candidate: DecisionProbabilityFusionCandidate,
  alternatives: DecisionMarketAlternativeOption[]
): { recommendation: DecisionMarketAlternativeRecommendation; recommendedAlternative: DecisionMarketAlternativeOption | null; rationale: string } {
  const best = alternatives[0] ?? null;
  const bestPriced = alternatives.find((option) => option.status === "priced-value" || option.status === "priced-watch") ?? null;
  const hasSevereBlocks = candidate.blockers.length >= 4 || candidate.verdict === "blocked";

  if (bestPriced && (hasSevereBlocks || (bestPriced.expectedValue ?? 0) >= (candidate.fusedExpectedValue ?? 0))) {
    return {
      recommendation: "prefer-safer-alternative",
      recommendedAlternative: bestPriced,
      rationale: `${bestPriced.selection} has a priced market signal and is safer to inspect than forcing the primary ${candidate.selection ?? "selection"}.`
    };
  }

  if (best && best.odds === null) {
    return {
      recommendation: "needs-price",
      recommendedAlternative: best,
      rationale: `${best.selection} is a plausible safer route, but value cannot be calculated until provider odds are loaded.`
    };
  }

  if (!hasSevereBlocks && (candidate.fusedEdge ?? 0) > 0 && (candidate.fusedExpectedValue ?? 0) > 0) {
    return {
      recommendation: "prefer-primary",
      recommendedAlternative: null,
      rationale: "Primary fused probability still carries the strongest audited edge, but it remains shadow-only."
    };
  }

  return {
    recommendation: "avoid-market",
    recommendedAlternative: best,
    rationale: "Current blockers are too strong for an actionable market call; keep the match in research mode."
  };
}

function candidateFor(candidate: DecisionProbabilityFusionCandidate, board: DecisionOddsBoard): DecisionMarketAlternativeCandidate {
  const alternatives = buildAlternatives(candidate, board);
  const decision = chooseRecommendation(candidate, alternatives);
  const risks = [
    ...candidate.blockers.slice(0, 3),
    ...candidate.safeguards.filter((item) => /injury|lineup|weather|live|provider|training/i.test(item)).slice(0, 2)
  ];

  return {
    matchId: candidate.matchId,
    match: candidate.match,
    sport: candidate.sport,
    league: candidate.league,
    primary: {
      selection: candidate.selection,
      verdict: candidate.verdict,
      fusedProbability: candidate.fusedProbability,
      fusedEdge: candidate.fusedEdge,
      fusedExpectedValue: candidate.fusedExpectedValue,
      odds: candidate.odds,
      blockers: candidate.blockers
    },
    recommendation: decision.recommendation,
    recommendedAlternative: decision.recommendedAlternative,
    alternatives,
    risks,
    rationale: compact(decision.rationale)
  };
}

function statusFor(candidates: DecisionMarketAlternativeCandidate[]): DecisionMarketAlternativeArbiterStatus {
  if (!candidates.length) return "blocked";
  if (candidates.every((candidate) => candidate.recommendation === "avoid-market")) return "avoid-only";
  if (candidates.some((candidate) => candidate.recommendation === "prefer-safer-alternative" || candidate.recommendation === "prefer-primary")) return "shadow-ready";
  return "needs-price";
}

export function buildDecisionMarketAlternativeArbiter({
  oddsBoard,
  probabilityFusionAudit,
  date,
  sport,
  limit = 6,
  now = new Date()
}: {
  oddsBoard: DecisionOddsBoard;
  probabilityFusionAudit: DecisionProbabilityFusionAudit;
  date: string;
  sport: Sport;
  limit?: number;
  now?: Date;
}): DecisionMarketAlternativeArbiter {
  const candidates = probabilityFusionAudit.candidates.map((candidate) => candidateFor(candidate, oddsBoard)).slice(0, limit);
  const status = statusFor(candidates);
  const alternatives = candidates.flatMap((candidate) => candidate.alternatives);
  const preferPrimary = candidates.filter((candidate) => candidate.recommendation === "prefer-primary").length;
  const preferSaferAlternative = candidates.filter((candidate) => candidate.recommendation === "prefer-safer-alternative").length;
  const needsPrice = candidates.filter((candidate) => candidate.recommendation === "needs-price").length;
  const avoidMarket = candidates.filter((candidate) => candidate.recommendation === "avoid-market").length;
  const hashPayload = candidates.map((candidate) => [
    candidate.matchId,
    candidate.primary.selection,
    candidate.recommendation,
    candidate.recommendedAlternative?.selection ?? null,
    candidate.alternatives.map((option) => [option.marketId, option.selectionId, option.status, option.probability, option.expectedValue])
  ]);

  return {
    mode: "market-alternative-arbiter",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    arbiterHash: stableHash({ date, sport, hashPayload }),
    summary:
      candidates.length === 0
        ? "Market alternative arbiter is blocked because no fused candidates were available."
        : `Market alternative arbiter reviewed ${candidates.length} fused candidate(s), ${alternatives.length} safer route(s), and kept all action controls locked.`,
    totals: {
      candidates: candidates.length,
      alternatives: alternatives.length,
      pricedAlternatives: alternatives.filter((option) => option.source === "priced-market").length,
      derivedAlternatives: alternatives.filter((option) => option.source === "derived-football-safety").length,
      preferPrimary,
      preferSaferAlternative,
      needsPrice,
      avoidMarket
    },
    topCandidate: candidates[0] ?? null,
    candidates,
    controls: {
      canInspectReadOnly: true,
      canApplyRecommendation: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/market-alternative-arbiter",
      "/api/sports/decision/probability-fusion-audit",
      "/api/sports/decision/odds-board",
      "/api/sports/decision/odds-intelligence-proof"
    ],
    locks: [
      "Alternative-market arbitration is read-only and cannot apply, publish, stake, persist, or train.",
      "Derived double chance and draw-no-bet routes need provider odds before edge or EV can be trusted.",
      "Fresh lineups, injuries, suspensions, weather, live events, historical labels, and operator controls still gate action."
    ]
  };
}
