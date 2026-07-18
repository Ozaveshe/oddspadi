import { describe, expect, it } from "vitest";
import { buildEconomicConfidencePresentation } from "@/lib/sports/prediction/economicConfidencePresentation";

describe("economic confidence presentation", () => {
  it("shows the conservative lower-bound economics when the empirical receipt is verified", () => {
    expect(buildEconomicConfidencePresentation({
      status: "verified",
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 400,
      source: "holdout",
      probabilityLow: 0.63,
      probabilityHigh: 0.72,
      edgeLow: 0.08,
      expectedValueLow: 0.19,
      detail: "Verified interval."
    })).toMatchObject({
      state: "survives",
      label: "95% value floor stays positive",
      detail: expect.stringContaining("EV +19.0%")
    });
  });

  it("labels raw EV as statistically unverified when no empirical interval is available", () => {
    expect(buildEconomicConfidencePresentation({
      status: "unavailable",
      method: "unavailable",
      confidenceLevel: null,
      sampleSize: null,
      source: null,
      probabilityLow: null,
      probabilityHigh: null,
      edgeLow: null,
      expectedValueLow: null,
      detail: "Empirical interval unavailable: no active runtime profile. More detail follows."
    })).toMatchObject({
      state: "unavailable",
      label: "Empirical value floor unavailable",
      detail: expect.stringContaining("Raw EV remains a point estimate")
    });
  });
});
