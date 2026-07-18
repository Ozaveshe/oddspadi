import type { DecisionLearningProfile, ValueEdgeEconomicConfidence } from "@/lib/sports/types";
import { buildDecisionCalibrationInterval } from "./decisionCalibrationInterval";

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function unavailable(detail: string, interval: ReturnType<typeof buildDecisionCalibrationInterval>): ValueEdgeEconomicConfidence {
  return {
    status: "unavailable",
    method: interval.method,
    confidenceLevel: interval.confidenceLevel,
    sampleSize: interval.sampleSize,
    source: interval.source,
    probabilityLow: null,
    probabilityHigh: null,
    edgeLow: null,
    expectedValueLow: null,
    detail
  };
}

/**
 * Converts an active exact-runtime calibration bucket into a conservative
 * selection-level economic receipt. Raw point-estimate EV remains separate.
 */
export function buildValueEdgeEconomicConfidence({
  modelProbability,
  noVigImpliedProbability,
  odds,
  learningProfile
}: {
  modelProbability: number;
  noVigImpliedProbability: number;
  odds: number;
  learningProfile?: DecisionLearningProfile;
}): ValueEdgeEconomicConfidence {
  const interval = buildDecisionCalibrationInterval({ probability: modelProbability, learningProfile });
  const low = interval.low;
  const high = interval.high;
  if (
    interval.method !== "wilson-calibration-bucket" ||
    typeof low !== "number" ||
    !Number.isFinite(low) ||
    typeof high !== "number" ||
    !Number.isFinite(high) ||
    low < 0 ||
    high > 1 ||
    high < low
  ) {
    return unavailable(interval.detail, interval);
  }
  if (!Number.isFinite(noVigImpliedProbability) || noVigImpliedProbability < 0 || noVigImpliedProbability > 1 || !Number.isFinite(odds) || odds <= 1) {
    return unavailable("Empirical interval exists, but valid no-vig probability and executable odds are required for a value floor.", interval);
  }

  return {
    status: "verified",
    method: interval.method,
    confidenceLevel: interval.confidenceLevel,
    sampleSize: interval.sampleSize,
    source: interval.source,
    probabilityLow: round(low),
    probabilityHigh: round(high),
    edgeLow: round(low - noVigImpliedProbability),
    expectedValueLow: round(low * odds - 1),
    detail: `${interval.detail} The lower bound is applied to the current no-vig probability and executable price; it is a conservative evidence floor, not a guaranteed return.`
  };
}
