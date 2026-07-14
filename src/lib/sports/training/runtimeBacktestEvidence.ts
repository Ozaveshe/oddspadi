import {
  historicalModelCompatibility,
  isDecisionModelSport,
  type HistoricalModelCompatibility
} from "@/lib/sports/prediction/modelIdentity";
import type { StoredBacktestRun } from "@/lib/sports/training/trainingRepository";
import type { Sport } from "@/lib/sports/types";

export const MINIMUM_FOOTBALL_PLAYER_FORM_COVERAGE = 0.6;

export type RuntimeBacktestEvidence = {
  compatibility: HistoricalModelCompatibility | "unsupported-sport" | "missing";
  completed: boolean;
  exactRuntimeParity: boolean;
  playerFormFixtures: number | null;
  eligibleFixtures: number | null;
  playerFormCoverage: number | null;
  playerFormTrainingCoverage: number | null;
  playerFormHoldoutCoverage: number | null;
  minimumPlayerFormCoverage: number | null;
  playerEvidenceReady: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Inspect a stored run as evidence for the current runtime model. A completed
 * benchmark is useful research evidence, but it is not runtime-parity proof.
 */
export function inspectRuntimeBacktestEvidence(
  sport: Sport | string,
  backtest: StoredBacktestRun | null | undefined
): RuntimeBacktestEvidence {
  if (!backtest) {
    return {
      compatibility: "missing",
      completed: false,
      exactRuntimeParity: false,
      playerFormFixtures: null,
      eligibleFixtures: null,
      playerFormCoverage: null,
      playerFormTrainingCoverage: null,
      playerFormHoldoutCoverage: null,
      minimumPlayerFormCoverage: sport === "football" ? MINIMUM_FOOTBALL_PLAYER_FORM_COVERAGE : null,
      playerEvidenceReady: sport !== "football"
    };
  }

  const completed = backtest.status === "completed";
  const compatibility = isDecisionModelSport(sport)
    ? historicalModelCompatibility({ sport, evidenceModelKey: backtest.modelKey, config: backtest.config })
    : "unsupported-sport";
  const exactRuntimeParity = completed && compatibility === "exact-runtime-parity";

  if (sport !== "football") {
    return {
      compatibility,
      completed,
      exactRuntimeParity,
      playerFormFixtures: null,
      eligibleFixtures: null,
      playerFormCoverage: null,
      playerFormTrainingCoverage: null,
      playerFormHoldoutCoverage: null,
      minimumPlayerFormCoverage: null,
      playerEvidenceReady: true
    };
  }

  const featureContract = record(backtest.config?.featureContract);
  const optionalCoverage = record(featureContract.optionalCoverage);
  const eligibleFixtures = nonNegativeInteger(optionalCoverage.playerFormEligibleFixtures)
    ?? nonNegativeInteger(featureContract.eligibleFixtures);
  const playerFormFixtures = nonNegativeInteger(optionalCoverage.playerFormReadyFixtures)
    ?? nonNegativeInteger(optionalCoverage.playerFormFixtures);
  const overallCoverage =
    eligibleFixtures !== null && eligibleFixtures > 0 && playerFormFixtures !== null
      ? Math.min(1, playerFormFixtures / eligibleFixtures)
      : null;
  const trainingEligible = nonNegativeInteger(optionalCoverage.playerFormTrainingEligibleFixtures);
  const trainingReady = nonNegativeInteger(optionalCoverage.playerFormTrainingReadyFixtures);
  const holdoutEligible = nonNegativeInteger(optionalCoverage.playerFormHoldoutEligibleFixtures);
  const holdoutReady = nonNegativeInteger(optionalCoverage.playerFormHoldoutReadyFixtures);
  const playerFormTrainingCoverage = trainingEligible !== null && trainingEligible > 0 && trainingReady !== null
    ? Math.min(1, trainingReady / trainingEligible)
    : null;
  const playerFormHoldoutCoverage = holdoutEligible !== null && holdoutEligible > 0 && holdoutReady !== null
    ? Math.min(1, holdoutReady / holdoutEligible)
    : null;
  const hasWindowCoverageReceipt = trainingEligible !== null && trainingReady !== null && holdoutEligible !== null && holdoutReady !== null;
  const playerFormCoverage = hasWindowCoverageReceipt
    ? playerFormTrainingCoverage !== null && playerFormHoldoutCoverage !== null
      ? Math.min(playerFormTrainingCoverage, playerFormHoldoutCoverage)
      : null
    : overallCoverage;

  return {
    compatibility,
    completed,
    exactRuntimeParity,
    playerFormFixtures,
    eligibleFixtures,
    playerFormCoverage,
    playerFormTrainingCoverage,
    playerFormHoldoutCoverage,
    minimumPlayerFormCoverage: MINIMUM_FOOTBALL_PLAYER_FORM_COVERAGE,
    playerEvidenceReady:
      playerFormCoverage !== null && playerFormCoverage >= MINIMUM_FOOTBALL_PLAYER_FORM_COVERAGE
  };
}
