import type {
  DecisionLearningProfile,
  FootballModelDiagnostics,
  LearnedProbabilityCalibrationAdjustment,
  MarketPriorScalingPolicy,
  MarketPriorAdjustment,
  Match,
  MatchContextAdjustment,
  PredictionMarket
} from "@/lib/sports/types";
import {
  applyContextAdjustmentToDiagnostics,
  applyContextAdjustmentToMarkets,
  buildMatchContextAdjustment,
  coreModelContextCategories
} from "./contextAdjustment";
import {
  applyLearnedProbabilityCalibration,
  applyLearnedProbabilityCalibrationToDiagnostics
} from "./learnedProbabilityCalibration";
import { buildModelSkillAnchor } from "./modelSkillAnchor";
import { footballMarketPriorEvidencePolicy } from "./marketPriorPolicy";
import { applyMarketCoherencePass } from "./marketCoherentMatrix";
import {
  applyMarketPriorAdjustmentToDiagnostics,
  applyMarketPriorAdjustmentToMarkets
} from "./odds";

export const RUNTIME_PROBABILITY_PIPELINE_VERSION = "decision-probability-pipeline-v2";

export type RuntimeProbabilityModelOutput = {
  markets: PredictionMarket[];
  diagnostics: FootballModelDiagnostics;
};

export type RuntimeProbabilityPipelineResult = {
  version: typeof RUNTIME_PROBABILITY_PIPELINE_VERSION;
  baseMarkets: PredictionMarket[];
  contextMarkets: PredictionMarket[];
  learnedCalibratedMarkets: PredictionMarket[];
  markets: PredictionMarket[];
  diagnostics: FootballModelDiagnostics;
  contextAdjustment: MatchContextAdjustment;
  calibrationAdjustment: LearnedProbabilityCalibrationAdjustment;
  marketPriorAdjustment: MarketPriorAdjustment;
};

/**
 * The single probability path used by both daily decisions and exact-runtime
 * replay. Historical callers pass their fixture kickoff as `now` and omit a
 * learning profile, keeping promoted calibration out of training evidence.
 */
export function applyRuntimeProbabilityPipeline({
  match,
  baseModel,
  learningProfile,
  engineVersion,
  now = new Date(),
  marketPriorScalingPolicy
}: {
  match: Match;
  baseModel: RuntimeProbabilityModelOutput;
  learningProfile?: DecisionLearningProfile;
  engineVersion: string;
  now?: Date;
  marketPriorScalingPolicy?: Pick<MarketPriorScalingPolicy, "weightScale">;
}): RuntimeProbabilityPipelineResult {
  const contextAdjustment = buildMatchContextAdjustment(match, {
    probabilityHandledCategories: coreModelContextCategories(match),
    now
  });
  const contextMarkets = applyContextAdjustmentToMarkets(baseModel.markets, contextAdjustment);
  const contextDiagnostics = applyContextAdjustmentToDiagnostics(baseModel.diagnostics, contextAdjustment);
  const learnedCalibration = applyLearnedProbabilityCalibration({
    markets: contextMarkets,
    profile: learningProfile,
    modelKey: baseModel.diagnostics.modelVersion,
    engineVersion
  });
  const learnedCalibrationDiagnostics = applyLearnedProbabilityCalibrationToDiagnostics({
    diagnostics: contextDiagnostics,
    adjustment: learnedCalibration.adjustment
  });
  const marketPrior = applyMarketPriorAdjustmentToMarkets(
    learnedCalibration.markets,
    match.oddsMarkets,
    learnedCalibrationDiagnostics.dataQualityScore,
    footballMarketPriorEvidencePolicy(match),
    marketPriorScalingPolicy ?? learningProfile?.marketPriorScalingPolicy ?? undefined,
    buildModelSkillAnchor(learningProfile)
  );

  // The prior blend moves each priced market toward the book one market at a
  // time, so unpriced markets still describe the raw model's match. Refit the
  // score matrix to the anchored 1X2 and re-derive the unpriced markets from
  // it, so the whole board is one match again. Live fixtures are skipped:
  // their matrix is truncated at the current score and a from-zero Poisson
  // refit would describe the wrong game.
  const coherence =
    match.sport === "football" && match.status !== "live" && marketPrior.adjustment.applied
      ? applyMarketCoherencePass({
          markets: marketPrior.markets,
          pricedMarketIds: new Set(marketPrior.adjustment.markets.map((market) => market.marketId)),
          rho: baseModel.diagnostics.dixonColesRho ?? -0.06,
          initialLambdaHome: baseModel.diagnostics.expectedGoals.home,
          initialLambdaAway: baseModel.diagnostics.expectedGoals.away
        })
      : null;

  const finalMarkets = coherence?.applied ? coherence.markets : marketPrior.markets;
  const priorDiagnostics = applyMarketPriorAdjustmentToDiagnostics(learnedCalibrationDiagnostics, marketPrior.adjustment);
  const diagnostics = coherence?.applied && coherence.receipt
    ? {
        ...priorDiagnostics,
        marketCoherence: coherence.receipt,
        calibrationNotes: [
          ...priorDiagnostics.calibrationNotes,
          `After the market-prior blend, the score matrix was refit to the anchored probabilities (λ ${coherence.receipt.lambdaHome.toFixed(2)}-${coherence.receipt.lambdaAway.toFixed(2)}) and ${coherence.receipt.rebuiltMarkets.length} unpriced market(s) were re-derived from it, so priced and unpriced markets describe the same match.`
        ]
      }
    : priorDiagnostics;

  return {
    version: RUNTIME_PROBABILITY_PIPELINE_VERSION,
    baseMarkets: baseModel.markets,
    contextMarkets,
    learnedCalibratedMarkets: learnedCalibration.markets,
    markets: finalMarkets,
    diagnostics,
    contextAdjustment,
    calibrationAdjustment: learnedCalibration.adjustment,
    marketPriorAdjustment: marketPrior.adjustment
  };
}
