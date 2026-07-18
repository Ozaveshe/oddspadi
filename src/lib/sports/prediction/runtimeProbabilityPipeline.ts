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
import { footballMarketPriorEvidencePolicy } from "./marketPriorPolicy";
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
    marketPriorScalingPolicy ?? learningProfile?.marketPriorScalingPolicy ?? undefined
  );

  return {
    version: RUNTIME_PROBABILITY_PIPELINE_VERSION,
    baseMarkets: baseModel.markets,
    contextMarkets,
    learnedCalibratedMarkets: learnedCalibration.markets,
    markets: marketPrior.markets,
    diagnostics: applyMarketPriorAdjustmentToDiagnostics(learnedCalibrationDiagnostics, marketPrior.adjustment),
    contextAdjustment,
    calibrationAdjustment: learnedCalibration.adjustment,
    marketPriorAdjustment: marketPrior.adjustment
  };
}
