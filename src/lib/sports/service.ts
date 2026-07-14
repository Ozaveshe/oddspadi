import { providerBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import type { BestPickResult, DecisionCaseMemoryBank, DecisionLearningProfile, Match, Prediction, Sport } from "@/lib/sports/types";
import {
  applyMarketPriorAdjustmentToDiagnostics,
  applyMarketPriorAdjustmentToMarkets,
  buildValueEdges,
  selectBestPick,
  type MarketPriorEvidencePolicy
} from "./prediction/odds";
import { modelBasketballMatch } from "./prediction/basketballModel";
import { modelFootballMatch } from "./prediction/footballModel";
import { modelTennisMatch } from "./prediction/tennisModel";
import { explainPrediction } from "./prediction/explainer";
import { confidenceRank } from "./prediction/format";
import { buildPredictionAgentReport } from "./prediction/agent";
import { applyContextAdjustmentToDiagnostics, applyContextAdjustmentToMarkets, buildMatchContextAdjustment, coreModelContextCategories } from "./prediction/contextAdjustment";
import { buildDecisionEngineReport, DECISION_ENGINE_VERSION } from "./prediction/decisionEngine";
import { getDecisionLearningProfile } from "./prediction/decisionLearningProfile";
import { getDecisionCaseMemoryBank } from "./prediction/decisionMemory";
import {
  applyLearnedProbabilityCalibration,
  applyLearnedProbabilityCalibrationToDiagnostics
} from "./prediction/learnedProbabilityCalibration";
import { buildDecisionSupervisorQueue } from "./prediction/decisionSupervisor";
import { buildFootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import { buildPublicHistoricalTrainingEvidence, type PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import { isRequiredProductionDataSignalBlocked } from "./prediction/contextSignalPolicy";
import { leagueSlugFromProviderId } from "./leagueStandings";
import {
  bestPickFromCanonicalDecision,
  buildCanonicalDecision,
  oddsSnapshotsFromMatch
} from "./prediction/canonicalDecision";
import { readFixtureOddsHistory, readLatestDecisionSummary } from "./intelligence/repository";
import type { DecisionProbabilityRuntimeStages } from "./prediction/decisionProbabilityTrace";
import {
  buildPredictionEvidenceHash,
  resolveCanonicalDecisionForMatchDetail
} from "./prediction/decisionSnapshotIdentity";

export const sports: Array<{ id: Sport; label: string; active: boolean }> = [
  { id: "football", label: "Football", active: true },
  { id: "basketball", label: "Basketball", active: true },
  { id: "tennis", label: "Tennis", active: true },
  { id: "cricket", label: "Cricket", active: false },
  { id: "rugby", label: "Rugby", active: false },
  { id: "handball", label: "Handball", active: false }
];

export const sportsProvider = providerBackedSportsDataProvider;

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isSupportedSport(value: string | null | undefined): value is Sport {
  return sports.some((sport) => sport.id === value);
}

export type LearningProfileSport = Extract<Sport, "football" | "basketball" | "tennis">;

export function isLearningProfileSport(sport: Sport): sport is LearningProfileSport {
  return sport === "football" || sport === "basketball" || sport === "tennis";
}

export function buildUnavailableLearningProfile(sport: LearningProfileSport, reason: string): DecisionLearningProfile {
  return {
    status: "failed",
    source: null,
    active: false,
    modelCompatibility: "missing",
    sampleSize: 0,
    testSize: 0,
    realFinishedFixtures: 0,
    minimumRecommendedFixtures: 1000,
    minimumEdge: null,
    valueEdgeWeight: null,
    dataQualityWeight: null,
    marketAdjustmentWeight: null,
    homeAdvantageElo: null,
    brierScore: null,
    logLoss: null,
    calibrationError: null,
    yield: null,
    closingLineValue: null,
    playerFormFixtures: null,
    playerFormCoverage: null,
    minimumPlayerFormCoverage: sport === "football" ? 0.6 : null,
    calibrationBuckets: [],
    generatedAt: new Date().toISOString(),
    reason: `Could not read ${sport} learning profile: ${reason}`,
    notes: ["Learned guardrails remain inactive until the sport-specific training profile can be read."]
  };
}

export function buildUnavailableCaseMemoryBank(reason: string): DecisionCaseMemoryBank {
  return {
    generatedAt: new Date().toISOString(),
    status: "failed",
    configured: true,
    projectRef: null,
    runs: [],
    reason: `Could not read decision case memory: ${reason}`
  };
}

async function getLearningProfileForSport(sport: Sport): Promise<DecisionLearningProfile | undefined> {
  if (!isLearningProfileSport(sport)) return undefined;
  return getDecisionLearningProfile(sport).catch((error: unknown) =>
    buildUnavailableLearningProfile(sport, error instanceof Error ? error.message : "unknown error")
  );
}

function modelMatch(match: Match) {
  if (match.sport === "basketball") return modelBasketballMatch(match);
  if (match.sport === "tennis") return modelTennisMatch(match);
  return modelFootballMatch(match);
}

/** Never let promoted thresholds or weights cross the model/engine boundary they were validated against. */
export function scopeLearningProfileToRuntime(
  profile: DecisionLearningProfile | undefined,
  modelKey: string,
  engineVersion: string
): DecisionLearningProfile | undefined {
  if (!profile?.active) return profile;
  const modelMatches = profile.modelKey === modelKey;
  const engineMatches = profile.engineVersion === engineVersion;
  if (modelMatches && engineMatches) return profile;

  const mismatches = [
    modelMatches ? null : `model ${profile.modelKey ?? "unversioned"} does not match runtime ${modelKey}`,
    engineMatches ? null : `engine ${profile.engineVersion ?? "unversioned"} does not match runtime ${engineVersion}`
  ].filter((value): value is string => Boolean(value));
  return {
    ...profile,
    status: "shadow-only",
    active: false,
    reason: `Promoted learning profile is incompatible with this runtime: ${mismatches.join("; ")}.`,
    notes: [...profile.notes, "Learned probability calibration, edge thresholds, and factor weights are disabled for this prediction."]
  };
}

export function decisionAllowsPublicPick(decision: Prediction["decision"]): boolean {
  const hasRequiredCoreFeatureBlocker = decision.dataCoverage.signals.some(
    isRequiredProductionDataSignalBlocked
  );

  return (
    decision.action === "consider" &&
    decision.calibration.action !== "abstain" &&
    decision.actionability.status === "actionable" &&
    !decision.abstentionRules.some((rule) => rule.triggered) &&
    !hasRequiredCoreFeatureBlocker
  );
}

function footballMarketPriorEvidencePolicy(match: Match): MarketPriorEvidencePolicy | undefined {
  if (match.sport !== "football" || match.dataSource?.kind !== "provider" || !match.dataSource.oddsProvider) return undefined;

  const evidence = [match.homeTeam.ratingEvidence, match.awayTeam.ratingEvidence];
  const sampleSizes = evidence.map((item) =>
    typeof item?.sampleSize === "number" && Number.isFinite(item.sampleSize) ? Math.max(0, Math.trunc(item.sampleSize)) : 0
  );
  const minimumSample = Math.min(...sampleSizes);
  const sources = evidence.map((item) => item?.source ?? "missing-team-history");
  const bothHistoricalElo = sources.every((source) => source.includes("historical-elo"));

  if (bothHistoricalElo && minimumSample >= 20) return undefined;
  if (minimumSample === 0) {
    return {
      minimumWeight: 0.9,
      reason: `one or both teams have no measured historical-strength sample (${sources.join(" vs ")})`
    };
  }
  if (minimumSample < 5) {
    return {
      minimumWeight: 0.88,
      reason: `the smaller team-strength sample contains only ${minimumSample} matches, so short-window form cannot dominate a coherent market`
    };
  }
  if (minimumSample < 10) {
    return {
      minimumWeight: 0.75,
      reason: `the smaller team-strength sample contains only ${minimumSample} matches`
    };
  }
  return {
    minimumWeight: 0.6,
    reason: `team strength is not yet supported by at least 20 historical Elo matches per team (${minimumSample} minimum)`
  };
}

export function buildPrediction(
  match: Match,
  {
    learningProfile,
    caseMemoryBank,
    publicHistoricalTrainingEvidence
  }: {
    learningProfile?: DecisionLearningProfile;
    caseMemoryBank?: DecisionCaseMemoryBank;
    publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  } = {}
): Prediction {
  const baseModel = modelMatch(match);
  const runtimeLearningProfile = scopeLearningProfileToRuntime(
    learningProfile,
    baseModel.diagnostics.modelVersion,
    DECISION_ENGINE_VERSION
  );
  const contextAdjustment = buildMatchContextAdjustment(match, {
    probabilityHandledCategories: coreModelContextCategories(match)
  });
  const contextMarkets = applyContextAdjustmentToMarkets(baseModel.markets, contextAdjustment);
  const contextDiagnostics = applyContextAdjustmentToDiagnostics(baseModel.diagnostics, contextAdjustment);
  const learnedCalibration = applyLearnedProbabilityCalibration({
    markets: contextMarkets,
    profile: runtimeLearningProfile,
    modelKey: baseModel.diagnostics.modelVersion,
    engineVersion: DECISION_ENGINE_VERSION
  });
  const learnedCalibrationDiagnostics = applyLearnedProbabilityCalibrationToDiagnostics({
    diagnostics: contextDiagnostics,
    adjustment: learnedCalibration.adjustment
  });
  const marketPriorEvidencePolicy = footballMarketPriorEvidencePolicy(match);
  const marketPrior = applyMarketPriorAdjustmentToMarkets(
    learnedCalibration.markets,
    match.oddsMarkets,
    learnedCalibrationDiagnostics.dataQualityScore,
    marketPriorEvidencePolicy
  );
  const markets = marketPrior.markets;
  const diagnostics = applyMarketPriorAdjustmentToDiagnostics(learnedCalibrationDiagnostics, marketPrior.adjustment);
  const valueEdges = buildValueEdges(markets, match.oddsMarkets, diagnostics.dataQualityScore);
  const candidatePick = selectBestPick(valueEdges, { learningProfile: runtimeLearningProfile, caseMemoryBank });
  const selectedStageProbability = (stageMarkets: typeof markets): number | null => {
    if (!candidatePick.hasValue) return null;
    const probability = stageMarkets.find((market) => market.marketId === candidatePick.marketId)?.probabilities[candidatePick.selectionId];
    return typeof probability === "number" && Number.isFinite(probability) ? probability : null;
  };
  const probabilityStages: DecisionProbabilityRuntimeStages = {
    rawModelProbability: selectedStageProbability(baseModel.markets),
    contextAdjustedProbability: selectedStageProbability(contextMarkets),
    learnedCalibratedProbability: selectedStageProbability(learnedCalibration.markets),
    finalModelProbability: selectedStageProbability(markets)
  };
  const decision = buildDecisionEngineReport({
    match,
    markets,
    diagnostics,
    probabilityCalibration: learnedCalibration.adjustment,
    bestPick: candidatePick,
    valueEdges,
    learningProfile: runtimeLearningProfile,
    caseMemoryBank,
    contextAdjustment,
    marketPriorAdjustment: marketPrior.adjustment,
    probabilityStages,
    publicHistoricalTrainingEvidence
  });
  const evidenceHash = buildPredictionEvidenceHash({
    match,
    prediction: {
      markets,
      diagnostics,
      calibrationAdjustment: learnedCalibration.adjustment,
      contextAdjustment,
      marketPriorAdjustment: marketPrior.adjustment,
      valueEdges,
      decision
    }
  });
  const generatedAt = new Date().toISOString();
  const canonicalDecision = buildCanonicalDecision(
    match,
    oddsSnapshotsFromMatch(match, new Date(generatedAt)),
    {
      valueEdges,
      diagnostics,
      decision,
      generatedAt,
      evidenceHash,
      modelVersion: diagnostics.modelVersion,
      engineVersion: decision.engineVersion
    },
    match.providerContextSignals ?? [],
    { now: new Date(generatedAt), allowMockFixtures: process.env.NODE_ENV !== "production" }
  );
  const bestPick: BestPickResult = bestPickFromCanonicalDecision(canonicalDecision);
  const selectedEdge = bestPick.hasValue ? bestPick : undefined;
  const explanation = explainPrediction(match, markets, selectedEdge);
  const agentReport = buildPredictionAgentReport(match, diagnostics, bestPick, valueEdges);

  return {
    matchId: match.id,
    sport: match.sport,
    generatedAt,
    evidenceHash,
    markets,
    diagnostics,
    calibrationAdjustment: learnedCalibration.adjustment,
    contextAdjustment,
    marketPriorAdjustment: marketPrior.adjustment,
    valueEdges,
    canonicalDecision,
    bestPick,
    confidence: canonicalDecision.confidence,
    risk: canonicalDecision.risk,
    explanation,
    agentReport,
    decision
  };
}

export type PredictionFilters = {
  date?: string;
  sport?: Sport;
  league?: string;
  country?: string;
  confidence?: string;
  query?: string;
  providerMode?: "live" | "preview";
  storageMode?: "live" | "preview";
  publicHistory?: boolean;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
};

async function getPublicHistoricalTrainingEvidenceForPredictions(filters: PredictionFilters): Promise<PublicHistoricalTrainingEvidence | null> {
  if (filters.publicHistoricalTrainingEvidence !== undefined) return filters.publicHistoricalTrainingEvidence;
  if (!filters.publicHistory || filters.sport !== "football") return null;
  const dossier = await buildFootballDataHistoricalLearningDossier({
    seasonFrom: 2016,
    seasonTo: 2025,
    maxSeasons: 10,
    trainRatio: 0.7,
    minEdge: 0.02,
    minModelProbability: 0.36,
    minPickCount: 75,
    minTrainingSeasons: 3
  });
  return buildPublicHistoricalTrainingEvidence({ dossier });
}

export async function getPredictions(filters: PredictionFilters = {}) {
  const date = filters.date ?? todayIsoDate();
  const sport = filters.sport ?? "football";
  const fixtureProvider = filters.providerMode === "preview" ? mockSportsDataProvider : sportsProvider;
  const storageReadsEnabled = filters.storageMode !== "preview";
  const [learningProfile, caseMemoryBank, matches, publicHistoricalTrainingEvidence] = await Promise.all([
    storageReadsEnabled ? getLearningProfileForSport(sport) : Promise.resolve(undefined),
    storageReadsEnabled
      ? getDecisionCaseMemoryBank({ sport }).catch((error: unknown) =>
          buildUnavailableCaseMemoryBank(error instanceof Error ? error.message : "unknown error")
        )
      : Promise.resolve(undefined),
    fixtureProvider.getFixtures(date, sport),
    getPublicHistoricalTrainingEvidenceForPredictions({ ...filters, sport })
  ]);
  const visibleMatches = filters.providerMode === "live" ? matches.filter((match) => match.dataSource?.kind === "provider") : matches;
  const rows = visibleMatches.map((match) => ({
    match,
    prediction: buildPrediction(match, { learningProfile, caseMemoryBank, publicHistoricalTrainingEvidence })
  }));

  const filteredRows = rows.filter(({ match, prediction }) => {
    const query = filters.query?.trim().toLowerCase();
    const matchesSearch =
      !query ||
      match.homeTeam.name.toLowerCase().includes(query) ||
      match.awayTeam.name.toLowerCase().includes(query) ||
      match.league.name.toLowerCase().includes(query);

    return (
      (!filters.league || match.league.name === filters.league) &&
      (!filters.country || match.league.country === filters.country) &&
      (!filters.confidence || prediction.confidence === filters.confidence) &&
      matchesSearch
    );
  });

  const wantsEpl =
    sport === "football" &&
    (filters.league === "English Premier League" || filters.league === "Premier League") &&
    (!filters.country || filters.country === "England");
  if (!filteredRows.length && wantsEpl && fixtureProvider !== mockSportsDataProvider && filters.providerMode !== "live") {
    const seededMatches = await mockSportsDataProvider.getFixtures(date, sport);
    return seededMatches
      .map((match) => ({
        match,
        prediction: buildPrediction(match, { learningProfile, caseMemoryBank, publicHistoricalTrainingEvidence })
      }))
      .filter(({ match, prediction }) => {
        const query = filters.query?.trim().toLowerCase();
        const matchesSearch =
          !query ||
          match.homeTeam.name.toLowerCase().includes(query) ||
          match.awayTeam.name.toLowerCase().includes(query) ||
          match.league.name.toLowerCase().includes(query);
        return (
          (match.league.name === "English Premier League" || match.league.name === "Premier League") &&
          (!filters.confidence || prediction.confidence === filters.confidence) &&
          matchesSearch
        );
      });
  }

  return filteredRows;
}

export async function getMatchPrediction(matchId: string) {
  const match = await sportsProvider.getMatch(matchId);
  if (!match) return null;
  if (match.sport === "football") match.headToHead = (await sportsProvider.getFootballHeadToHead(match)) ?? undefined;
  if (match.sport === "football") { const slug = leagueSlugFromProviderId(match.league.id); if (slug) match.leagueTable = (await sportsProvider.getFootballLeagueTable(slug)) ?? undefined; }
  const [learningProfile, caseMemoryBank, storedSummary, oddsHistory] = await Promise.all([
    getLearningProfileForSport(match.sport),
    getDecisionCaseMemoryBank({ sport: match.sport }).catch((error: unknown) =>
      buildUnavailableCaseMemoryBank(error instanceof Error ? error.message : "unknown error")
    ),
    readLatestDecisionSummary(match.id).catch(() => null),
    readFixtureOddsHistory(match.id)
  ]);
  const freshPrediction = buildPrediction(match, { learningProfile, caseMemoryBank });
  const canonicalDecision = resolveCanonicalDecisionForMatchDetail({ freshPrediction, storedSummary });
  return {
    match,
    oddsHistory,
    prediction: {
      ...freshPrediction,
      canonicalDecision,
      bestPick: bestPickFromCanonicalDecision(canonicalDecision),
      confidence: canonicalDecision.confidence,
      risk: canonicalDecision.risk
    }
  };
}

export async function getDecisionSupervisorQueue(filters: PredictionFilters = {}) {
  const date = filters.date ?? todayIsoDate();
  const sport = filters.sport ?? "football";
  const rows = await getPredictions({ ...filters, date, sport });
  return buildDecisionSupervisorQueue({ rows, date, sport });
}

export async function getValuePicks(
  date = todayIsoDate(),
  sport: Sport = "football",
  providerMode?: PredictionFilters["providerMode"],
  storageMode?: PredictionFilters["storageMode"]
) {
  const rows = await getPredictions({
    date,
    sport,
    ...(providerMode ? { providerMode } : {}),
    ...(storageMode ? { storageMode } : {})
  });

  return rows
    .filter(
      ({ prediction }) =>
        prediction.canonicalDecision.publicStatus === "value_pick" &&
        prediction.canonicalDecision.bestPublishedPick !== null
    )
    .sort((a, b) => {
      const evDiff =
        (b.prediction.canonicalDecision.bestPublishedPick?.expectedValue ?? 0) -
        (a.prediction.canonicalDecision.bestPublishedPick?.expectedValue ?? 0);
      if (evDiff !== 0) return evDiff;
      const edgeDiff =
        (b.prediction.canonicalDecision.bestPublishedPick?.edge ?? 0) -
        (a.prediction.canonicalDecision.bestPublishedPick?.edge ?? 0);
      if (edgeDiff !== 0) return edgeDiff;
      const confidenceDiff = confidenceRank(b.prediction.confidence) - confidenceRank(a.prediction.confidence);
      if (confidenceDiff !== 0) return confidenceDiff;
      return safeKickoffMs(a.match.kickoffTime) - safeKickoffMs(b.match.kickoffTime);
    });
}

/** NaN from an invalid kickoff makes Array.sort's comparator inconsistent
 *  (order becomes engine-dependent); park unparseable dates at the end. */
function safeKickoffMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

export async function getLiveScores(date = todayIsoDate(), sport: Sport = "football") {
  return sportsProvider.getLiveScores(date, sport);
}

export function uniqueLeagues(matches: Match[]) {
  return Array.from(new Set(matches.map((match) => match.league.name))).sort();
}

export function uniqueCountries(matches: Match[]) {
  return Array.from(new Set(matches.map((match) => match.league.country))).sort();
}
