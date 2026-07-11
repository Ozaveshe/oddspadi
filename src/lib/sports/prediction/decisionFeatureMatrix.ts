import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionFeatureStatus = "provider-backed" | "computed" | "mock" | "missing";
export type DecisionFeatureGroup =
  | "team-strength"
  | "form"
  | "model-output"
  | "market"
  | "context"
  | "data-quality"
  | "learning"
  | "risk";
export type DecisionFeatureMatrixStatus = "ready" | "partial" | "blocked";

export type DecisionFeature = {
  key: string;
  label: string;
  group: DecisionFeatureGroup;
  value: number | null;
  status: DecisionFeatureStatus;
  source: string;
  trainingReady: boolean;
  detail: string;
};

export type DecisionFeatureRow = {
  matchId: string;
  match: string;
  league: string;
  kickoffTime: string;
  sport: Sport;
  featureVector: Record<string, number | null>;
  completenessScore: number;
  trainingReadyScore: number;
  totalFeatures: number;
  numericFeatures: number;
  providerBackedFeatures: number;
  computedFeatures: number;
  mockFeatures: number;
  missingFeatures: number;
  trainingReadyFeatures: number;
  target: {
    result: null;
    homeScore: null;
    awayScore: null;
    closingOddsAvailable: false;
  };
  features: DecisionFeature[];
  blockers: string[];
};

export type DecisionFeatureMatrix = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionFeatureMatrixStatus;
  summary: string;
  rows: DecisionFeatureRow[];
  topRow: DecisionFeatureRow | null;
  featureKeys: string[];
  coverage: {
    totalRows: number;
    totalFeatures: number;
    numericFeatures: number;
    providerBackedFeatures: number;
    computedFeatures: number;
    mockFeatures: number;
    missingFeatures: number;
    trainingReadyFeatures: number;
    averageCompletenessScore: number;
    averageTrainingReadyScore: number;
  };
  trainingContract: {
    targetTable: string;
    snapshotTable: string;
    requiredBeforeTraining: string[];
    exportShape: string;
  };
};

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function formPoints(results: Array<"W" | "D" | "L">): number {
  return results.reduce((sum, result) => sum + (result === "W" ? 3 : result === "D" ? 1 : 0), 0);
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? round(value) : null;
}

function sourceStatus(match: Match, source: "fixture" | "form" | "odds" | "context"): DecisionFeatureStatus {
  if (source === "context") {
    return match.providerContextSignals?.length ? "provider-backed" : "mock";
  }
  if (source === "odds") {
    return match.dataSource?.kind === "provider" && match.dataSource.oddsProvider ? "provider-backed" : "mock";
  }
  if (source === "form") {
    if (match.dataSource?.kind === "provider" && match.dataSource.formProvider && match.dataSource.formProvider !== "deterministic-provider-proxy") {
      return "provider-backed";
    }
    return match.dataSource?.kind === "provider" ? "computed" : "mock";
  }
  return match.dataSource?.kind === "provider" ? "provider-backed" : "mock";
}

function feature(input: Omit<DecisionFeature, "trainingReady">): DecisionFeature {
  return {
    ...input,
    trainingReady: input.value !== null && input.status !== "missing" && input.status !== "mock"
  };
}

function numericFeature({
  key,
  label,
  group,
  value,
  status,
  source,
  detail
}: {
  key: string;
  label: string;
  group: DecisionFeatureGroup;
  value: number | null | undefined;
  status: DecisionFeatureStatus;
  source: string;
  detail: string;
}): DecisionFeature {
  const normalized = numberOrNull(value);
  return feature({
    key,
    label,
    group,
    value: normalized,
    status: normalized === null ? "missing" : status,
    source,
    detail
  });
}

function boolFeature(input: Omit<Parameters<typeof numericFeature>[0], "value"> & { value: boolean | null | undefined }): DecisionFeature {
  return numericFeature({ ...input, value: input.value === null || input.value === undefined ? null : input.value ? 1 : 0 });
}

function learningValue(value: number | null | undefined, active: boolean): DecisionFeatureStatus {
  if (value === null || value === undefined) return "missing";
  return active ? "provider-backed" : "mock";
}

function buildFeatures(row: DecisionRow): DecisionFeature[] {
  const { match, prediction } = row;
  const decision = prediction.decision;
  const bestPick = prediction.bestPick;
  const fixtureStatus = sourceStatus(match, "fixture");
  const formStatus = sourceStatus(match, "form");
  const oddsStatus = sourceStatus(match, "odds");
  const contextStatus = sourceStatus(match, "context");
  const learning = decision.learningProfile;
  const learningActive = Boolean(learning?.active);
  const homeFormPoints = formPoints(match.homeForm.recentResults);
  const awayFormPoints = formPoints(match.awayForm.recentResults);
  const marketPriorWeight = prediction.marketPriorAdjustment.averageWeight;
  const suspensionSignals = prediction.contextAdjustment.signals.filter((signal) => signal.category === "suspension");
  const suspensionStatus: DecisionFeatureStatus = suspensionSignals.length ? contextStatus : "missing";
  const suspensionSource = suspensionSignals[0]?.source ?? "availability-provider";
  const suspensionWeight = suspensionSignals.reduce((sum, signal) => sum + signal.weight * signal.confidence, 0);
  const homeSuspensionImpact = suspensionSignals.filter((signal) => signal.impact === "home-negative").length;
  const awaySuspensionImpact = suspensionSignals.filter((signal) => signal.impact === "away-negative").length;
  const standingsSignals = prediction.contextAdjustment.signals.filter((signal) => signal.category === "standings");
  const standingsStatus: DecisionFeatureStatus = standingsSignals.length ? contextStatus : "missing";
  const standingsSource = standingsSignals[0]?.source ?? "standings-provider";
  const standingsWeight = standingsSignals.reduce((sum, signal) => sum + signal.weight * signal.confidence, 0);
  const homeStandingsEdge = standingsSignals.filter((signal) => signal.impact === "home-positive").length;
  const awayStandingsEdge = standingsSignals.filter((signal) => signal.impact === "away-positive").length;

  return [
    numericFeature({
      key: "home_rating",
      label: "Home team rating",
      group: "team-strength",
      value: match.homeTeam.rating,
      status: fixtureStatus,
      source: match.dataSource?.fixtureProvider ?? "fixture-provider",
      detail: "Home team rating used by the sport model."
    }),
    numericFeature({
      key: "away_rating",
      label: "Away team rating",
      group: "team-strength",
      value: match.awayTeam.rating,
      status: fixtureStatus,
      source: match.dataSource?.fixtureProvider ?? "fixture-provider",
      detail: "Away team rating used by the sport model."
    }),
    numericFeature({
      key: "rating_diff",
      label: "Rating difference",
      group: "team-strength",
      value: match.homeTeam.rating - match.awayTeam.rating,
      status: fixtureStatus,
      source: "feature-builder",
      detail: "Home rating minus away rating."
    }),
    numericFeature({
      key: "league_strength",
      label: "League strength",
      group: "team-strength",
      value: match.league.strength,
      status: fixtureStatus,
      source: match.dataSource?.fixtureProvider ?? "fixture-provider",
      detail: "League-strength prior used by sport-specific models."
    }),
    numericFeature({
      key: "home_form_points",
      label: "Home recent form points",
      group: "form",
      value: homeFormPoints,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Three points for a win and one point for a draw over the recent form window."
    }),
    numericFeature({
      key: "away_form_points",
      label: "Away recent form points",
      group: "form",
      value: awayFormPoints,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Three points for a win and one point for a draw over the recent form window."
    }),
    numericFeature({
      key: "form_points_diff",
      label: "Recent form differential",
      group: "form",
      value: homeFormPoints - awayFormPoints,
      status: formStatus,
      source: "feature-builder",
      detail: "Home recent form points minus away recent form points."
    }),
    numericFeature({
      key: "attack_strength_diff",
      label: "Attack strength differential",
      group: "form",
      value: match.homeForm.attackStrength - match.awayForm.attackStrength,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Home attack strength minus away attack strength."
    }),
    numericFeature({
      key: "defense_strength_diff",
      label: "Defense strength differential",
      group: "form",
      value: match.homeForm.defenseStrength - match.awayForm.defenseStrength,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Home defensive resistance minus away defensive resistance."
    }),
    numericFeature({
      key: "recent_goal_diff",
      label: "Recent goal differential",
      group: "form",
      value: match.homeForm.goalsFor - match.homeForm.goalsAgainst - (match.awayForm.goalsFor - match.awayForm.goalsAgainst),
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Home recent goal difference minus away recent goal difference."
    }),
    numericFeature({
      key: "home_xg_for",
      label: "Home xG for",
      group: "form",
      value: match.homeForm.xgFor,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Provider or historical expected-goals-for input for the home team when available."
    }),
    numericFeature({
      key: "home_xg_against",
      label: "Home xG against",
      group: "form",
      value: match.homeForm.xgAgainst,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Provider or historical expected-goals-against input for the home team when available."
    }),
    numericFeature({
      key: "away_xg_for",
      label: "Away xG for",
      group: "form",
      value: match.awayForm.xgFor,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Provider or historical expected-goals-for input for the away team when available."
    }),
    numericFeature({
      key: "away_xg_against",
      label: "Away xG against",
      group: "form",
      value: match.awayForm.xgAgainst,
      status: formStatus,
      source: match.dataSource?.formProvider ?? "form-provider",
      detail: "Provider or historical expected-goals-against input for the away team when available."
    }),
    numericFeature({
      key: "xg_for_diff",
      label: "xG for differential",
      group: "form",
      value: match.homeForm.xgFor === null || match.homeForm.xgFor === undefined || match.awayForm.xgFor === null || match.awayForm.xgFor === undefined ? null : match.homeForm.xgFor - match.awayForm.xgFor,
      status: formStatus,
      source: "feature-builder",
      detail: "Home xG for minus away xG for."
    }),
    numericFeature({
      key: "xg_against_diff",
      label: "xG against differential",
      group: "form",
      value:
        match.homeForm.xgAgainst === null || match.homeForm.xgAgainst === undefined || match.awayForm.xgAgainst === null || match.awayForm.xgAgainst === undefined
          ? null
          : match.awayForm.xgAgainst - match.homeForm.xgAgainst,
      status: formStatus,
      source: "feature-builder",
      detail: "Away xG against minus home xG against; positive means the home side has the stronger defensive xG profile."
    }),
    numericFeature({
      key: "expected_home_score",
      label: "Expected home score",
      group: "model-output",
      value: prediction.diagnostics.expectedGoals.home,
      status: "computed",
      source: prediction.diagnostics.modelVersion,
      detail: prediction.diagnostics.expectedScoreLabel ?? "Model expected home score."
    }),
    numericFeature({
      key: "expected_away_score",
      label: "Expected away score",
      group: "model-output",
      value: prediction.diagnostics.expectedGoals.away,
      status: "computed",
      source: prediction.diagnostics.modelVersion,
      detail: prediction.diagnostics.expectedScoreLabel ?? "Model expected away score."
    }),
    numericFeature({
      key: "expected_total_score",
      label: "Expected total score",
      group: "model-output",
      value: prediction.diagnostics.expectedGoals.total,
      status: "computed",
      source: prediction.diagnostics.modelVersion,
      detail: "Model expected total score."
    }),
    numericFeature({
      key: "model_probability",
      label: "Best selection model probability",
      group: "model-output",
      value: bestPick.hasValue ? bestPick.modelProbability : decision.beliefState.baseModelProbability,
      status: "computed",
      source: prediction.diagnostics.modelVersion,
      detail: "Model probability for the selected or tracked belief."
    }),
    numericFeature({
      key: "decision_score",
      label: "Decision score",
      group: "model-output",
      value: decision.decisionScore,
      status: "computed",
      source: decision.engineVersion,
      detail: "Weighted decision score after guardrails and review loop."
    }),
    numericFeature({
      key: "best_odds",
      label: "Best pick odds",
      group: "market",
      value: bestPick.hasValue ? bestPick.odds : null,
      status: bestPick.hasValue ? oddsStatus : "missing",
      source: match.dataSource?.oddsProvider ?? "odds-provider",
      detail: "Decimal odds for the best available pick."
    }),
    numericFeature({
      key: "no_vig_probability",
      label: "No-vig probability",
      group: "market",
      value: bestPick.hasValue ? bestPick.noVigImpliedProbability : decision.beliefState.marketImpliedProbability,
      status: bestPick.hasValue ? oddsStatus : "missing",
      source: match.dataSource?.oddsProvider ?? "odds-provider",
      detail: "Bookmaker implied probability after removing margin."
    }),
    numericFeature({
      key: "value_edge",
      label: "Value edge",
      group: "market",
      value: bestPick.hasValue ? bestPick.edge : decision.beliefState.probabilityEdge,
      status: bestPick.hasValue ? "computed" : "missing",
      source: "odds-intelligence",
      detail: "Model probability minus no-vig implied probability."
    }),
    numericFeature({
      key: "expected_value",
      label: "Expected value",
      group: "market",
      value: bestPick.hasValue ? bestPick.expectedValue : decision.beliefState.expectedValue,
      status: bestPick.hasValue ? "computed" : "missing",
      source: "odds-intelligence",
      detail: "Expected value per unit at the quoted price."
    }),
    numericFeature({
      key: "bookmaker_margin",
      label: "Bookmaker margin",
      group: "market",
      value: bestPick.hasValue ? bestPick.bookmakerMargin : prediction.marketPriorAdjustment.averageBookmakerMargin,
      status: oddsStatus,
      source: match.dataSource?.oddsProvider ?? "odds-provider",
      detail: "Market overround before no-vig normalization."
    }),
    numericFeature({
      key: "market_prior_weight",
      label: "Market prior weight",
      group: "market",
      value: marketPriorWeight,
      status: prediction.marketPriorAdjustment.applied ? "computed" : "missing",
      source: "market-prior-calibration",
      detail: "Weight used to blend model probabilities toward no-vig market probabilities."
    }),
    numericFeature({
      key: "actionable_selection_count",
      label: "Actionable selection count",
      group: "market",
      value: decision.oddsIntelligence.actionableSelections,
      status: "computed",
      source: "odds-intelligence",
      detail: "Selections with both positive edge and positive EV."
    }),
    numericFeature({
      key: "context_home_shift",
      label: "Context home shift",
      group: "context",
      value: prediction.contextAdjustment.probabilityShift.home,
      status: contextStatus,
      source: "context-adjustment",
      detail: "Context probability shift applied to the home side."
    }),
    numericFeature({
      key: "context_away_shift",
      label: "Context away shift",
      group: "context",
      value: prediction.contextAdjustment.probabilityShift.away,
      status: contextStatus,
      source: "context-adjustment",
      detail: "Context probability shift applied to the away side."
    }),
    numericFeature({
      key: "context_total_shift",
      label: "Context total shift",
      group: "context",
      value: prediction.contextAdjustment.totalShift,
      status: contextStatus,
      source: "context-adjustment",
      detail: "Context adjustment applied to totals or tempo."
    }),
    numericFeature({
      key: "context_missing_count",
      label: "Missing context count",
      group: "context",
      value: prediction.contextAdjustment.missingSignals.length,
      status: prediction.contextAdjustment.missingSignals.length ? "missing" : contextStatus,
      source: "context-adjustment",
      detail: "Lineup, injury, weather, news, live, rest, or surface signals still missing."
    }),
    numericFeature({
      key: "suspension_context_count",
      label: "Suspension context count",
      group: "context",
      value: suspensionSignals.length ? suspensionSignals.length : null,
      status: suspensionStatus,
      source: suspensionSource,
      detail: "Provider-backed suspension or availability-clearance context signals attached to the fixture."
    }),
    numericFeature({
      key: "suspension_signal_weight",
      label: "Suspension signal weight",
      group: "context",
      value: suspensionSignals.length ? suspensionWeight : null,
      status: suspensionStatus,
      source: suspensionSource,
      detail: "Weighted suspension impact after provider confidence is applied."
    }),
    numericFeature({
      key: "home_suspension_impact_count",
      label: "Home suspension impact count",
      group: "context",
      value: suspensionSignals.length ? homeSuspensionImpact : null,
      status: suspensionStatus,
      source: suspensionSource,
      detail: "Suspension signals that reduce the home side's pre-match context."
    }),
    numericFeature({
      key: "away_suspension_impact_count",
      label: "Away suspension impact count",
      group: "context",
      value: suspensionSignals.length ? awaySuspensionImpact : null,
      status: suspensionStatus,
      source: suspensionSource,
      detail: "Suspension signals that reduce the away side's pre-match context."
    }),
    numericFeature({
      key: "standings_context_count",
      label: "Standings context count",
      group: "context",
      value: standingsSignals.length ? standingsSignals.length : null,
      status: standingsStatus,
      source: standingsSource,
      detail: "Provider-backed standings context signals attached to the fixture."
    }),
    numericFeature({
      key: "standings_signal_weight",
      label: "Standings signal weight",
      group: "context",
      value: standingsSignals.length ? standingsWeight : null,
      status: standingsStatus,
      source: standingsSource,
      detail: "Weighted standings impact after provider confidence is applied."
    }),
    numericFeature({
      key: "home_standings_edge_count",
      label: "Home standings edge count",
      group: "context",
      value: standingsSignals.length ? homeStandingsEdge : null,
      status: standingsStatus,
      source: standingsSource,
      detail: "Standings signals that favor the home side."
    }),
    numericFeature({
      key: "away_standings_edge_count",
      label: "Away standings edge count",
      group: "context",
      value: standingsSignals.length ? awayStandingsEdge : null,
      status: standingsStatus,
      source: standingsSource,
      detail: "Standings signals that favor the away side."
    }),
    numericFeature({
      key: "data_quality_score",
      label: "Model data quality",
      group: "data-quality",
      value: prediction.diagnostics.dataQualityScore,
      status: match.dataSource?.kind === "provider" ? "computed" : "mock",
      source: prediction.diagnostics.modelVersion,
      detail: "Model-level data-quality score."
    }),
    numericFeature({
      key: "coverage_score",
      label: "Decision coverage score",
      group: "data-quality",
      value: decision.dataCoverage.score,
      status: decision.dataCoverage.status === "provider-backed" ? "provider-backed" : decision.dataCoverage.status === "mock-backed" ? "mock" : "computed",
      source: "data-coverage-audit",
      detail: decision.dataCoverage.summary
    }),
    numericFeature({
      key: "missing_signal_count",
      label: "Missing signal count",
      group: "data-quality",
      value: decision.dataCoverage.missingSignals,
      status: decision.dataCoverage.missingSignals ? "missing" : "computed",
      source: "data-coverage-audit",
      detail: "Count of missing production data signals."
    }),
    numericFeature({
      key: "mock_signal_count",
      label: "Mock signal count",
      group: "data-quality",
      value: decision.dataCoverage.mockSignals,
      status: decision.dataCoverage.mockSignals ? "mock" : "computed",
      source: "data-coverage-audit",
      detail: "Count of MVP/mock-backed production signals."
    }),
    boolFeature({
      key: "learning_active",
      label: "Learning profile active",
      group: "learning",
      value: learningActive,
      status: learning ? (learningActive ? "provider-backed" : "mock") : "missing",
      source: learning?.source ?? "learning-profile",
      detail: learning?.reason ?? "No learning profile is available."
    }),
    numericFeature({
      key: "learning_sample_size",
      label: "Learning sample size",
      group: "learning",
      value: learning?.sampleSize,
      status: learningValue(learning?.sampleSize, learningActive),
      source: learning?.source ?? "learning-profile",
      detail: "Number of historical samples behind learned guardrails."
    }),
    numericFeature({
      key: "learned_minimum_edge",
      label: "Learned minimum edge",
      group: "learning",
      value: learning?.minimumEdge,
      status: learningValue(learning?.minimumEdge, learningActive),
      source: learning?.source ?? "learning-profile",
      detail: "Learned minimum edge threshold from real-data backtests."
    }),
    numericFeature({
      key: "calibration_reliability",
      label: "Calibration reliability",
      group: "learning",
      value: decision.calibration.reliabilityScore,
      status: decision.calibration.action === "trust" ? "provider-backed" : "computed",
      source: "calibration",
      detail: decision.calibration.detail
    }),
    numericFeature({
      key: "case_memory_sample_size",
      label: "Case memory sample size",
      group: "learning",
      value: decision.caseMemory.sampleSize,
      status: decision.caseMemory.status === "ready" ? "provider-backed" : decision.caseMemory.status === "not-configured" ? "missing" : "computed",
      source: "case-memory",
      detail: decision.caseMemory.summary
    }),
    numericFeature({
      key: "uncertainty_score",
      label: "Uncertainty score",
      group: "risk",
      value: decision.uncertainty.score,
      status: "computed",
      source: "uncertainty-decomposition",
      detail: decision.uncertainty.summary
    }),
    numericFeature({
      key: "robustness_survival_rate",
      label: "Robustness survival rate",
      group: "risk",
      value: decision.robustness.survivalRate,
      status: "computed",
      source: "robustness-stress-test",
      detail: decision.robustness.summary
    }),
    numericFeature({
      key: "actionability_score",
      label: "Actionability score",
      group: "risk",
      value: decision.actionability.score,
      status: "computed",
      source: "actionability-audit",
      detail: decision.actionability.summary
    }),
    boolFeature({
      key: "publish_allowed",
      label: "Publish allowed",
      group: "risk",
      value: decision.controlPolicy.publishAllowed,
      status: "computed",
      source: "control-policy",
      detail: decision.controlPolicy.summary
    })
  ];
}

function summarizeFeatures(features: DecisionFeature[]) {
  const totalFeatures = features.length;
  const numericFeatures = features.filter((item) => item.value !== null).length;
  const providerBackedFeatures = features.filter((item) => item.status === "provider-backed").length;
  const computedFeatures = features.filter((item) => item.status === "computed").length;
  const mockFeatures = features.filter((item) => item.status === "mock").length;
  const missingFeatures = features.filter((item) => item.status === "missing").length;
  const trainingReadyFeatures = features.filter((item) => item.trainingReady).length;
  const completenessScore = totalFeatures ? round((numericFeatures / totalFeatures) * 100, 1) : 0;
  const trainingReadyScore = totalFeatures ? round((trainingReadyFeatures / totalFeatures) * 100, 1) : 0;

  return {
    totalFeatures,
    numericFeatures,
    providerBackedFeatures,
    computedFeatures,
    mockFeatures,
    missingFeatures,
    trainingReadyFeatures,
    completenessScore,
    trainingReadyScore
  };
}

function rowBlockers(features: DecisionFeature[]): string[] {
  return [
    ...features.filter((item) => item.status === "missing").map((item) => `${item.label}: missing`),
    ...features.filter((item) => item.status === "mock").map((item) => `${item.label}: mock source`)
  ].slice(0, 8);
}

function buildRow(row: DecisionRow): DecisionFeatureRow {
  const features = buildFeatures(row);
  const summary = summarizeFeatures(features);
  return {
    matchId: row.match.id,
    match: matchLabel(row.match),
    league: row.match.league.name,
    kickoffTime: row.match.kickoffTime,
    sport: row.match.sport,
    featureVector: Object.fromEntries(features.map((item) => [item.key, item.value])),
    ...summary,
    target: {
      result: null,
      homeScore: null,
      awayScore: null,
      closingOddsAvailable: false
    },
    features,
    blockers: rowBlockers(features)
  };
}

function matrixStatus(rows: DecisionFeatureRow[]): DecisionFeatureMatrixStatus {
  if (!rows.length) return "blocked";
  if (rows.every((row) => row.trainingReadyScore >= 70 && row.mockFeatures === 0 && row.missingFeatures <= 2)) return "ready";
  if (rows.some((row) => row.trainingReadyScore >= 45)) return "partial";
  return "blocked";
}

function average(values: number[]): number {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : 0;
}

export function buildDecisionFeatureMatrix({
  rows,
  date,
  sport,
  limit = 8
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
}): DecisionFeatureMatrix {
  const featureRows = rows.slice(0, limit).map(buildRow);
  const status = matrixStatus(featureRows);
  const totalFeatures = featureRows.reduce((sum, row) => sum + row.totalFeatures, 0);
  const numericFeatures = featureRows.reduce((sum, row) => sum + row.numericFeatures, 0);
  const providerBackedFeatures = featureRows.reduce((sum, row) => sum + row.providerBackedFeatures, 0);
  const computedFeatures = featureRows.reduce((sum, row) => sum + row.computedFeatures, 0);
  const mockFeatures = featureRows.reduce((sum, row) => sum + row.mockFeatures, 0);
  const missingFeatures = featureRows.reduce((sum, row) => sum + row.missingFeatures, 0);
  const trainingReadyFeatures = featureRows.reduce((sum, row) => sum + row.trainingReadyFeatures, 0);
  const featureKeys = Array.from(new Set(featureRows.flatMap((row) => Object.keys(row.featureVector)))).sort();
  const topRow = featureRows.slice().sort((a, b) => b.trainingReadyScore - a.trainingReadyScore || b.completenessScore - a.completenessScore)[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "ready"
        ? `Feature matrix is training-ready across ${featureRows.length} row(s).`
        : status === "partial"
          ? `Feature matrix is partial: ${trainingReadyFeatures}/${totalFeatures} feature values are training-ready.`
          : `Feature matrix is blocked: provider-backed training features are still too thin across ${featureRows.length} row(s).`,
    rows: featureRows,
    topRow,
    featureKeys,
    coverage: {
      totalRows: featureRows.length,
      totalFeatures,
      numericFeatures,
      providerBackedFeatures,
      computedFeatures,
      mockFeatures,
      missingFeatures,
      trainingReadyFeatures,
      averageCompletenessScore: average(featureRows.map((row) => row.completenessScore)),
      averageTrainingReadyScore: average(featureRows.map((row) => row.trainingReadyScore))
    },
    trainingContract: {
      targetTable: "op_fixture_team_features",
      snapshotTable: "op_training_feature_snapshots",
      requiredBeforeTraining: [
        "Provider-backed fixtures and team identity",
        "Provider-backed or historically computed team form features, including xG for/against where available",
        "Bookmaker odds with no-vig probabilities and closing-price snapshots",
        "Lineup, injury, suspension, standings, news, weather, and event context where relevant",
        "Settled match result plus closing odds for target labels"
      ],
      exportShape: "One row per fixture prediction with featureVector plus target labels for result, final score, and closing odds."
    }
  };
}
