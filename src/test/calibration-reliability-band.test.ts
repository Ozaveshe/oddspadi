import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalibrationReliabilityBand } from "@/components/odds/CalibrationReliabilityBand";
import type { DecisionBeliefState } from "@/lib/sports/types";

type Interval = DecisionBeliefState["confidenceInterval"];

describe("calibration reliability band", () => {
  it("renders the governed interval, comparison markers, sample, and statistical caveat", () => {
    const interval: Interval = {
      low: 0.502,
      high: 0.691,
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 100,
      source: "validated-holdout",
      detail: "Wilson 95% interval for 100 settled predictions."
    };
    const html = renderToStaticMarkup(createElement(CalibrationReliabilityBand, {
      interval,
      modelProbability: 0.58,
      marketProbability: 0.52,
      selectionLabel: "Home win"
    }));

    expect(html).toContain("Historical calibration range");
    expect(html).toContain("Verified 95% band");
    expect(html).toContain("50%–69%");
    expect(html).toContain("Model chance");
    expect(html).toContain("Fair market chance");
    expect(html).toContain("100 settled predictions");
    expect(html).toContain("not a range of possible match outcomes or a guarantee");
    expect(html).toContain('data-state="verified"');
  });

  it("renders the engine's exact unavailable reason and no fabricated ruler", () => {
    const interval: Interval = {
      low: null,
      high: null,
      method: "unavailable",
      confidenceLevel: null,
      sampleSize: 12,
      source: "validated-holdout",
      detail: "The matching calibration bucket has 12 settled predictions; at least 30 are required."
    };
    const html = renderToStaticMarkup(createElement(CalibrationReliabilityBand, {
      interval,
      modelProbability: 0.58,
      marketProbability: 0.52,
      selectionLabel: "Home win"
    }));

    expect(html).toContain("Not available");
    expect(html).toContain("The matching calibration bucket has 12 settled predictions; at least 30 are required.");
    expect(html).toContain("No statistical band is shown");
    expect(html).not.toContain("calibration-ruler");
    expect(html).toContain('data-state="unavailable"');
  });
});
