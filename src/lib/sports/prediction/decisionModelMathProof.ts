import type { Match, Prediction, Sport } from "@/lib/sports/types";
import type { DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import type { DecisionProviderKeyPlan } from "@/lib/sports/prediction/decisionProviderKeyPlan";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionModelMathProofStatus = "ready-proof" | "needs-provider" | "blocked";
export type DecisionModelMathCheckStatus = "pass" | "watch" | "blocked";

export type DecisionModelMathSlateInput = {
  sport: DecisionMultiSport;
  rows: DecisionRow[];
};

export type DecisionModelMathFormula = {
  id: string;
  label: string;
  equation: string;
  inputs: string[];
  output: string;
};

export type DecisionModelMathFeedGate = {
  feedId: string;
  label: string;
  status: "configured" | "missing-critical" | "optional-missing";
  missingKeys: string[];
  modelFeatures: string[];
  proofUrl: string;
};

export type DecisionModelMathSportProof = {
  sport: DecisionMultiSport;
  modelVersion: string;
  status: DecisionModelMathProofStatus;
  matches: number;
  markets: string[];
  formulas: DecisionModelMathFormula[];
  requiredInputs: string[];
  presentSignals: string[];
  proxyOrMissingInputs: string[];
  providerFeedGates: DecisionModelMathFeedGate[];
  blockedProviderFeeds: number;
  averageDataQuality: number;
  averageExpectedHome: number;
  averageExpectedAway: number;
  averageExpectedTotal: number;
  normalizedWinnerMarkets: number;
  example: {
    matchId: string;
    match: string;
    league: string;
    expectedScore: string;
    topOutcome: string;
    bestSelection: string;
    edge: number | null;
    expectedValue: number | null;
    proofUrl: string;
  } | null;
  summary: string;
};

export type DecisionModelMathExample = {
  sport: DecisionMultiSport;
  matchId: string;
  match: string;
  modelVersion: string;
  expectedScore: string;
  topOutcome: string;
  dataQuality: number;
  uncertainty: string;
  markets: Array<{
    marketId: string;
    selections: Array<{
      selectionId: string;
      probability: number;
    }>;
  }>;
  signalScores: Array<{
    label: string;
    value: number;
    note: string;
  }>;
  proofUrl: string;
};

export type DecisionModelMathCheck = {
  id:
    | "football-poisson"
    | "basketball-efficiency"
    | "tennis-surface-elo"
    | "market-normalization"
    | "context-and-market-prior"
    | "provider-feed-gating"
    | "no-live-upgrade";
  label: string;
  status: DecisionModelMathCheckStatus;
  detail: string;
};

export type DecisionModelMathProof = {
  mode: "model-math-proof";
  generatedAt: string;
  date: string;
  status: DecisionModelMathProofStatus;
  proofHash: string;
  summary: string;
  totals: {
    sports: number;
    matches: number;
    formulas: number;
    markets: number;
    modelVersions: number;
    normalizedWinnerMarkets: number;
    providerFeeds: number;
    blockedProviderFeeds: number;
    averageDataQuality: number;
  };
  sports: DecisionModelMathSportProof[];
  examples: DecisionModelMathExample[];
  checks: DecisionModelMathCheck[];
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUseLearnedWeights: false;
    canUpgradePublicAction: false;
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

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function average(values: number[], digits = 2): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, digits);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function formulasForSport(sport: DecisionMultiSport): DecisionModelMathFormula[] {
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
        id: "pace-efficiency-total",
        label: "Pace and efficiency total",
        equation: "expectedTotal = offense + defenseResistance + paceAdjustment + rotationTotalAdjustment",
        inputs: ["pace", "offensive efficiency", "defensive resistance", "rest/availability"],
        output: "Projected total points"
      },
      {
        id: "spread-moneyline",
        label: "Spread and moneyline",
        equation: "P(home) = logistic(margin / 7.2); P(cover) = logistic((margin - spreadLine) / 6.5)",
        inputs: ["expected margin", "posted spread", "home/away rating"],
        output: "Moneyline and spread probabilities"
      }
    ];
  }

  if (sport === "tennis") {
    return [
      {
        id: "surface-elo",
        label: "Surface Elo win model",
        equation: "P(player1) = logistic(eloDiff * 1.15 + formDiff * 0.9 + surface + fatigue + round + h2h + travel)",
        inputs: ["player Elo", "surface-specific rating", "recent form", "fatigue", "tournament round", "head-to-head", "travel/load"],
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
        inputs: ["win-probability dominance", "recent form", "posted games line"],
        output: "Over/under games probability"
      }
    ];
  }

  return [
    {
      id: "expected-goals",
      label: "Expected goals",
      equation:
        "xG_home = clamp(proxyGoals + boundedBlend(providerXGFor, opponentXGAgainst, dataQuality))",
      inputs: ["attack strength", "defense strength", "team rating", "recent form", "league goal rate", "home advantage", "provider xG where available"],
      output: "Home and away expected goals"
    },
    {
      id: "poisson-score-matrix",
      label: "Poisson score matrix",
      equation: "P(score h-a) = Pois(h; xG_home) * Pois(a; xG_away), then apply Dixon-Coles low-score correction",
      inputs: ["home xG", "away xG", "Dixon-Coles rho"],
      output: "Match winner, totals, BTTS, and scoreline probabilities"
    },
    {
      id: "market-edge",
      label: "Market value math",
      equation: "edge = modelProbability - noVigProbability; EV = modelProbability * decimalOdds - 1",
      inputs: ["model probability", "bookmaker odds", "no-vig probability"],
      output: "Value edge and expected value"
    }
  ];
}

function requiredInputsForSport(sport: DecisionMultiSport): string[] {
  if (sport === "basketball") return ["team rating", "pace", "offensive efficiency", "defensive efficiency", "rest days", "home/away", "recent injuries", "spread", "moneyline"];
  if (sport === "tennis") return ["player Elo", "surface-specific rating", "recent form", "head-to-head", "fatigue", "tournament round", "injury/news"];
  return ["Poisson expected goals", "team strength/Elo", "home advantage", "recent form", "xG blend where available", "injury/news adjustment", "market odds adjustment"];
}

function proxyOrMissingInputs(sport: DecisionMultiSport, rows: DecisionRow[]): string[] {
  const coverage = rows.flatMap((row) => row.prediction.decision.dataCoverage.signals);
  const missing = coverage
    .filter((signal) => signal.requiredForProduction && (signal.status === "missing" || signal.status === "mock" || signal.status === "stale"))
    .map((signal) => `${signal.label}: ${signal.status}`);
  const notes = rows.flatMap((row) => row.prediction.diagnostics.calibrationNotes).filter((note) => /proxy|future|not live|replace|provider/i.test(note));
  return unique([...missing, ...notes]).slice(0, 8);
}

function presentSignalLabels(rows: DecisionRow[]): string[] {
  return unique(rows.flatMap((row) => row.prediction.diagnostics.signalScores.map((signal) => signal.label))).slice(0, 12);
}

function providerFeedGatesForSport(sport: DecisionMultiSport, providerKeyPlan: DecisionProviderKeyPlan | null): DecisionModelMathFeedGate[] {
  if (!providerKeyPlan) return [];
  return providerKeyPlan.feedMatrix.rows
    .filter((feed) => feed.sports.includes(sport as Sport))
    .sort((a, b) => {
      const statusRank = (status: DecisionModelMathFeedGate["status"]) => (status === "missing-critical" ? 0 : status === "optional-missing" ? 1 : 2);
      return statusRank(a.status) - statusRank(b.status) || a.priority - b.priority;
    })
    .slice(0, 8)
    .map((feed) => ({
      feedId: feed.id,
      label: feed.label,
      status: feed.status,
      missingKeys: feed.missingKeys,
      modelFeatures: feed.modelFeatures,
      proofUrl: feed.proofUrl
    }));
}

function marketIds(rows: DecisionRow[]): string[] {
  return unique(rows.flatMap((row) => row.prediction.markets.map((market) => market.marketId))).sort();
}

function isWinnerMarketNormalized(prediction: Prediction): boolean {
  const market = prediction.markets.find((item) => item.marketId === "match_winner");
  if (!market) return false;
  const sum = Object.values(market.probabilities).reduce((total, value) => total + value, 0);
  return sum >= 0.99 && sum <= 1.01;
}

function exampleForRow(sport: DecisionMultiSport, row: DecisionRow): DecisionModelMathExample {
  return {
    sport,
    matchId: row.match.id,
    match: matchLabel(row.match),
    modelVersion: row.prediction.diagnostics.modelVersion,
    expectedScore:
      row.prediction.diagnostics.expectedScoreLabel ??
      `${row.match.homeTeam.name} ${row.prediction.diagnostics.expectedGoals.home.toFixed(2)} - ${row.match.awayTeam.name} ${row.prediction.diagnostics.expectedGoals.away.toFixed(2)}`,
    topOutcome: row.prediction.diagnostics.topOutcomeLabel ?? row.prediction.explanation.summary,
    dataQuality: round(row.prediction.diagnostics.dataQualityScore),
    uncertainty: row.prediction.diagnostics.uncertainty,
    markets: row.prediction.markets.map((market) => ({
      marketId: market.marketId,
      selections: Object.entries(market.probabilities).map(([selectionId, probability]) => ({
        selectionId,
        probability: round(probability)
      }))
    })),
    signalScores: row.prediction.diagnostics.signalScores.slice(0, 8).map((signal) => ({
      label: signal.label,
      value: round(signal.value),
      note: signal.note
    })),
    proofUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`
  };
}

function sportProof(slate: DecisionModelMathSlateInput, providerKeyPlan: DecisionProviderKeyPlan | null): DecisionModelMathSportProof {
  const rows = slate.rows;
  const modelVersion = rows[0]?.prediction.diagnostics.modelVersion ?? `${slate.sport}-model-missing`;
  const formulas = formulasForSport(slate.sport);
  const markets = marketIds(rows);
  const normalizedWinnerMarkets = rows.filter((row) => isWinnerMarketNormalized(row.prediction)).length;
  const exampleRow =
    rows
      .slice()
      .sort((a, b) => {
        const aEv = a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : -1;
        const bEv = b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : -1;
        return bEv - aEv;
      })[0] ?? null;
  const proxyInputs = proxyOrMissingInputs(slate.sport, rows);
  const providerFeedGates = providerFeedGatesForSport(slate.sport, providerKeyPlan);
  const blockedProviderFeeds = providerFeedGates.filter((feed) => feed.status === "missing-critical").length;
  const status: DecisionModelMathProofStatus = !rows.length ? "blocked" : proxyInputs.length || blockedProviderFeeds ? "needs-provider" : "ready-proof";
  const example = exampleRow
    ? {
        matchId: exampleRow.match.id,
        match: matchLabel(exampleRow.match),
        league: exampleRow.match.league.name,
        expectedScore:
          exampleRow.prediction.diagnostics.expectedScoreLabel ??
          `${exampleRow.prediction.diagnostics.expectedGoals.home.toFixed(2)}-${exampleRow.prediction.diagnostics.expectedGoals.away.toFixed(2)}`,
        topOutcome: exampleRow.prediction.diagnostics.topOutcomeLabel ?? exampleRow.prediction.explanation.summary,
        bestSelection: exampleRow.prediction.bestPick.hasValue ? exampleRow.prediction.bestPick.label : "No clear value found",
        edge: exampleRow.prediction.bestPick.hasValue ? round(exampleRow.prediction.bestPick.edge) : null,
        expectedValue: exampleRow.prediction.bestPick.hasValue ? round(exampleRow.prediction.bestPick.expectedValue) : null,
        proofUrl: `/api/sports/decision/${encodeURIComponent(exampleRow.match.id)}`
      }
    : null;

  return {
    sport: slate.sport,
    modelVersion,
    status,
    matches: rows.length,
    markets,
    formulas,
    requiredInputs: requiredInputsForSport(slate.sport),
    presentSignals: presentSignalLabels(rows),
    proxyOrMissingInputs: proxyInputs,
    providerFeedGates,
    blockedProviderFeeds,
    averageDataQuality: average(rows.map((row) => row.prediction.diagnostics.dataQualityScore * 100), 1),
    averageExpectedHome: average(rows.map((row) => row.prediction.diagnostics.expectedGoals.home), 2),
    averageExpectedAway: average(rows.map((row) => row.prediction.diagnostics.expectedGoals.away), 2),
    averageExpectedTotal: average(rows.map((row) => row.prediction.diagnostics.expectedGoals.total), 2),
    normalizedWinnerMarkets,
    example,
    summary:
      status === "ready-proof"
        ? `${slate.sport} model math is fully inspectable with provider-backed inputs.`
        : status === "needs-provider"
          ? `${slate.sport} model math is inspectable, but ${proxyInputs.length} proxy/missing input(s) and ${blockedProviderFeeds} provider feed gate(s) still block learned or production trust.`
          : `${slate.sport} model math is blocked because no rows are available.`
  };
}

function proofChecks(sports: DecisionModelMathSportProof[], examples: DecisionModelMathExample[]): DecisionModelMathCheck[] {
  const sportSet = new Set(sports.map((sport) => sport.sport));
  const normalizedWinnerMarkets = sports.reduce((sum, sport) => sum + sport.normalizedWinnerMarkets, 0);
  const totalMatches = sports.reduce((sum, sport) => sum + sport.matches, 0);
  const hasContextAndMarketPrior = examples.some((example) =>
    example.signalScores.some((signal) => /context|market prior|average bookmaker|data quality/i.test(`${signal.label} ${signal.note}`))
  );
  const blockedProviderFeeds = sports.reduce((sum, sport) => sum + sport.blockedProviderFeeds, 0);

  return [
    {
      id: "football-poisson",
      label: "Football Poisson model",
      status: sportSet.has("football") && sports.find((sport) => sport.sport === "football")?.modelVersion.includes("poisson") ? "pass" : "blocked",
      detail: "Football uses expected goals, a bounded provider-xG blend where available, a Poisson score matrix, Dixon-Coles correction, home advantage, form, team strength, totals, and BTTS probabilities."
    },
    {
      id: "basketball-efficiency",
      label: "Basketball efficiency model",
      status: sportSet.has("basketball") && sports.find((sport) => sport.sport === "basketball")?.modelVersion.includes("efficiency") ? "pass" : "blocked",
      detail: "Basketball uses rating margin, pace, offensive/defensive efficiency proxies, rest days, availability, spread, total, and moneyline logic."
    },
    {
      id: "tennis-surface-elo",
      label: "Tennis surface Elo model",
      status: sportSet.has("tennis") && sports.find((sport) => sport.sport === "tennis")?.modelVersion.includes("surface-elo") ? "pass" : "blocked",
      detail: "Tennis uses player Elo, surface rating, form, fatigue, round, head-to-head, travel/load, set handicap, and total-games logic."
    },
    {
      id: "market-normalization",
      label: "Market probability normalization",
      status: normalizedWinnerMarkets === totalMatches && totalMatches > 0 ? "pass" : normalizedWinnerMarkets > 0 ? "watch" : "blocked",
      detail: `${normalizedWinnerMarkets}/${totalMatches} match-winner markets sum to approximately 100%.`
    },
    {
      id: "context-and-market-prior",
      label: "Context and market-prior integration",
      status: hasContextAndMarketPrior ? "pass" : "watch",
      detail: hasContextAndMarketPrior
        ? "Diagnostics include bounded context/data-quality or market-prior signals before final edge ranking."
        : "Model diagnostics are available, but context or market-prior signal notes were not found in the proof examples."
    },
    {
      id: "provider-feed-gating",
      label: "Provider feed gating",
      status: blockedProviderFeeds > 0 ? "watch" : "pass",
      detail:
        blockedProviderFeeds > 0
          ? `${blockedProviderFeeds} critical provider feed gate(s) still block live trust even though formulas calculate in shadow mode.`
          : "Provider feed matrix has no critical feed blockers for the current sport proofs."
    },
    {
      id: "no-live-upgrade",
      label: "No training or publish upgrade",
      status: "pass",
      detail: "Model math proof is read-only and cannot train, persist, publish, use learned weights, or upgrade public action."
    }
  ];
}

function statusFor(sports: DecisionModelMathSportProof[], checks: DecisionModelMathCheck[]): DecisionModelMathProofStatus {
  if (!sports.length || checks.some((check) => check.status === "blocked")) return "blocked";
  if (sports.some((sport) => sport.status === "needs-provider") || checks.some((check) => check.status === "watch")) return "needs-provider";
  return "ready-proof";
}

export function buildDecisionModelMathProof({
  date,
  slates,
  providerKeyPlan = null,
  limit = 6,
  now = new Date()
}: {
  date: string;
  slates: DecisionModelMathSlateInput[];
  providerKeyPlan?: DecisionProviderKeyPlan | null;
  limit?: number;
  now?: Date;
}): DecisionModelMathProof {
  const sports = slates.map((slate) => sportProof(slate, providerKeyPlan));
  const examples = slates
    .flatMap((slate) => slate.rows.slice(0, Math.max(1, Math.ceil(limit / slates.length))).map((row) => exampleForRow(slate.sport, row)))
    .slice(0, Math.max(1, Math.min(18, limit)));
  const checks = proofChecks(sports, examples);
  const status = statusFor(sports, checks);
  const proofHash = stableHash({
    date,
    status,
    sports: sports.map((sport) => [sport.sport, sport.modelVersion, sport.matches, sport.markets, sport.status]),
    providerFeeds: sports.map((sport) => [sport.sport, sport.providerFeedGates.map((feed) => [feed.feedId, feed.status])]),
    checks: checks.map((check) => [check.id, check.status])
  });
  const allMarkets = unique(sports.flatMap((sport) => sport.markets));
  const modelVersions = unique(sports.map((sport) => sport.modelVersion));

  return {
    mode: "model-math-proof",
    generatedAt: now.toISOString(),
    date,
    status,
    proofHash,
    summary:
      status === "ready-proof"
        ? `Model math proof is ready across ${sports.length} sport(s): football Poisson, basketball efficiency, and tennis surface Elo are inspectable.`
        : status === "needs-provider"
          ? `Model math proof is inspectable, but provider/training gaps still block live learned trust across ${sports.length} sport(s).`
          : "Model math proof is blocked because one or more sport models or normalization checks are missing.",
    totals: {
      sports: sports.length,
      matches: sports.reduce((sum, sport) => sum + sport.matches, 0),
      formulas: sports.reduce((sum, sport) => sum + sport.formulas.length, 0),
      markets: allMarkets.length,
      modelVersions: modelVersions.length,
      normalizedWinnerMarkets: sports.reduce((sum, sport) => sum + sport.normalizedWinnerMarkets, 0),
      providerFeeds: unique(sports.flatMap((sport) => sport.providerFeedGates.map((feed) => feed.feedId))).length,
      blockedProviderFeeds: sports.reduce((sum, sport) => sum + sport.blockedProviderFeeds, 0),
      averageDataQuality: average(sports.map((sport) => sport.averageDataQuality), 1)
    },
    sports,
    examples,
    checks,
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUseLearnedWeights: false,
      canUpgradePublicAction: false
    },
    proofUrls: [
      "/api/sports/decision/model-math-proof",
      "/api/sports/decision/model-cards",
      "/api/sports/decision/feature-matrix",
      "/api/sports/decision/provider-key-plan"
    ],
    locks: [
      "Model math proof is read-only and cannot train, persist, publish, use learned weights, or upgrade a public action.",
      "Provider-backed fixtures, odds, context, historical corpus, calibration, and backtests must pass before learned guardrails can influence live trust.",
      "A positive model edge is not enough; odds intelligence, context proof, portfolio risk, and actionability still gate public posture."
    ]
  };
}
