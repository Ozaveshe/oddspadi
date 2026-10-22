import type { DecisionSummary } from "@/lib/sports/types";
import type { StructuredLegInput } from "./resolve";

export type WorkspaceFixture = {
  id: string; sport: "football" | "basketball" | "tennis";
  label: string; competition: string; kickoffAt: string; lastSyncedAt: string;
};
export type WorkspaceOption = { key: string; input: StructuredLegInput; evidence: string };

/** Only current, provider-backed evidence may accompany a manually priced leg. */
export function workspaceOptions(fixture: WorkspaceFixture, summary: DecisionSummary | null, now = new Date()): WorkspaceOption[] {
  const maxAge = (fixture.sport === "basketball" ? 45 : 60) * 60_000;
  const generated = Date.parse(summary?.generatedAt ?? "");
  const expiry = Date.parse(summary?.expiresAt ?? "");
  const fresh = Date.parse(fixture.kickoffAt) > now.getTime() && Boolean(summary?.auditSummary.providerBacked) && Number.isFinite(generated) &&
    generated <= now.getTime() && now.getTime() - generated <= maxAge &&
    Number.isFinite(expiry) && expiry > now.getTime();
  const candidates = fresh ? summary!.allMarketAnalyses.filter((row) =>
    Number.isFinite(row.modelProbability) && row.modelProbability > 0 && row.modelProbability < 1 &&
    Date.parse(row.expiresAt ?? "") > now.getTime() &&
    !["stale", "suspended", "needs_data"].includes(row.analysisStatus)
  ) : [];
  const rows = candidates.length ? candidates : (fixture.sport === "football" ? ["home", "draw", "away"] : ["home", "away"]).map((selectionId) => ({
    marketId: "match_winner", selectionId, label: selectionId === "draw" ? "Draw" : `${selectionId === "home" ? "Home / player A" : "Away / player B"} to win`,
    modelProbability: null, noVigImpliedProbability: null
  }));
  return rows.map((row) => ({
    key: `${row.marketId}:${row.selectionId}`,
    evidence: candidates.length ? "Stored pre-match analysis; compare with your own price. This is not an official pick." : "No current model evidence. Only your price's implied chance can be calculated.",
    input: {
      fixtureId: fixture.id, sport: fixture.sport, marketId: row.marketId, selectionId: row.selectionId,
      label: row.label, fixtureLabel: fixture.label, competition: fixture.competition,
      source: "Your bookmaker", entryPoint: "manual", userOdds: 0, oddsObservedAt: null,
      modelProbability: row.modelProbability, modelGeneratedAt: candidates.length ? summary!.generatedAt : null,
      marketNoVigProbability: row.noVigImpliedProbability, decisionState: null, publicationId: null,
      kickoffAt: fixture.kickoffAt, fixtureStatus: "scheduled", marketSupported: true,
      modelInterval: null
    }
  }));
}
