import { describe, expect, it } from "vitest";
import { buildEngineViewRows, presentBlockers } from "@/lib/sports/prediction/blockerPresentation";

describe("blocker presentation", () => {
  it("collapses the three ways the engine says it abstained into one reason", () => {
    // Exactly what a live tennis fixture showed under "Key risks".
    const presented = presentBlockers([
      "engine action is avoid",
      "calibration requires abstention",
      "engine actionability is blocked"
    ]);

    expect(presented).toHaveLength(1);
    expect(presented[0]!.text).toBe("The model declined to make a call on this match.");
  });

  it("keeps genuinely different reasons separate", () => {
    const presented = presentBlockers([
      "engine action is avoid",
      "best-price comparison needs at least 3 independent bookmakers",
      "data quality is below the sport threshold"
    ]);

    expect(presented).toHaveLength(3);
    expect(new Set(presented.map((item) => item.topic)).size).toBe(3);
  });

  it("never shows raw engine vocabulary for a known blocker", () => {
    const presented = presentBlockers([
      "empirical 95% value floor is unavailable for this runtime",
      "cross-book probability disagreement exceeds 10%"
    ]);

    for (const item of presented) {
      expect(item.text).not.toMatch(/runtime|cross-book|empirical 95%/i);
    }
  });

  it("passes an unrecognised blocker through rather than dropping it", () => {
    // A new engine blocker must still reach the reader, even unpolished.
    const presented = presentBlockers(["some brand new gate tripped"]);

    expect(presented[0]!.text).toBe("some brand new gate tripped");
  });

  it("explains the unproven-model case in terms of evidence, not jargon", () => {
    const presented = presentBlockers(["no settled outcomes exist for this sport, so model error cannot be bounded"]);

    expect(presented[0]!.text).toMatch(/no finished results have been graded/i);
  });

  it("respects the display limit and ignores blank entries", () => {
    const presented = presentBlockers(["", "  ", "data quality is below the sport threshold", "kickoff is too close for a new published pick"], 1);

    expect(presented).toHaveLength(1);
  });
});

describe("engine view rows", () => {
  const selections = [
    { id: "home", label: "N. Arakawa", decimalOdds: 1.75 },
    { id: "away", label: "Ri. Alame", decimalOdds: 2.1 }
  ];

  it("pairs the model read against the market price", () => {
    const rows = buildEngineViewRows({ selections, probabilities: { home: 0.57, away: 0.43 } });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: "N. Arakawa", modelProbability: 0.57 });
    expect(rows[0]!.impliedProbability).toBeCloseTo(1 / 1.75, 5);
  });

  it("shows market prices even when the model produced no probability", () => {
    // A suspended fixture still has live prices worth seeing.
    const rows = buildEngineViewRows({ selections, probabilities: {} });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.modelProbability).toBeNull();
    expect(rows[0]!.impliedProbability).not.toBeNull();
  });

  it("returns nothing rather than a table of dashes", () => {
    const rows = buildEngineViewRows({
      selections: [{ id: "home", label: "Home", decimalOdds: 1 }],
      probabilities: {}
    });

    expect(rows).toEqual([]);
  });

  it("treats a non-informative price as absent instead of dividing by it", () => {
    const rows = buildEngineViewRows({
      selections: [{ id: "home", label: "Home", decimalOdds: 1 }],
      probabilities: { home: 0.6 }
    });

    expect(rows[0]!.impliedProbability).toBeNull();
    expect(rows[0]!.modelProbability).toBe(0.6);
  });
});
