import type { DecisionLearningProfile } from "@/lib/sports/types";

/**
 * How much of the market's priced probability the blend must retain, given what
 * the model has actually demonstrated on settled outcomes.
 *
 * The market prior weight was previously derived from data quality alone
 * (`0.08 + (1 - quality) * 0.16`), which inverts the incentive: the better the
 * fixture data, the *less* the market was trusted — even though the model's own
 * calibration candidate reported a Brier skill of -0.368, i.e. worse than
 * predicting the base rate. In production that left the market holding roughly
 * 8-12% of the blend and let tennis publish a 20.9% average edge peaking at
 * 57.4%. Those were not opportunities; they were the model's error surfacing
 * unchecked.
 *
 * The anchor inverts the default: an unproven model is held close to the priced
 * market, and earns room to disagree only by demonstrating calibration on real
 * settled outcomes. That is the honest order of operations for a system that
 * intends to beat the market eventually — track it first, deviate once you can
 * show you should.
 */
export type ModelSkillAnchorStatus = "unproven" | "developing" | "proven";

export type ModelSkillAnchor = {
  status: ModelSkillAnchorStatus;
  /** Minimum share of the market prior the blend must hold, before market-quality discounts. */
  marketWeightFloor: number;
  settledSample: number;
  minimumSample: number;
  calibrationError: number | null;
  brierScore: number | null;
  reason: string;
};

/** Above this expected calibration error the model's probabilities are not trustworthy. */
export const MAX_TRUSTED_CALIBRATION_ERROR = 0.1;

const UNPROVEN_FLOOR = 0.8;
const DEVELOPING_CEILING_FLOOR = 0.8;
const DEVELOPING_FLOOR = 0.45;
const PROVEN_FLOOR = 0.25;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function buildModelSkillAnchor(profile?: DecisionLearningProfile): ModelSkillAnchor {
  const settledSample = Math.max(0, profile?.realFinishedFixtures ?? 0);
  const minimumSample = Math.max(1, profile?.minimumRecommendedFixtures ?? 30);
  const calibrationError = typeof profile?.calibrationError === "number" && Number.isFinite(profile.calibrationError)
    ? profile.calibrationError
    : null;
  const brierScore = typeof profile?.brierScore === "number" && Number.isFinite(profile.brierScore)
    ? profile.brierScore
    : null;

  const base = { settledSample, minimumSample, calibrationError, brierScore };

  // No promoted, model-matched profile: nothing has been demonstrated at all.
  if (!profile || !profile.active || profile.calibrationBucketSource !== "promoted-cohort") {
    return {
      ...base,
      status: "unproven",
      marketWeightFloor: UNPROVEN_FLOOR,
      reason: "No promoted calibration cohort backs this runtime, so the priced market is the only trustworthy probability."
    };
  }

  // Promoted, but the curve is measurably off or the sample is too thin to tell.
  const sampleShortfall = settledSample < minimumSample;
  const miscalibrated = calibrationError !== null && calibrationError > MAX_TRUSTED_CALIBRATION_ERROR;
  if (sampleShortfall || miscalibrated || calibrationError === null) {
    // Scale linearly with sample coverage: more settled evidence buys more room.
    const coverage = clamp(settledSample / minimumSample, 0, 1);
    const floor = DEVELOPING_CEILING_FLOOR - (DEVELOPING_CEILING_FLOOR - DEVELOPING_FLOOR) * coverage;
    const reason = miscalibrated
      ? `Expected calibration error ${calibrationError!.toFixed(3)} exceeds ${MAX_TRUSTED_CALIBRATION_ERROR}, so the model stays anchored to the market.`
      : calibrationError === null
        ? "Calibration error is unmeasured for this runtime, so the model stays anchored to the market."
        : `Only ${settledSample}/${minimumSample} settled outcomes back this curve, so the model stays close to the market.`;
    return { ...base, status: "developing", marketWeightFloor: round(floor), reason };
  }

  return {
    ...base,
    status: "proven",
    marketWeightFloor: PROVEN_FLOOR,
    reason: `Calibration error ${calibrationError.toFixed(3)} over ${settledSample} settled outcomes earns room to disagree with the market.`
  };
}
