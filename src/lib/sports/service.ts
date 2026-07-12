import { providerBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import type { BestPickResult, DecisionCaseMemoryBank, DecisionLearningProfile, Match, Prediction, Sport } from "@/lib/sports/types";
import { applyMarketPriorAdjustmentToDiagnostics, applyMarketPriorAdjustmentToMarkets, buildValueEdges, selectBestPick } from "./prediction/odds";
import { modelBasketballMatch } from "./prediction/basketballModel";
import { modelFootballMatch } from "./prediction/footballModel";
import { modelTennisMatch } from "./prediction/tennisModel";
import { explainPrediction } from "./prediction/explainer";
import { confidenceRank } from "./prediction/format";
import { predictionHistory } from "./prediction/history";
import { buildPredictionAgentReport } from "./prediction/agent";
import { applyContextAdjustmentToDiagnostics, applyContextAdjustmentToMarkets, buildMatchContextAdjustment } from "./prediction/contextAdjustment";
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
    sampleSize: 0,
    realFinishedFixtures: 0,
    minimumRecommendedFixtures: 1000,
    minimumEdge: null,
    valueEdgeWeight: null,
    dataQualityWeight: null,
    marketAdjustmentWeight: null,
    homeAdvantageElo: null,
    brierScore: null,
    yield: null,
    closingLineValue: null,
    calibrationBuckets: [],
    generatedAt: new Date().toISOString(),
    reason: `Could not read ${sport} learning profile: ${reason}`,
    notes: ["Learned guardrails remain inactive until the sport-specific training profile can be read."]
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

function coreModelContextCategories(match: Match): Array<NonNullable<Match["providerContextSignals"]>[number]["category"]> {
  if (!match.providerContextSignals?.length) return [];
  if (match.sport === "basketball") return ["rest", "injury", "suspension", "lineup", "news"];
  if (match.sport === "tennis") return ["surface", "injury", "news", "rest"];
  return ["injury", "suspension", "lineup", "weather", "news"];
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
  const contextAdjustment = buildMatchContextAdjustment(match, {
    probabilityHandledCategories: coreModelContextCategories(match)
  });
  const contextMarkets = applyContextAdjustmentToMarkets(baseModel.markets, contextAdjustment);
  const contextDiagnostics = applyContextAdjustmentToDiagnostics(baseModel.diagnostics, contextAdjustment);
  const learnedCalibration = applyLearnedProbabilityCalibration({
    markets: contextMarkets,
    profile: learningProfile,
    modelKey: baseModel.diagnostics.modelVersion,
    engineVersion: DECISION_ENGINE_VERSION
  });
  const learnedCalibrationDiagnostics = applyLearnedProbabilityCalibrationToDiagnostics({
    diagnostics: contextDiagnostics,
    adjustment: learnedCalibration.adjustment
  });
  const marketPrior = applyMarketPriorAdjustmentToMarkets(
    learnedCalibration.markets,
    match.oddsMarkets,
    learnedCalibrationDiagnostics.dataQualityScore
  );
  const markets = marketPrior.markets;
  const diagnostics = applyMarketPriorAdjustmentToDiagnostics(learnedCalibrationDiagnostics, marketPrior.adjustment);
  const valueEdges = buildValueEdges(markets, match.oddsMarkets, diagnostics.dataQualityScore);
  const candidatePick = selectBestPick(valueEdges, { learningProfile, caseMemoryBank });
  const decision = buildDecisionEngineReport({
    match,
    markets,
    diagnostics,
    probabilityCalibration: learnedCalibration.adjustment,
    bestPick: candidatePick,
    valueEdges,
    learningProfile,
    caseMemoryBank,
    contextAdjustment,
    marketPriorAdjustment: marketPrior.adjustment,
    publicHistoricalTrainingEvidence
  });
  const bestPick: BestPickResult = decisionAllowsPublicPick(decision)
    ? candidatePick
    : { hasValue: false, label: "No clear value found" };
  const selectedEdge = bestPick.hasValue ? bestPick : undefined;
  const explanation = explainPrediction(match, markets, selectedEdge);
  const agentReport = buildPredictionAgentReport(match, diagnostics, bestPick, valueEdges);

  return {
    matchId: match.id,
    sport: match.sport,
    generatedAt: new Date().toISOString(),
    markets,
    diagnostics,
    calibrationAdjustment: learnedCalibration.adjustment,
    contextAdjustment,
    marketPriorAdjustment: marketPrior.adjustment,
    valueEdges,
    bestPick,
    confidence: bestPick.hasValue ? decision.confidence : "low",
    risk: bestPick.hasValue ? decision.risk : "high",
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
    storageReadsEnabled ? getDecisionCaseMemoryBank({ sport }).catch(() => undefined) : Promise.resolve(undefined),
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
  const [learningProfile, caseMemoryBank] = await Promise.all([
    getLearningProfileForSport(match.sport),
    getDecisionCaseMemoryBank({ sport: match.sport }).catch(() => undefined)
  ]);
  return {
    match,
    prediction: buildPrediction(match, { learningProfile, caseMemoryBank })
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
        decisionAllowsPublicPick(prediction.decision) &&
        prediction.bestPick.hasValue &&
        prediction.bestPick.edge > 0 &&
        prediction.bestPick.expectedValue > 0 &&
        prediction.confidence !== "low"
    )
    .sort((a, b) => {
      const evDiff =
        (b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : 0) -
        (a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : 0);
      if (evDiff !== 0) return evDiff;
      const edgeDiff =
        (b.prediction.bestPick.hasValue ? b.prediction.bestPick.edge : 0) -
        (a.prediction.bestPick.hasValue ? a.prediction.bestPick.edge : 0);
      if (edgeDiff !== 0) return edgeDiff;
      const confidenceDiff = confidenceRank(b.prediction.confidence) - confidenceRank(a.prediction.confidence);
      if (confidenceDiff !== 0) return confidenceDiff;
      return new Date(a.match.kickoffTime).getTime() - new Date(b.match.kickoffTime).getTime();
    });
}

export async function getLiveScores(date = todayIsoDate(), sport: Sport = "football") {
  return sportsProvider.getLiveScores(date, sport);
}

export function getPredictionHistory() {
  return predictionHistory;
}

export function uniqueLeagues(matches: Match[]) {
  return Array.from(new Set(matches.map((match) => match.league.name))).sort();
}

export function uniqueCountries(matches: Match[]) {
  return Array.from(new Set(matches.map((match) => match.league.country))).sort();
}
