import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("versions the outlook with factors, trigger, structure and correction history", () => {
    // Incomplete outlook: the missing factors are explicit, never implied.
    expect(premierLeague2026Baseline.missingFactors.length).toBeGreaterThan(0);
    expect(premierLeague2026Baseline.missingFactors).toContain("promoted-team strength");
    expect(premierLeague2026Baseline.includedFactors).toContain("2025/26 returning-team results");
    expect(premierLeague2026Baseline.nextRevisionTrigger).toMatch(/Championship strength|transfer/);
    // Promoted teams: structural treatment, not silent omission.
    expect(premierLeague2026Baseline.structuralTreatment).toBe("returning-team-baseline");
    // Outlook revision: the correction history leads with the current revision.
    expect(premierLeague2026Baseline.correctionHistory[0].revision).toBe(premierLeague2026Baseline.revision);
    expect(premierLeague2026Baseline.correctionHistory.length).toBeGreaterThanOrEqual(2);
  });

  it("links the outlook page to the official table and withholds the complete ranking", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "season-outlooks", "page.tsx"), "utf8");
    expect(page).toContain("/predictions/league/premier-league/table");
    expect(page).toMatch(/withheld/);
    expect(page).toContain("Correction history");
  });

  it("keeps source and missing-input provenance attached", () => {
    expect(premierLeague2026Baseline.sourceAsOf).toBe("2026-05-24T15:00:00Z");
    expect(premierLeague2026Baseline.revision).toBe(4);
    expect(premierLeague2026Baseline.previousRevision.revision).toBe(3);
    expect(premierLeague2026Baseline.caveat).toContain("Promoted-team strength");
    expect(premierLeague2026Baseline.caveat).toContain("manager effects");
    expect(premierLeague2026Baseline.model).toContain("baseline");
    expect(premierLeague2026Baseline.scheduleState).toContain("Matchweeks 2–5");
    expect(premierLeague2026Baseline.managerState).toContain("all 20 clubs");
    expect(premierLeague2026Baseline.confirmedManagerChangesSinceBaseline).toContain("Álvaro Arbeloa — Fulham (7 July 2026)");
  });
});
