import { describe, expect, it } from "vitest";
import { workspaceOptions, type WorkspaceFixture } from "@/lib/workspace/options";
import { resolveStructuredLeg } from "@/lib/workspace/resolve";
import { analyseLeg } from "@/lib/workspace/selection";
import type { DecisionSummary } from "@/lib/sports/types";
const now = new Date("2026-10-22T10:00:00Z");
const fixture: WorkspaceFixture = { id: "api-football:123", sport: "football", label: "A vs B", competition: "League", kickoffAt: "2026-10-22T18:00:00Z", lastSyncedAt: now.toISOString() };
const summary = {
  generatedAt: "2026-10-22T09:45:00Z", expiresAt: "2026-10-22T10:30:00Z", auditSummary: { providerBacked: true },
  allMarketAnalyses: [{ marketId: "match_winner", selectionId: "home", label: "Home", modelProbability: .6, noVigImpliedProbability: .55, expiresAt: "2026-10-22T10:30:00Z", analysisStatus: "watchlist" }]
} as DecisionSummary;
describe("workspace evidence", () => {
  it("evaluates the user's actual price against current stored evidence", () => {
    const option = workspaceOptions(fixture, summary, now)[0];
    const leg = resolveStructuredLeg({ ...option.input, userOdds: 2, oddsObservedAt: now.toISOString() }, "one");
    expect(leg.kind).toBe("leg");
    if (leg.kind !== "leg") return;
    const result = analyseLeg(leg.selection, now.getTime());
    expect(result.expectedValue).toBeCloseTo(.2);
    expect(result.isOfficialPick).toBe(false);
    expect(result.usableForCombination).toBe(true);
  });
  it.each([null, { ...summary, generatedAt: "2026-10-21T00:00:00Z" }, { ...summary, auditSummary: { providerBacked: false } }])("withholds missing, stale and non-provider model evidence", (evidence) => {
    const options = workspaceOptions(fixture, evidence as DecisionSummary | null, now);
    expect(options).toHaveLength(3);
    expect(options.every((row) => row.input.modelProbability === null && row.input.marketNoVigProbability === null)).toBe(true);
  });
  it("does not continue combining pre-match numbers after kickoff despite stale scheduled status", () => {
    const option = workspaceOptions(fixture, summary, now)[0];
    const result = resolveStructuredLeg({ ...option.input, userOdds: 2, oddsObservedAt: now.toISOString(), kickoffAt: "2026-10-22T09:59:00Z" }, "one");
    if (result.kind !== "leg") throw new Error("Leg rejected");
    expect(analyseLeg(result.selection, now.getTime()).usableForCombination).toBe(false);
    expect(analyseLeg({ ...result.selection, kickoffAt: fixture.kickoffAt, modelGeneratedAt: null }, now.getTime()).usableForCombination).toBe(false);
  });
});
