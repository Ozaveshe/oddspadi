import { DECISION_ENGINE_VERSION } from "@/lib/sports/prediction/decisionEngine";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";
import { footballModelRatingFromElo } from "@/lib/sports/prediction/historicalElo";
import { decisionModelIdentity, runtimeModelIdentityReceipt, runtimeModelKey } from "@/lib/sports/prediction/modelIdentity";
import { footballLeagueStrength } from "@/lib/sports/footballLeagues";
import {
  applyContextAdjustmentToMarkets,
  buildMatchContextAdjustment,
  coreModelContextCategories
} from "@/lib/sports/prediction/contextAdjustment";
import type { Match, MatchContextSignal } from "@/lib/sports/types";
import {
  buildFootballLearnedWeightsProvenance,
  evaluateFootballPrediction,
  footballDecisionLearnedWeights,
  resolveFootballBacktestConfig,
  summarizeFootballEvaluation,
  type FootballBacktestFixtureResult,
  type FootballBacktestResult,
  type FootballDecisionLearnedWeights,
  type FootballLearnedWeightsProvenance,
  type FootballOutcome,
  type HistoricalFootballFixture
} from "@/lib/sports/training/footballBacktest";
import { deriveFootballChronologyFeatures } from "@/lib/sports/training/footballChronologyFeatures";
import type { HistoricalFootballFeatureInput, HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";
import {
  buildPlayerFormSignal,
  type PlayerMatchPerformance
} from "@/lib/sports/training/playerPerformance";
import { consolidateFootballRuntimeFixtures } from "@/lib/sports/training/footballRuntimeFixtureConsolidation";

export type FootballRuntimeReplayConfig = {
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  minPriorMatches?: number;
};

export type FootballRuntimeReplayRejection = {
  fixtureExternalId: string;
  reasons: string[];
};

export type FootballRuntimeFeatureContract = {
  status: "passed" | "failed";
  version: string;
  chronologyVersion: "football-provider-chronology-v3";
  sourceFixtures: number;
  duplicateFixtureGroups: number;
  duplicateSourceFixturesCollapsed: number;
  conflictingDuplicateGroups: number;
  eligibleFixtures: number;
  rejectedFixtures: number;
  trainingEvaluatedFixtures: number;
  trainingEntrypointInvocations: number;
  evaluatedFixtures: number;
  entrypointInvocations: number;
  optionalCoverage: {
    xgFixtures: number;
    contextSignalFixtures: number;
    playerFormFixtures: number;
    playerFormEligibleFixtures: number;
    playerFormReadyFixtures: number;
    playerFormTrainingEligibleFixtures: number;
    playerFormTrainingReadyFixtures: number;
    playerFormHoldoutEligibleFixtures: number;
    playerFormHoldoutReadyFixtures: number;
    completeOddsFixtures: number;
  };
  rejectionReasons: Record<string, number>;
};

export type FootballRuntimeReplayResult = Omit<FootballBacktestResult, "config" | "learnedWeights"> & {
  config: Required<FootballRuntimeReplayConfig>;
  learnedWeights: FootballDecisionLearnedWeights;
  featureContract: FootballRuntimeFeatureContract;
  executionHash: string;
  rejections: FootballRuntimeReplayRejection[];
};

export function footballRuntimeReplayIdentityReceipt(
  result: Pick<FootballRuntimeReplayResult, "featureContract" | "executionHash">
): Record<string, string | number> {
  if (result.featureContract.status !== "passed") {
    throw new Error("Refusing to create a runtime identity receipt for a failed football feature contract.");
  }
  return runtimeModelIdentityReceipt("football", {
    featureContractStatus: "passed",
    evaluatedFixtures: result.featureContract.evaluatedFixtures,
    entrypointInvocations: result.featureContract.entrypointInvocations,
    executionHash: result.executionHash
  });
}

type PreparedRuntimeFixture = {
  source: HistoricalFootballFixtureInput;
  match: Match;
  evaluationFixture: HistoricalFootballFixture;
};

const RUNTIME_MODEL_KEY = runtimeModelKey("football");
const FEATURE_CONTRACT_VERSION = decisionModelIdentity("football").featureContractVersion;
const CHRONOLOGY_VERSION = "football-provider-chronology-v3" as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function resolvedConfig(config: FootballRuntimeReplayConfig): Required<FootballRuntimeReplayConfig> {
  return {
    trainRatio: clamp(config.trainRatio ?? 0.7, 0.1, 0.9),
    minEdge: clamp(config.minEdge ?? 0.04, 0, 0.25),
    minModelProbability: clamp(config.minModelProbability ?? 0.3, 0.05, 0.95),
    minPriorMatches: Math.round(clamp(config.minPriorMatches ?? 3, 0, 20))
  };
}

function chronology(features: HistoricalFootballFeatureInput | undefined): Record<string, unknown> {
  const value = features?.metadata?.chronology;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recentResults(features: HistoricalFootballFeatureInput | undefined): Array<"W" | "D" | "L"> | null {
  const value = chronology(features).recentResults;
  if (!Array.isArray(value) || !value.every((result) => result === "W" || result === "D" || result === "L")) return null;
  return value;
}

function completeWinnerOdds(fixture: HistoricalFootballFixtureInput): boolean {
  const selections = new Set(
    (fixture.odds ?? [])
      .filter((quote) => quote.market === "match_winner" && finite(quote.decimalOdds) && quote.decimalOdds > 1)
      .map((quote) => quote.selection)
  );
  return selections.has("home") && selections.has("draw") && selections.has("away");
}

function supportsHistoricalPlayerStats(fixture: HistoricalFootballFixtureInput): boolean {
  return cleanText(fixture.metadata?.provider).toLowerCase().replaceAll("-", "_") === "api_football";
}

function hasPlayerFormSignal(fixture: PreparedRuntimeFixture): boolean {
  return Boolean(fixture.match.providerContextSignals?.some((signal) => signal.category === "player-form"));
}

function hasReadyPlayerFormSignal(fixture: PreparedRuntimeFixture): boolean {
  return Boolean(fixture.match.providerContextSignals?.some((signal) =>
    signal.category === "player-form" && (signal.quality === "acceptable" || signal.quality === "strong")
  ));
}

function playerCoverage(fixtures: readonly PreparedRuntimeFixture[]): { eligible: number; ready: number } {
  const eligible = fixtures.filter((fixture) => supportsHistoricalPlayerStats(fixture.source));
  return {
    eligible: eligible.length,
    ready: eligible.filter(hasReadyPlayerFormSignal).length
  };
}

function freshTimestamp(value: string | null | undefined, kickoffAt: string, maxAgeMinutes: number): boolean {
  if (!value) return false;
  const observed = Date.parse(value);
  const kickoff = Date.parse(kickoffAt);
  if (!Number.isFinite(observed) || !Number.isFinite(kickoff) || observed > kickoff + 5 * 60_000) return false;
  return kickoff - observed <= maxAgeMinutes * 60_000;
}

function latestTimestamp(values: Array<string | null | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value!)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function availabilityImpact(value: number | null | undefined, status: string | undefined): number {
  if (finite(value)) return clamp(value, 0, 1);
  if (status === "suspended") return 0.65;
  if (status === "injured") return 0.55;
  if (status === "doubtful") return 0.28;
  return 0;
}

function historicalContextSignals(fixture: HistoricalFootballFixtureInput): MatchContextSignal[] {
  const availability = (fixture.availability ?? []).filter((item) =>
    freshTimestamp(item.observedAt, fixture.kickoffAt, 12 * 60) &&
    (item.teamExternalId === fixture.homeTeam.externalId || item.teamExternalId === fixture.awayTeam.externalId)
  );
  const signals: MatchContextSignal[] = [];
  for (const category of ["injury", "suspension"] as const) {
    const items = availability.filter((item) =>
      category === "suspension" ? item.status === "suspended" : item.status === "injured" || item.status === "doubtful"
    );
    if (!items.length) continue;
    const homeItems = items.filter((item) => item.teamExternalId === fixture.homeTeam.externalId);
    const awayItems = items.filter((item) => item.teamExternalId === fixture.awayTeam.externalId);
    const homeImpact = homeItems.reduce((sum, item) => sum + availabilityImpact(item.impactScore, item.status), 0);
    const awayImpact = awayItems.reduce((sum, item) => sum + availabilityImpact(item.impactScore, item.status), 0);
    const delta = homeImpact - awayImpact;
    signals.push({
      id: `${fixture.externalId}-historical-${category}`,
      category,
      label: category === "injury" ? "Historical pre-match availability" : "Historical pre-match suspensions",
      detail: `${fixture.homeTeam.name}: ${homeItems.length} (impact ${homeImpact.toFixed(2)}); ${fixture.awayTeam.name}: ${awayItems.length} (impact ${awayImpact.toFixed(2)}).`,
      quality: items.every((item) => Boolean(item.playerExternalId)) ? "strong" : "acceptable",
      impact: delta > 0 ? "home-negative" : delta < 0 ? "away-negative" : "unknown",
      confidence: category === "suspension" ? 0.76 : 0.72,
      weight: Math.min(category === "suspension" ? 0.024 : 0.026, 0.01 + Math.abs(delta) * 0.008),
      source: "provider-historical-availability",
      publishedAt: latestTimestamp(items.map((item) => item.observedAt)),
      items: items.map((item) => ({
        team: item.teamExternalId === fixture.homeTeam.externalId ? fixture.homeTeam.name : fixture.awayTeam.name,
        player: item.playerName,
        reason: item.reason ?? undefined,
        status: item.status ?? "unknown"
      }))
    });
  }

  const lineups = (fixture.lineups ?? []).filter((item) =>
    freshTimestamp(item.observedAt, fixture.kickoffAt, 2 * 60) &&
    (item.teamExternalId === fixture.homeTeam.externalId || item.teamExternalId === fixture.awayTeam.externalId)
  );
  if (lineups.length) {
    const confirmed = lineups.filter((item) => item.lineupStatus === "confirmed");
    signals.push({
      id: `${fixture.externalId}-historical-lineups`,
      category: "lineup",
      label: confirmed.length >= 2 ? "Historical confirmed lineups" : "Historical partial lineup feed",
      detail: lineups.map((item) => `${item.teamExternalId}: ${item.lineupStatus ?? "unknown"}, ${(item.players ?? []).length} players`).join("; "),
      quality: confirmed.length >= 2 ? "strong" : "acceptable",
      impact: "neutral",
      confidence: confirmed.length >= 2 ? 0.82 : 0.64,
      weight: 0,
      source: "provider-historical-lineups",
      publishedAt: latestTimestamp(lineups.map((item) => item.observedAt))
    });
  }
  return signals;
}

function featureReasons(
  fixture: HistoricalFootballFixtureInput,
  side: "home" | "away",
  minPriorMatches: number
): string[] {
  const team = side === "home" ? fixture.homeTeam : fixture.awayTeam;
  const features = side === "home" ? fixture.homeFeatures : fixture.awayFeatures;
  const proof = chronology(features);
  const reasons: string[] = [];
  if (!cleanText(team.externalId)) reasons.push(`${side} team id missing`);
  if (!cleanText(team.name)) reasons.push(`${side} team name missing`);
  if (!finite(features?.eloRating)) reasons.push(`${side} Elo missing`);
  if (!finite(features?.attackStrength)) reasons.push(`${side} attack strength missing`);
  if (!finite(features?.defenseStrength)) reasons.push(`${side} defense strength missing`);
  if (!finite(features?.recentGoalsFor)) reasons.push(`${side} recent goals for missing`);
  if (!finite(features?.recentGoalsAgainst)) reasons.push(`${side} recent goals against missing`);
  if (proof.version !== CHRONOLOGY_VERSION) reasons.push(`${side} chronology version mismatch`);
  if (proof.featureContractVersion !== FEATURE_CONTRACT_VERSION) reasons.push(`${side} feature contract version mismatch`);
  if (proof.leakageSafe !== true) reasons.push(`${side} chronology is not leakage-safe`);
  if (proof.asOfExclusive !== fixture.kickoffAt) reasons.push(`${side} chronology cutoff mismatch`);
  if (!recentResults(features)) reasons.push(`${side} ordered recent results missing`);
  if (!finite(proof.priorMatches) || proof.priorMatches < minPriorMatches) reasons.push(`${side} history below minimum`);
  return reasons;
}

function prepareFixture(
  fixture: HistoricalFootballFixtureInput,
  config: Required<FootballRuntimeReplayConfig>,
  playerFormSignal: MatchContextSignal | null = null
): PreparedRuntimeFixture | FootballRuntimeReplayRejection {
  const reasons: string[] = [];
  if (fixture.status !== "finished") reasons.push("fixture is not finished");
  if (!finite(fixture.homeScore) || !finite(fixture.awayScore)) reasons.push("finished score missing");
  if (!Number.isFinite(Date.parse(fixture.kickoffAt))) reasons.push("kickoff timestamp invalid");
  if (!cleanText(fixture.league.externalId)) reasons.push("league id missing");
  if (!cleanText(fixture.league.name)) reasons.push("league name missing");
  if (!cleanText(fixture.league.country)) reasons.push("league country missing");
  if (fixture.neutralVenue) reasons.push("neutral venue is unsupported by the runtime Match contract");
  if (!finite(fixture.dataQuality)) reasons.push("data quality missing");
  reasons.push(...featureReasons(fixture, "home", config.minPriorMatches));
  reasons.push(...featureReasons(fixture, "away", config.minPriorMatches));
  if (reasons.length) return { fixtureExternalId: fixture.externalId, reasons: Array.from(new Set(reasons)) };

  const homeFeatures = fixture.homeFeatures!;
  const awayFeatures = fixture.awayFeatures!;
  const homeResults = recentResults(homeFeatures)!;
  const awayResults = recentResults(awayFeatures)!;
  const leagueCountry = cleanText(fixture.league.country);
  const leagueName = cleanText(fixture.league.name);
  const dataQuality = clamp(fixture.dataQuality!, 0, 1);
  const providerContextSignals = [
    ...historicalContextSignals(fixture),
    ...(playerFormSignal ? [playerFormSignal] : [])
  ];
  const match: Match = {
    id: fixture.externalId,
    sport: "football",
    league: {
      id: fixture.league.externalId,
      name: leagueName,
      country: leagueCountry,
      // Exact replay shares the daily provider preprocessing function.
      strength: footballLeagueStrength(leagueCountry, leagueName)
    },
    kickoffTime: fixture.kickoffAt,
    homeTeam: {
      id: fixture.homeTeam.externalId,
      name: fixture.homeTeam.name,
      rating: footballModelRatingFromElo(homeFeatures.eloRating!),
      ratingEvidence: {
        source: "leakage-safe historical chronology",
        rawRating: homeFeatures.eloRating,
        sampleSize: Number(chronology(homeFeatures).priorMatches),
        asOf: fixture.kickoffAt,
        attackStrength: homeFeatures.attackStrength,
        defenseStrength: homeFeatures.defenseStrength,
        recentFormPoints: homeFeatures.recentFormPoints ?? null,
        restDays: homeFeatures.restDays ?? null
      }
    },
    awayTeam: {
      id: fixture.awayTeam.externalId,
      name: fixture.awayTeam.name,
      rating: footballModelRatingFromElo(awayFeatures.eloRating!),
      ratingEvidence: {
        source: "leakage-safe historical chronology",
        rawRating: awayFeatures.eloRating,
        sampleSize: Number(chronology(awayFeatures).priorMatches),
        asOf: fixture.kickoffAt,
        attackStrength: awayFeatures.attackStrength,
        defenseStrength: awayFeatures.defenseStrength,
        recentFormPoints: awayFeatures.recentFormPoints ?? null,
        restDays: awayFeatures.restDays ?? null
      }
    },
    status: "scheduled",
    oddsMarkets: [],
    homeForm: {
      teamId: fixture.homeTeam.externalId,
      recentResults: homeResults,
      goalsFor: homeFeatures.recentGoalsFor!,
      goalsAgainst: homeFeatures.recentGoalsAgainst!,
      xgFor: homeFeatures.xgFor ?? null,
      xgAgainst: homeFeatures.xgAgainst ?? null,
      attackStrength: homeFeatures.attackStrength!,
      defenseStrength: homeFeatures.defenseStrength!
    },
    awayForm: {
      teamId: fixture.awayTeam.externalId,
      recentResults: awayResults,
      goalsFor: awayFeatures.recentGoalsFor!,
      goalsAgainst: awayFeatures.recentGoalsAgainst!,
      xgFor: awayFeatures.xgFor ?? null,
      xgAgainst: awayFeatures.xgAgainst ?? null,
      attackStrength: awayFeatures.attackStrength!,
      defenseStrength: awayFeatures.defenseStrength!
    },
    dataQualityScore: dataQuality,
    providerContextSignals,
    dataSource: {
      kind: "provider",
      fixtureProvider: cleanText(fixture.metadata?.provider) || "historical-corpus",
      fixtureProviderId: fixture.externalId,
      season: cleanText(fixture.season) || undefined,
      round: cleanText(fixture.round) || undefined,
      fetchedAt: fixture.kickoffAt,
      notes: ["Historical replay input; current outcome withheld from the runtime model."]
    }
  };

  const evaluationFixture: HistoricalFootballFixture = {
    fixtureExternalId: fixture.externalId,
    kickoffAt: fixture.kickoffAt,
    leagueExternalId: fixture.league.externalId,
    season: fixture.season,
    homeTeamExternalId: fixture.homeTeam.externalId,
    awayTeamExternalId: fixture.awayTeam.externalId,
    homeScore: fixture.homeScore!,
    awayScore: fixture.awayScore!,
    neutralVenue: Boolean(fixture.neutralVenue),
    dataQuality,
    odds: (fixture.odds ?? []).map((quote) => ({
      market: quote.market,
      selection: quote.selection,
      decimalOdds: quote.decimalOdds,
      isClosing: quote.isClosing,
      observedAt: quote.observedAt ?? undefined,
      bookmaker: quote.bookmaker ?? undefined
    }))
  };
  return { source: fixture, match, evaluationFixture };
}

function rejectionCounts(rejections: FootballRuntimeReplayRejection[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rejection of rejections) {
    for (const reason of rejection.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function runtimeNotes(
  contract: FootballRuntimeFeatureContract,
  summary: ReturnType<typeof summarizeFootballEvaluation>,
  weightProvenance: FootballLearnedWeightsProvenance
): string[] {
  return [
    `Executed ${contract.entrypointInvocations} holdout fixture(s) through the football runtime model and residual context adjustment with ${contract.version}.`,
    weightProvenance.source === "training-window"
      ? `Learned decision weights use only ${contract.trainingEvaluatedFixtures} chronological training fixture(s); holdout outcomes remain evaluation-only.`
      : "Learned decision weights use conservative defaults because no chronological training fixture was available.",
    contract.rejectedFixtures
      ? `${contract.rejectedFixtures} source fixture(s) were excluded by the fail-closed runtime feature contract.`
      : "Every source fixture satisfied the runtime feature contract.",
    contract.duplicateSourceFixturesCollapsed
      ? `${contract.duplicateSourceFixturesCollapsed} duplicate provider fixture record(s) across ${contract.duplicateFixtureGroups} real match group(s) were consolidated before chronology.`
      : "No cross-provider duplicate fixture records were detected.",
    contract.conflictingDuplicateGroups
      ? `${contract.conflictingDuplicateGroups} duplicate match group(s) were rejected because providers disagreed on the final score.`
      : "No duplicate provider records disagreed on final scores.",
    contract.optionalCoverage.xgFixtures === 0
      ? "Historical team-form xG is unavailable; the exact runtime entrypoint used its deterministic xG fallback."
      : `${contract.optionalCoverage.xgFixtures} eligible fixture(s) included historical team-form xG.`,
    contract.optionalCoverage.contextSignalFixtures === 0
      ? "No timestamped historical provider-context signals were attached; the runtime entrypoint used its deterministic context fallback."
      : `${contract.optionalCoverage.contextSignalFixtures} eligible fixture(s) included timestamped provider context.`,
    contract.optionalCoverage.playerFormReadyFixtures === 0
      ? "No leakage-safe historical player-form signals were available; player performance had zero influence on this replay."
      : `${contract.optionalCoverage.playerFormReadyFixtures}/${contract.optionalCoverage.playerFormEligibleFixtures} player-capable fixture(s) included acceptable or strong leakage-safe player-form evidence.`,
    summary.pickCount === 0 ? "No holdout picks cleared the configured value threshold." : ""
  ].filter(Boolean);
}

export function runFootballRuntimeReplay(
  fixtures: readonly HistoricalFootballFixtureInput[],
  inputConfig: FootballRuntimeReplayConfig = {},
  { playerPerformances = [] }: { playerPerformances?: readonly PlayerMatchPerformance[] } = {}
): FootballRuntimeReplayResult {
  const config = resolvedConfig(inputConfig);
  const consolidation = consolidateFootballRuntimeFixtures(fixtures);
  // Stored strength/form fields without chronology proof are intentionally discarded.
  const chronologyInputs = consolidation.fixtures.map((fixture) => ({
    ...fixture,
    homeFeatures: undefined,
    awayFeatures: undefined
  }));
  const derived = deriveFootballChronologyFeatures(chronologyInputs);
  const performancesByTeam = new Map<string, PlayerMatchPerformance[]>();
  for (const performance of playerPerformances) {
    const current = performancesByTeam.get(performance.teamExternalId) ?? [];
    current.push(performance);
    performancesByTeam.set(performance.teamExternalId, current);
  }
  const prepared: PreparedRuntimeFixture[] = [];
  const rejections: FootballRuntimeReplayRejection[] = consolidation.conflicts.flatMap((conflict) =>
    conflict.fixtureExternalIds.map((fixtureExternalId) => ({ fixtureExternalId, reasons: [conflict.reason] }))
  );
  for (const fixture of derived) {
    const playerFormSignal = buildPlayerFormSignal({
      fixtureExternalId: fixture.externalId,
      kickoffAt: fixture.kickoffAt,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam
    }, [
      ...(performancesByTeam.get(fixture.homeTeam.externalId) ?? []),
      ...(performancesByTeam.get(fixture.awayTeam.externalId) ?? [])
    ]);
    const result = prepareFixture(fixture, config, playerFormSignal);
    if ("reasons" in result) rejections.push(result);
    else prepared.push(result);
  }

  prepared.sort((left, right) => Date.parse(left.source.kickoffAt) - Date.parse(right.source.kickoffAt));
  const trainSize = prepared.length
    ? Math.min(prepared.length - 1, Math.max(0, Math.floor(prepared.length * config.trainRatio)))
    : 0;
  const training = prepared.slice(0, trainSize);
  const holdout = prepared.slice(trainSize);
  const overallPlayerCoverage = playerCoverage(prepared);
  const trainingPlayerCoverage = playerCoverage(training);
  const holdoutPlayerCoverage = playerCoverage(holdout);
  const evaluationConfig = resolveFootballBacktestConfig({
    trainRatio: config.trainRatio,
    minEdge: config.minEdge,
    minModelProbability: config.minModelProbability
  });
  const evaluatePreparedFixture = (
    fixture: PreparedRuntimeFixture,
    phase: "training" | "holdout",
    selectionConfig: ReturnType<typeof resolveFootballBacktestConfig>
  ): FootballBacktestFixtureResult | null => {
    const historicalClock = new Date(fixture.source.kickoffAt);
    const modeled = modelFootballMatch(fixture.match, { now: historicalClock });
    const contextAdjustment = buildMatchContextAdjustment(fixture.match, {
      probabilityHandledCategories: coreModelContextCategories(fixture.match),
      now: historicalClock
    });
    const runtimeMarkets = applyContextAdjustmentToMarkets(modeled.markets, contextAdjustment);
    const market = runtimeMarkets.find((item) => item.marketId === "match_winner");
    const probabilities = market?.probabilities as Record<FootballOutcome, number> | undefined;
    if (!probabilities || !finite(probabilities.home) || !finite(probabilities.draw) || !finite(probabilities.away)) {
      rejections.push({ fixtureExternalId: fixture.source.externalId, reasons: [`${phase} runtime match-winner output invalid`] });
      return null;
    }
    return evaluateFootballPrediction({
      fixture: fixture.evaluationFixture,
      probabilities,
      expectedGoals: modeled.diagnostics.expectedGoals,
      config: selectionConfig
    });
  };

  const trainingResults: FootballBacktestFixtureResult[] = [];
  let trainingEntrypointInvocations = 0;
  for (const fixture of training) {
    trainingEntrypointInvocations += 1;
    const evaluation = evaluatePreparedFixture(fixture, "training", evaluationConfig);
    if (evaluation) trainingResults.push(evaluation);
  }

  const trainingSummary = summarizeFootballEvaluation(trainingResults);
  const learnedWeights = footballDecisionLearnedWeights({
    pickCount: trainingSummary.pickCount,
    yield: trainingSummary.yield,
    brierScore: trainingSummary.brierScore,
    closingLineValue: trainingSummary.closingLineValue,
    config
  });
  const holdoutEvaluationConfig = {
    ...evaluationConfig,
    minEdge: learnedWeights.minimumEdge
  };

  const results: FootballBacktestFixtureResult[] = [];
  let entrypointInvocations = 0;
  for (const fixture of holdout) {
    entrypointInvocations += 1;
    const evaluation = evaluatePreparedFixture(fixture, "holdout", holdoutEvaluationConfig);
    if (evaluation) results.push(evaluation);
  }

  const summary = summarizeFootballEvaluation(results);
  const weightProvenance = buildFootballLearnedWeightsProvenance(
    trainingResults,
    trainingSummary,
    results[0]?.kickoffAt ?? null
  );
  const contract: FootballRuntimeFeatureContract = {
    status:
      results.length > 0 &&
      results.length === entrypointInvocations &&
      trainingResults.length === trainingEntrypointInvocations
        ? "passed"
        : "failed",
    version: FEATURE_CONTRACT_VERSION,
    chronologyVersion: CHRONOLOGY_VERSION,
    sourceFixtures: fixtures.length,
    duplicateFixtureGroups: consolidation.duplicateGroups,
    duplicateSourceFixturesCollapsed: consolidation.duplicateSourceFixturesCollapsed,
    conflictingDuplicateGroups: consolidation.conflicts.length,
    eligibleFixtures: prepared.length,
    rejectedFixtures: rejections.length,
    trainingEvaluatedFixtures: trainingResults.length,
    trainingEntrypointInvocations,
    evaluatedFixtures: results.length,
    entrypointInvocations,
    optionalCoverage: {
      xgFixtures: prepared.filter((fixture) =>
        finite(fixture.match.homeForm.xgFor) && finite(fixture.match.homeForm.xgAgainst) &&
        finite(fixture.match.awayForm.xgFor) && finite(fixture.match.awayForm.xgAgainst)
      ).length,
      contextSignalFixtures: prepared.filter((fixture) => (fixture.match.providerContextSignals?.length ?? 0) > 0).length,
      playerFormFixtures: prepared.filter(hasPlayerFormSignal).length,
      playerFormEligibleFixtures: overallPlayerCoverage.eligible,
      playerFormReadyFixtures: overallPlayerCoverage.ready,
      playerFormTrainingEligibleFixtures: trainingPlayerCoverage.eligible,
      playerFormTrainingReadyFixtures: trainingPlayerCoverage.ready,
      playerFormHoldoutEligibleFixtures: holdoutPlayerCoverage.eligible,
      playerFormHoldoutReadyFixtures: holdoutPlayerCoverage.ready,
      completeOddsFixtures: prepared.filter((fixture) => completeWinnerOdds(fixture.source)).length
    },
    rejectionReasons: rejectionCounts(rejections)
  };
  const windowStart = prepared[0]?.source.kickoffAt ?? null;
  const windowEnd = prepared.at(-1)?.source.kickoffAt ?? null;
  const executionHash = stableHash({
    modelKey: RUNTIME_MODEL_KEY,
    entrypoint: "modelFootballMatch+buildMatchContextAdjustment",
    contract,
    fixtureIds: results.map((result) => result.fixtureExternalId),
    probabilityVectors: results.map((result) => result.probabilities),
    trainingProbabilityVectors: trainingResults.map((result) => result.probabilities),
    holdoutSelectionPolicy: {
      source: "chronological-training-window",
      minimumEdge: holdoutEvaluationConfig.minEdge,
      minimumModelProbability: holdoutEvaluationConfig.minModelProbability
    },
    learnedWeightsProvenance: weightProvenance
  });

  return {
    sport: "football",
    modelKey: RUNTIME_MODEL_KEY,
    engineVersion: DECISION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    status: contract.status === "passed" ? "completed" : "no-data",
    sampleSize: prepared.length,
    trainSize,
    testSize: results.length,
    pickCount: summary.pickCount,
    windowStart,
    windowEnd,
    trainWindowStart: windowStart,
    trainWindowEnd: prepared[Math.max(0, trainSize - 1)]?.source.kickoffAt ?? null,
    testWindowStart: prepared[trainSize]?.source.kickoffAt ?? null,
    testWindowEnd: results.at(-1)?.kickoffAt ?? null,
    brierScore: summary.brierScore,
    logLoss: summary.logLoss,
    roiUnits: summary.roiUnits,
    yield: summary.yield,
    averageEdge: summary.averageEdge,
    closingLineValue: summary.closingLineValue,
    calibrationError: summary.calibrationError,
    calibrationBuckets: summary.calibrationBuckets,
    marketBreakdown: summary.marketBreakdown,
    confidenceBreakdown: summary.confidenceBreakdown,
    oddsCoverage: summary.oddsCoverage,
    learnedWeights,
    learnedWeightsProvenance: weightProvenance,
    config,
    notes: [
      ...runtimeNotes(contract, summary, weightProvenance),
      `Holdout selection used the training-derived minimum edge ${holdoutEvaluationConfig.minEdge.toFixed(4)}; holdout outcomes could not tune it.`
    ],
    results,
    featureContract: contract,
    executionHash,
    rejections
  };
}
