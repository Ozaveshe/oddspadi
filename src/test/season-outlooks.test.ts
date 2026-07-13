import { describe, expect, it } from "vitest";
import { buildPremierLeague2026Projection, premierLeague2026Baseline } from "@/lib/sports/prediction/seasonOutlooks";

describe("upcoming season outlooks", () => {
  it("produces a deterministic returning-team probability field", () => {
    const first = buildPremierLeague2026Projection(5_000);
    const second = buildPremierLeague2026Projection(5_000);
    expect(first).toEqual(second);
    expect(first).toHaveLength(17);
    expect(first.reduce((sum, team) => sum + team.titleProbability, 0)).toBeCloseTo(1, 8);
    expect(first.every((team) => team.topFourProbability >= team.titleProbability)).toBe(true);
  });

  it("keeps source and missing-input provenance attached", () => {
    expect(premierLeague2026Baseline.sourceAsOf).toBe("2026-05-24T15:00:00Z");
    expect(premierLeague2026Baseline.caveat).toContain("Promoted clubs");
    expect(premierLeague2026Baseline.model).toContain("baseline");
  });
});
