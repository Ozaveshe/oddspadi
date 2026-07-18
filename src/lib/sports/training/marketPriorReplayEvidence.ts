import type {
  MarketPriorAdjustment,
  ProbabilityCalibrationComparison
} from "@/lib/sports/types";
import { buildProbabilityCalibrationComparison } from "@/lib/sports/prediction/probabilityTemperatureScaling";

type ProbabilityObservation = {
  kickoffAt: string;
  probabilities: Record<string, number>;
  actualOutcome: string;
};

export type MarketPriorReplayEvidence = {
  version: "runtime-market-prior-parity-v1";
  status: "applied" | "no-priced-market";
  evaluatedFixtures: number;
  adjustedFixtures: number;
  adjustedSelections: number;
  coverage: number;
  averageWeight: number | null;
  averageBookmakerMargin: number | null;
  probabilityComparison: ProbabilityCalibrationComparison;
};

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildMarketPriorReplayEvidence({
  adjustments,
  baselineRows,
  posteriorRows
}: {
  adjustments: readonly MarketPriorAdjustment[];
  baselineRows: readonly ProbabilityObservation[];
  posteriorRows: readonly ProbabilityObservation[];
}): MarketPriorReplayEvidence {
  if (baselineRows.length !== posteriorRows.length || adjustments.length !== posteriorRows.length) {
    throw new Error("Market-prior replay evidence requires one baseline row, posterior row, and adjustment receipt per fixture.");
  }
  const applied = adjustments.filter((adjustment) => adjustment.applied);
  const evaluatedFixtures = posteriorRows.length;
  const averageWeight = applied.length
    ? applied.reduce((sum, adjustment) => sum + adjustment.averageWeight, 0) / applied.length
    : null;
  const margins = applied
    .map((adjustment) => adjustment.averageBookmakerMargin)
    .filter((value): value is number => value !== null);

  return {
    version: "runtime-market-prior-parity-v1",
    status: applied.length ? "applied" : "no-priced-market",
    evaluatedFixtures,
    adjustedFixtures: applied.length,
    adjustedSelections: applied.reduce((sum, adjustment) => sum + adjustment.adjustedSelections, 0),
    coverage: round(evaluatedFixtures ? applied.length / evaluatedFixtures : 0) ?? 0,
    averageWeight: round(averageWeight),
    averageBookmakerMargin: round(margins.length ? margins.reduce((sum, value) => sum + value, 0) / margins.length : null),
    probabilityComparison: buildProbabilityCalibrationComparison({ baselineRows, calibratedRows: posteriorRows })
  };
}
