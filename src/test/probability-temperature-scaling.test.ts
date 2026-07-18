import { describe, expect, it } from "vitest";
import {
  applyProbabilityTemperaturePolicy,
  buildProbabilityCalibrationComparison,
  learnProbabilityTemperaturePolicy,
  probabilityPolicyValidationRows,
  strictChronologicalSplitIndex
} from "@/lib/sports/prediction/probabilityTemperatureScaling";

function rows(probability: number, count = 120) {
  return Array.from({ length: count }, (_, index) => ({
    kickoffAt: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
    probabilities: { home: probability, away: 1 - probability },
    actualOutcome: index % 10 < 7 ? "home" : "away"
  }));
}

describe("chronological probability temperature scaling", () => {
  it("fits early, validates later, and activates only after proper-score improvement", () => {
    const trainingRows = rows(0.9);
    const policy = learnProbabilityTemperaturePolicy({
      trainingRows,
      holdoutWindowStart: new Date(Date.UTC(2024, 5, 1)).toISOString()
    });

    expect(policy).toMatchObject({
      version: "temperature-scaling-v1",
      source: "chronological-training-window",
      status: "active",
      fitSampleSize: 84,
      validationSampleSize: 36,
      reason: "validated-proper-score-improvement"
    });
    expect(policy.temperature).toBeGreaterThan(1);
    expect(policy.calibratedValidation.logLoss).toBeLessThan(policy.baselineValidation.logLoss!);
    expect(Date.parse(policy.validationWindowEnd!)).toBeLessThan(Date.parse(policy.holdoutWindowStart!));
    expect(applyProbabilityTemperaturePolicy({ home: 0.9, away: 0.1 }, policy).home).toBeLessThan(0.9);
    expect(probabilityPolicyValidationRows(trainingRows, policy)).toHaveLength(36);
  });

  it("keeps the identity transform when the sample is thin or validation does not improve", () => {
    const thin = learnProbabilityTemperaturePolicy({
      trainingRows: rows(0.9, 59),
      holdoutWindowStart: new Date(Date.UTC(2024, 5, 1)).toISOString()
    });
    const calibrated = learnProbabilityTemperaturePolicy({
      trainingRows: rows(0.7),
      holdoutWindowStart: new Date(Date.UTC(2024, 5, 1)).toISOString()
    });

    expect(thin).toMatchObject({ status: "identity", temperature: 1, reason: "insufficient-training-sample" });
    expect(calibrated.status).toBe("identity");
    expect(calibrated.temperature).toBe(1);
  });

  it("reports untouched holdout scores separately from calibrated scores", () => {
    const policy = learnProbabilityTemperaturePolicy({
      trainingRows: rows(0.9),
      holdoutWindowStart: new Date(Date.UTC(2024, 5, 1)).toISOString()
    });
    const baselineRows = rows(0.9, 30).map((row, index) => ({ ...row, kickoffAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString() }));
    const calibratedRows = baselineRows.map((row) => ({
      ...row,
      probabilities: applyProbabilityTemperaturePolicy(row.probabilities, policy)
    }));
    const comparison = buildProbabilityCalibrationComparison({ baselineRows, calibratedRows });

    expect(comparison.baseline.sampleSize).toBe(30);
    expect(comparison.calibrated.sampleSize).toBe(30);
    expect(comparison.logLossDelta).toBeLessThan(0);
  });

  it("never splits simultaneous fixtures across chronological evidence windows", () => {
    const timestamps = [1, 2, 3, 3, 3, 4].map((day) => ({ kickoffAt: new Date(Date.UTC(2024, 0, day)).toISOString() }));
    const split = strictChronologicalSplitIndex(timestamps, 3);

    expect(split).toBe(2);
    expect(Date.parse(timestamps[split - 1]!.kickoffAt)).toBeLessThan(Date.parse(timestamps[split]!.kickoffAt));
  });

  it("fails closed when every fixture shares the same kickoff timestamp", () => {
    const timestamps = Array.from({ length: 80 }, () => ({ kickoffAt: "2024-01-01T12:00:00.000Z" }));

    expect(strictChronologicalSplitIndex(timestamps, 56, { minimumLeft: 40, minimumRight: 20 })).toBe(0);
    expect(learnProbabilityTemperaturePolicy({
      trainingRows: timestamps.map((row, index) => ({
        ...row,
        probabilities: { home: 0.9, away: 0.1 },
        actualOutcome: index % 10 < 7 ? "home" : "away"
      })),
      holdoutWindowStart: "2024-02-01T12:00:00.000Z"
    })).toMatchObject({ status: "identity", temperature: 1, reason: "invalid-chronology" });
  });
});
