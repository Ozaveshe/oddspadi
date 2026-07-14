import type { DecisionFeatureMatrix, DecisionFeatureRow } from "@/lib/sports/prediction/decisionFeatureMatrix";
import type { DecisionModelGovernance, DecisionModelGovernanceCheck } from "@/lib/sports/prediction/decisionModelGovernance";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { Prediction, Sport } from "@/lib/sports/types";
import { runtimeModelKey } from "@/lib/sports/prediction/modelIdentity";

type ModelCardSport = Extract<Sport, "football" | "basketball" | "tennis">;

export type DecisionModelCardStatus = "training-ready" | "shadow-only" | "blocked";
export type DecisionModelCardFormula = {
  id: string;
  label: string;
  equation: string;
  inputs: string[];
  output: string;
};

export type DecisionModelCardParameter = {
  key: string;
  label: string;
  value: number | string;
  detail: string;
};

export type DecisionModelCardMarket = {
  marketId: string;
  selections: string[];
  probabilitySource: string;
};

export type DecisionModelCard = {
  sport: ModelCardSport;
  label: string;
  modelKey: string;
  modelVersion: string;
  status: DecisionModelCardStatus;
  summary: string;
  formulas: DecisionModelCardFormula[];
  parameters: DecisionModelCardParameter[];
  markets: DecisionModelCardMarket[];
  featureProvenance: {
    rows: number;
    featureKeys: number;
    providerBacked: number;
    computed: number;
    mock: number;
    missing: number;
    trainingReady: number;
    averageCompletenessScore: number;
    averageTrainingReadyScore: number;
    topMissingOrMock: string[];
  };
  trainingCorpus: {
    status: TrainingDataSnapshot["status"];
    configured: boolean;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    backtestRuns: number;
    latestBacktestId: string | null;
    minimumRecommendedFixtures: number;
    readyForTraining: boolean;
    detail: string;
  };
  governance: {
    status: DecisionModelGovernance["status"];
    trustScore: number;
    learnedGuardrailsAllowed: boolean;
    publishWithLearnedWeightsAllowed: boolean;
    failingChecks: number;
    warningChecks: number;
    topChecks: Array<Pick<DecisionModelGovernanceCheck, "id" | "label" | "status" | "score" | "detail" | "requiredAction">>;
  };
  livePolicy: {
    canInfluenceShadowDecision: boolean;
    canUseLearnedWeights: boolean;
    canTrain: boolean;
    canPublish: false;
    canUpgradePublicAction: false;
    reason: string;
  };
  upgradePath: string[];
  proofUrls: string[];
};

export type DecisionModelCards = {
  generatedAt: string;
  date: string;
  mode: "decision-model-cards";
  status: "ready" | "partial" | "blocked";
  summary: string;
  cards: DecisionModelCard[];
  totals: {
    cards: number;
    trainingReady: number;
    shadowOnly: number;
    blocked: number;
    averageTrustScore: number;
  };
  controls: {
    canInspectReadOnly: true;
    canTrain: false;
    canPublish: false;
    canPersist: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
};

type DecisionModelCardInput = {
  sport: ModelCardSport;
  matrix: DecisionFeatureMatrix;
  governance: DecisionModelGovernance;
  training: TrainingDataSnapshot;
  predictions: Prediction[];
};

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function average(values: number[]): number {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : 0;
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function sportLabel(sport: ModelCardSport): string {
  if (sport === "basketball") return "Basketball";
  if (sport === "tennis") return "Tennis";
  return "Football";
}

function modelKey(sport: ModelCardSport): string {
  return runtimeModelKey(sport);
}

function formulasForSport(sport: ModelCardSport): DecisionModelCardFormula[] {
  if (sport === "basketball") {
    return [
      {
        id: "expected-margin",
        label: "Expected margin",
        equation: "margin = ratingDiff * 0.42 + formDiff * 5.5 + homeCourt + restAdjustment + availabilityAdjustment",
        inputs: ["team rating", "recent form", "home court", "rest days", "injury/rotation proxy"],
        output: "Projected home points margin"
      },
      {
        id: "moneyline",
        label: "Moneyline probability",
        equation: "P(home) = logistic(expectedMargin / 7.2)",
        inputs: ["expected margin"],
        output: "Home and away win probability"
      },
      {
        id: "spread-total",
        label: "Spread and total logic",
        equation: "P(cover) = logistic((expectedMargin - spreadLine) / 6.5); P(over) = logistic((expectedTotal - totalLine) / 11.5)",
        inputs: ["posted spread", "posted total", "pace", "offensive efficiency", "defensive resistance"],
        output: "Spread and total-points probabilities"
      }
    ];
  }

  if (sport === "tennis") {
    return [
      {
        id: "surface-elo",
        label: "Surface Elo win model",
        equation: "P(player1) = logistic(eloDiff * 1.15 + formDiff * 0.9 + surface + fatigue + round + h2h + travel)",
        inputs: ["player Elo", "surface rating", "recent form", "fatigue", "round", "head-to-head", "travel/load"],
        output: "Player win probability"
      },
      {
        id: "set-handicap",
        label: "Set handicap",
        equation: "P(player1 set handicap) = P(player1 win) + dominance * 0.28 - 0.12",
        inputs: ["win probability", "dominance"],
        output: "Set-handicap probability"
      },
      {
        id: "total-games",
        label: "Total games",
        equation: "expectedGames = clamp(22.6 + (0.5 - dominance) * 7 + abs(formDiff) * 1.2, 18, 29)",
        inputs: ["win-probability dominance", "recent form gap", "posted games line"],
        output: "Over/under games probability"
      }
    ];
  }

  return [
    {
      id: "expected-goals",
      label: "Expected goals",
      equation:
        "xG_home = clamp(proxyGoals + boundedBlend(providerXGFor, opponentXGAgainst, dataQuality), 0.25, 3.65)",
      inputs: ["team rating", "attack strength", "defense strength", "recent form", "league goal rate", "home advantage", "provider xG where available"],
      output: "Home and away expected goals"
    },
    {
      id: "poisson-score-matrix",
      label: "Poisson score matrix",
      equation: "P(score h-a) = Pois(h; xG_home) * Pois(a; xG_away), then apply Dixon-Coles low-score correction",
      inputs: ["home xG", "away xG", "Dixon-Coles rho"],
      output: "Match winner, total goals, BTTS, and correct-score probabilities"
    },
    {
      id: "odds-edge",
      label: "Odds value intelligence",
      equation: "edge = modelProbability - noVigProbability; EV = modelProbability * decimalOdds - 1",
      inputs: ["model probability", "bookmaker decimal odds", "bookmaker margin"],
      output: "Positive expected value and value edge"
    }
  ];
}

function parametersForSport(sport: ModelCardSport): DecisionModelCardParameter[] {
  if (sport === "basketball") {
    return [
      { key: "home_court", label: "Home court", value: 2.6, detail: "Added to expected margin before moneyline/spread conversion." },
      { key: "margin_scale", label: "Moneyline margin scale", value: 7.2, detail: "Logistic divisor for win probability." },
      { key: "spread_scale", label: "Spread scale", value: 6.5, detail: "Logistic divisor for cover probability." },
      { key: "total_scale", label: "Total scale", value: 11.5, detail: "Logistic divisor for over/under probability." }
    ];
  }

  if (sport === "tennis") {
    return [
      { key: "elo_weight", label: "Elo weight", value: 1.15, detail: "Primary player-strength coefficient." },
      { key: "form_weight", label: "Form weight", value: 0.9, detail: "Recent form coefficient." },
      { key: "surface_weight", label: "Surface weight", value: 0.18, detail: "Surface-strength differential coefficient." },
      { key: "games_scale", label: "Games total scale", value: 2.6, detail: "Logistic divisor for total-games markets." }
    ];
  }

  return [
    { key: "home_advantage", label: "Home advantage", value: 1.11, detail: "Multiplier applied to home expected goals." },
    { key: "away_travel_factor", label: "Away factor", value: 0.94, detail: "Away expected-goals dampener." },
    { key: "dixon_coles_base", label: "Dixon-Coles base", value: "0.035 to 0.098", detail: "Bounded low-score dependence correction before markets are derived." },
    { key: "xg_blend_weight", label: "xG blend weight", value: "0.16 to 0.34", detail: "Provider xG-for and opponent xG-against can move pre-match expected goals with bounded influence." },
    { key: "xg_bounds", label: "xG bounds", value: "home 0.25-3.65, away 0.20-3.45", detail: "MVP expected-goals clamps to avoid unstable tails." }
  ];
}

function marketsForPrediction(predictions: Prediction[], sport: ModelCardSport): DecisionModelCardMarket[] {
  const markets = predictions[0]?.markets ?? [];
  if (!markets.length) {
    return sport === "football"
      ? [
          { marketId: "match_winner", selections: ["home", "draw", "away"], probabilitySource: "Poisson score matrix" },
          { marketId: "over_under_25", selections: ["over_25", "under_25", "over_15"], probabilitySource: "Poisson total-goals matrix" },
          { marketId: "both_teams_to_score", selections: ["yes", "no"], probabilitySource: "Poisson score matrix" }
        ]
      : sport === "basketball"
        ? [
            { marketId: "match_winner", selections: ["home", "away"], probabilitySource: "Logistic margin model" },
            { marketId: "spread", selections: ["home_cover", "away_cover"], probabilitySource: "Logistic spread model" },
            { marketId: "total_points", selections: ["over", "under"], probabilitySource: "Expected total-points model" }
          ]
        : [
            { marketId: "match_winner", selections: ["home", "away"], probabilitySource: "Surface Elo model" },
            { marketId: "set_handicap", selections: ["home_sets", "away_sets"], probabilitySource: "Win-dominance model" },
            { marketId: "total_games", selections: ["over", "under"], probabilitySource: "Expected games model" }
          ];
  }

  return markets.map((market) => ({
    marketId: market.marketId,
    selections: Object.keys(market.probabilities),
    probabilitySource: predictions[0]?.diagnostics.modelVersion ?? modelKey(sport)
  }));
}

function topMissingOrMock(row: DecisionFeatureRow | null): string[] {
  if (!row) return ["No live feature row is available for this sport."];
  return unique(
    row.features
      .filter((feature) => feature.status === "missing" || feature.status === "mock")
      .map((feature) => `${feature.label}: ${feature.status}`),
    8
  );
}

function cardStatus(governance: DecisionModelGovernance, training: TrainingDataSnapshot): DecisionModelCardStatus {
  if (governance.status === "approved" && training.readiness.readyForTraining) return "training-ready";
  if (governance.status === "blocked") return "blocked";
  return "shadow-only";
}

function livePolicyFor(status: DecisionModelCardStatus, governance: DecisionModelGovernance, training: TrainingDataSnapshot): DecisionModelCard["livePolicy"] {
  const canUseLearnedWeights = status === "training-ready" && governance.learnedGuardrailsAllowed;
  return {
    canInfluenceShadowDecision: status !== "blocked",
    canUseLearnedWeights,
    canTrain: false,
    canPublish: false,
    canUpgradePublicAction: false,
    reason: canUseLearnedWeights
      ? "Model card allows learned weights only in shadow inspection until separate publish/write gates pass."
      : training.readiness.readyForTraining
        ? "Training data may be sufficient, but governance has not approved live learned guardrails."
        : "Model stays in shadow because historical corpus, targets, backtests, or runtime storage are not proven."
  };
}

function upgradePath(governance: DecisionModelGovernance, training: TrainingDataSnapshot): string[] {
  return unique(
    [
      training.readiness.hasHistoricalFixtures ? null : `Backfill at least ${training.readiness.minimumRecommendedFixtures} real finished fixtures.`,
      training.readiness.hasOdds ? null : "Import historical bookmaker odds snapshots with opening and closing prices.",
      training.counts.featureSnapshots ? null : "Generate historical feature snapshots from provider-backed inputs.",
      training.readiness.hasBacktests ? null : "Run a completed real-data backtest and store the metrics.",
      ...governance.nextActions
    ],
    8
  );
}

function buildCard(input: DecisionModelCardInput): DecisionModelCard {
  const { sport, matrix, governance, training, predictions } = input;
  const status = cardStatus(governance, training);
  const version = predictions[0]?.diagnostics.modelVersion ?? modelKey(sport);
  const policy = livePolicyFor(status, governance, training);

  return {
    sport,
    label: `${sportLabel(sport)} model card`,
    modelKey: modelKey(sport),
    modelVersion: version,
    status,
    summary:
      status === "training-ready"
        ? `${sportLabel(sport)} model is training-ready in shadow mode with governance trust ${governance.trustScore}/100.`
        : status === "shadow-only"
          ? `${sportLabel(sport)} model is active for deterministic shadow decisions, but learned/live upgrades remain gated.`
          : `${sportLabel(sport)} model is blocked from learned/live upgrades by governance or training readiness.`,
    formulas: formulasForSport(sport),
    parameters: parametersForSport(sport),
    markets: marketsForPrediction(predictions, sport),
    featureProvenance: {
      rows: matrix.coverage.totalRows,
      featureKeys: matrix.featureKeys.length,
      providerBacked: matrix.coverage.providerBackedFeatures,
      computed: matrix.coverage.computedFeatures,
      mock: matrix.coverage.mockFeatures,
      missing: matrix.coverage.missingFeatures,
      trainingReady: matrix.coverage.trainingReadyFeatures,
      averageCompletenessScore: matrix.coverage.averageCompletenessScore,
      averageTrainingReadyScore: matrix.coverage.averageTrainingReadyScore,
      topMissingOrMock: topMissingOrMock(matrix.topRow)
    },
    trainingCorpus: {
      status: training.status,
      configured: training.configured,
      realFinishedFixtures: training.counts.realFinishedFixtures,
      realOddsSnapshots: training.counts.realOddsSnapshots,
      featureSnapshots: training.counts.featureSnapshots,
      backtestRuns: training.counts.backtestRuns,
      latestBacktestId: training.latestBacktest?.id ?? null,
      minimumRecommendedFixtures: training.readiness.minimumRecommendedFixtures,
      readyForTraining: training.readiness.readyForTraining,
      detail: training.reason ?? training.readiness.detail
    },
    governance: {
      status: governance.status,
      trustScore: governance.trustScore,
      learnedGuardrailsAllowed: governance.learnedGuardrailsAllowed,
      publishWithLearnedWeightsAllowed: governance.publishWithLearnedWeightsAllowed,
      failingChecks: governance.failingChecks,
      warningChecks: governance.warningChecks,
      topChecks: governance.checks
        .slice()
        .sort((a, b) => {
          const rank = { fail: 2, warn: 1, pass: 0 };
          return rank[b.status] - rank[a.status] || a.score - b.score;
        })
        .slice(0, 5)
        .map((check) => ({
          id: check.id,
          label: check.label,
          status: check.status,
          score: check.score,
          detail: compact(check.detail),
          requiredAction: check.requiredAction ? compact(check.requiredAction) : null
        }))
    },
    livePolicy: policy,
    upgradePath: upgradePath(governance, training),
    proofUrls: unique([
      `/api/sports/decision/model-cards?sport=${sport}`,
      `/api/sports/decision/feature-matrix?sport=${sport}`,
      `/api/sports/decision/model-governance?sport=${sport}`,
      `/api/sports/decision/training?sport=${sport}`
    ])
  };
}

function cardsStatus(cards: DecisionModelCard[]): DecisionModelCards["status"] {
  if (!cards.length || cards.every((card) => card.status === "blocked")) return "blocked";
  if (cards.every((card) => card.status === "training-ready")) return "ready";
  return "partial";
}

export function buildDecisionModelCards({
  date,
  inputs,
  now = new Date()
}: {
  date: string;
  inputs: DecisionModelCardInput[];
  now?: Date;
}): DecisionModelCards {
  const cards = inputs.map(buildCard);
  const status = cardsStatus(cards);
  const averageTrustScore = average(cards.map((card) => card.governance.trustScore));

  return {
    generatedAt: now.toISOString(),
    date,
    mode: "decision-model-cards",
    status,
    summary:
      status === "ready"
        ? `All ${cards.length} model card(s) are training-ready in shadow mode.`
        : status === "partial"
          ? `${cards.length} model card(s) are inspectable; learned/live upgrades remain gated where proof is missing.`
          : "Model cards are blocked because no sport model has enough governed proof for learned/live upgrades.",
    cards,
    totals: {
      cards: cards.length,
      trainingReady: cards.filter((card) => card.status === "training-ready").length,
      shadowOnly: cards.filter((card) => card.status === "shadow-only").length,
      blocked: cards.filter((card) => card.status === "blocked").length,
      averageTrustScore
    },
    controls: {
      canInspectReadOnly: true,
      canTrain: false,
      canPublish: false,
      canPersist: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(["/api/sports/decision/model-cards", ...cards.flatMap((card) => card.proofUrls)], 20)
  };
}
