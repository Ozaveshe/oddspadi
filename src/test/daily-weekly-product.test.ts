import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSportsSlate } from "@/lib/sports/intelligence/canonical";
import type { CanonicalDecision, CanonicalFixture, CanonicalOddsSnapshot, SlateFixture, SlatePublicStatus, SportsSlate } from "@/lib/sports/intelligence/types";
import { buildDailyTipsProduct, buildWeeklyTipsProduct, filterDailyTipsProductBySport, type YesterdayResultsProduct } from "@/lib/sports/tips/product";
import { formatDailyTipsForTelegram, formatDailyTipsForWhatsApp, formatValuePickPost, formatWeeklyRadarPost, formatYesterdayResultsPost } from "@/lib/sports/tips/social";
import { partitionDailyTipsSections, partitionDecisionAuditRows, partitionWeeklyTipsDay } from "@/components/odds/IntelligenceSlate";
import type { DecisionMarketAnalysis, DecisionSummary } from "@/lib/sports/types";

const GENERATED_AT = "2026-07-14T10:00:00.000Z";

function analysis({ edge = 0.08, expiresAt = "2026-07-14T11:00:00.000Z" }: { edge?: number; expiresAt?: string } = {}): DecisionMarketAnalysis {
  return {
    marketId: "both_teams_to_score", selectionId: "yes", label: "BTTS Yes", modelProbability: 0.64,
    rawImpliedProbability: 0.56, noVigImpliedProbability: 0.54, impliedProbability: 0.54, bookmakerMargin: 0.05,
    edge, expectedValue: edge > 0 ? 0.12 : -0.03, expectedRoi: edge > 0 ? 0.12 : -0.03, odds: 1.9,
    confidence: "medium", risk: "medium", analysisStatus: edge > 0 ? "published_value_pick" : "no_clear_value",
    oddsSnapshotId: "odds-1", oddsCapturedAt: GENERATED_AT, expiresAt, dataQuality: 0.88, evidenceQuality: "strong",
    publicationEligible: edge > 0, blockers: edge > 0 ? [] : ["The current price does not offer a positive model edge."]
  };
}

function decisionSummary(fixtureId: string, status: SlatePublicStatus, expiresAt = "2026-07-14T11:00:00.000Z"): DecisionSummary {
  const candidate = analysis({ edge: status === "no_clear_value" ? -0.02 : 0.08, expiresAt });
  return {
    fixtureId,
    bestPublishedPick: status === "value_pick" ? candidate : null,
    bestLean: status === "lean" ? { ...candidate, analysisStatus: "lean", publicationEligible: false } : null,
    bestWatchlistCandidate: status === "watchlist" || status === "stale" ? { ...candidate, analysisStatus: status, publicationEligible: false } : null,
    noPickReason: status === "no_clear_value" ? "No clear value found." : null,
    allMarketAnalyses: [candidate],
    publicStatus: ["value_pick", "lean", "watchlist", "no_clear_value", "stale", "needs_data", "suspended"].includes(status) ? status as DecisionSummary["publicStatus"] : "needs_data",
    engineStatus: status === "value_pick" ? "published" : status === "lean" ? "lean" : status === "watchlist" ? "watch" : status === "stale" ? "stale" : "no-pick",
    dataQuality: 0.88, evidenceQuality: "strong", confidence: "medium", risk: "medium", generatedAt: GENERATED_AT, expiresAt,
    auditSummary: {
      thresholdProfile: "football",
      thresholds: { minimumValueEdge: 0.04, minimumExpectedValue: 0.03, minimumConfidenceForValuePick: "medium", minimumDataQuality: 0.62, maximumOddsAgeMinutes: 60, minimumOdds: 1.2, maximumOdds: 5, minimumKickoffLeadMinutes: 10, maxMarketsPerFixture: 3 },
      marketsAnalysed: 1, publishedCandidates: status === "value_pick" ? 1 : 0, leanCandidates: status === "lean" ? 1 : 0,
      watchlistCandidates: status === "watchlist" ? 1 : 0, staleCandidates: status === "stale" ? 1 : 0,
      enginePublicationAllowed: status === "value_pick", providerBacked: true, contextSignalsSeen: 2, blockers: [], publicInvariantPassed: true
    }
  };
}

function fixtureRow(id: string, status: SlatePublicStatus, options: { provider?: string; kickoffAt?: string; expiresAt?: string; sport?: CanonicalFixture["sport"] } = {}): SlateFixture {
  const fixture: CanonicalFixture = {
    fixtureId: id, providerFixtureId: id, sport: options.sport ?? "football", league: "Premier League", leagueId: "39", country: "England", season: "2026",
    kickoffAt: options.kickoffAt ?? "2026-07-14T18:00:00.000Z", homeTeam: { id: "h", name: "Home FC" }, awayTeam: { id: "a", name: "Away FC" },
    status: "scheduled", score: null, provider: options.provider ?? "api-football", lastSyncedAt: GENERATED_AT, dataQuality: 0.88
  };
  const summary = decisionSummary(id, status, options.expiresAt);
  return { fixture, odds: [], decisions: [], decisionSummary: summary, publicStatus: status, bestDecision: null };
}

function slate(rows: SlateFixture[], scope: "daily" | "weekly" = "daily"): SportsSlate {
  return {
    scope, generatedAt: GENERATED_AT, range: { from: "2026-07-14", to: scope === "weekly" ? "2026-07-20" : "2026-07-14" },
    provider: { status: "completed", providers: ["api-football"], lastRun: null, errors: [] },
    summary: { fixturesFound: rows.length, predictionsGenerated: rows.length, valuePicksPublished: 0, leansPublished: 0, watchlist: 0, noPickMatches: 0, preliminaryDecisions: 0, readyDecisions: 0, staleDecisions: 0, settledFixtures: 0, oddsSnapshotsUsed: 0 },
    fixtures: rows, groupedByDate: [], groups: { valuePicks: [], leans: [], watchlist: [], allAnalysed: rows, noPicks: [] }
  };
}

describe("Daily Tips and Weekly Predictions product layer", () => {
  it("keeps provider-backed fixtures and removes mock fixtures from daily tips", () => {
    const product = buildDailyTipsProduct(slate([fixtureRow("real-1", "lean"), fixtureRow("mock-1", "value_pick", { provider: "mockSportsDataProvider" })]));
    expect(product.sections.schedule.map((row) => row.fixture.fixtureId)).toEqual(["real-1"]);
    expect(JSON.stringify(product)).not.toContain("mock-1");
  });

  it("remains useful without value picks by retaining leans, watchlist, and no-pick matches", () => {
    const product = buildDailyTipsProduct(slate([fixtureRow("lean-1", "lean"), fixtureRow("watch-1", "watchlist"), fixtureRow("none-1", "no_clear_value")]));
    expect(product.summary.valuePicks).toBe(0);
    expect(product.sections.leans).toHaveLength(1);
    expect(product.sections.watchlist).toHaveLength(1);
    expect(product.sections.noPicks).toHaveLength(1);
  });

  it("shows each reviewed fixture once and keeps unreviewed fixtures in the evidence queue", () => {
    const waiting = fixtureRow("waiting-1", "needs_data");
    waiting.decisionSummary = { ...waiting.decisionSummary, allMarketAnalyses: [] };
    const product = buildDailyTipsProduct(slate([
      fixtureRow("watch-1", "watchlist"),
      fixtureRow("abstain-1", "no_clear_value"),
      waiting
    ]));

    const partitions = partitionDailyTipsSections(product);

    expect(partitions.published).toEqual([]);
    expect(partitions.abstentions.map((row) => row.fixture.fixtureId)).toEqual(["abstain-1"]);
    expect(partitions.waitingForEvidence.map((row) => row.fixture.fixtureId)).toEqual(["waiting-1"]);
    expect(partitions.waitingForEvidence.map((row) => row.fixture.fixtureId)).not.toContain("watch-1");
  });

  it("separates reviewed yesterday decisions from provider-only audit rows", () => {
    const waiting = fixtureRow("audit-waiting", "needs_data");
    waiting.decisionSummary = { ...waiting.decisionSummary, allMarketAnalyses: [] };

    const partitions = partitionDecisionAuditRows([fixtureRow("audit-reviewed", "no_clear_value"), waiting]);

    expect(partitions.reviewed.map((row) => row.fixture.fixtureId)).toEqual(["audit-reviewed"]);
    expect(partitions.awaitingReview.map((row) => row.fixture.fixtureId)).toEqual(["audit-waiting"]);
  });

  it("filters every daily slate section and summary to the requested sport", () => {
    const product = buildDailyTipsProduct(slate([
      fixtureRow("football-1", "lean"),
      fixtureRow("basketball-1", "watchlist", { sport: "basketball" })
    ]));

    const basketball = filterDailyTipsProductBySport(product, "basketball");

    expect(basketball.sections.schedule.map((row) => row.fixture.fixtureId)).toEqual(["basketball-1"]);
    expect(basketball.slate.fixtures.every((row) => row.fixture.sport === "basketball")).toBe(true);
    expect(basketball.summary).toMatchObject({ fixturesFound: 1, watchlist: 1, leans: 0 });
    expect(basketball.slate.summary).toMatchObject({ fixturesFound: 1, watchlist: 1, leansPublished: 0 });
  });

  it("renders a complete seven-day grouping even when some dates have no fixtures", () => {
    const product = buildWeeklyTipsProduct(slate([fixtureRow("day-1", "preliminary"), fixtureRow("day-3", "ready", { kickoffAt: "2026-07-16T18:00:00.000Z" })], "weekly"));
    expect(product.days).toHaveLength(7);
    expect(product.days.map((day) => day.date)).toEqual(["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"]);
  });

  it("puts reviewed weekly decisions before a distinct provider evidence queue", () => {
    const waiting = fixtureRow("week-waiting", "preliminary");
    waiting.decisionSummary = { ...waiting.decisionSummary, allMarketAnalyses: [] };
    const product = buildWeeklyTipsProduct(slate([
      waiting,
      fixtureRow("week-abstain", "no_clear_value"),
      fixtureRow("week-watch", "watchlist")
    ], "weekly"));

    const partitions = partitionWeeklyTipsDay(product.days[0]);

    expect(partitions.reviewed.map((row) => row.fixture.fixtureId)).toEqual(["week-watch", "week-abstain"]);
    expect(partitions.waitingForEvidence.map((row) => row.fixture.fixtureId)).toEqual(["week-waiting"]);
    expect(partitions.waitingForEvidence.map((row) => row.fixture.fixtureId)).not.toContain("week-watch");
  });

  it("moves weekly preliminary analysis to ready with fresh odds and stale after expiry", () => {
    const fixture = fixtureRow("weekly-status", "value_pick").fixture;
    const freshSnapshot: CanonicalOddsSnapshot = { oddsSnapshotId: "odds-1", fixtureId: fixture.fixtureId, market: "both_teams_to_score", selection: "yes", label: "BTTS Yes", decimalOdds: 1.9, bookmaker: "Book", provider: "odds-provider", capturedAt: GENERATED_AT, source: "odds-provider", isLive: false, expiresAt: "2026-07-14T11:00:00.000Z" };
    const preliminaryDecision: CanonicalDecision = { decisionId: "d1", fixtureId: fixture.fixtureId, market: "both_teams_to_score", selection: "yes", label: "BTTS Yes", oddsSnapshotId: "odds-1", modelVersion: "m1", engineVersion: "e1", modelProbability: 0.64, impliedProbability: 0.56, noVigProbability: 0.54, valueEdge: 0.08, expectedValue: 0.12, decimalOdds: 1.9, confidence: "medium", risk: "medium", dataQuality: 0.88, evidenceQuality: "strong", decisionStatus: "published_value_pick", publicStatus: "value_pick", reason: "Fresh preliminary analysis", generatedAt: GENERATED_AT, expiresAt: freshSnapshot.expiresAt, supersededBy: null, settlementStatus: "pending", isPreliminary: true, provider: "api-football" };
    const input = { scope: "weekly" as const, fixtures: [fixture], oddsByFixture: new Map([[fixture.fixtureId, [freshSnapshot]]]), decisionsByFixture: new Map([[fixture.fixtureId, [preliminaryDecision]]]), decisionSummariesByFixture: new Map([[fixture.fixtureId, decisionSummary(fixture.fixtureId, "value_pick")]]), range: { from: "2026-07-14", to: "2026-07-20" }, providerStatus: "completed" as const };
    expect(buildSportsSlate({ ...input, generatedAt: "2026-07-14T10:30:00.000Z" }).fixtures[0]?.publicStatus).toBe("ready");
    expect(buildSportsSlate({ ...input, generatedAt: "2026-07-14T11:01:00.000Z" }).fixtures[0]?.publicStatus).toBe("stale");
  });

  it("does not expose an expired selection as an active value pick", () => {
    const product = buildDailyTipsProduct(slate([fixtureRow("expired", "value_pick", { expiresAt: "2026-07-14T09:59:00.000Z" })]), { asOf: new Date(GENERATED_AT) });
    expect(product.sections.valuePicks).toHaveLength(0);
    expect(product.sections.watchlist[0]?.publicStatus).toBe("stale");
  });

  it("adds responsible-use copy to every social format", () => {
    const daily = buildDailyTipsProduct(slate([fixtureRow("value", "value_pick")]));
    const weekly = buildWeeklyTipsProduct(slate([fixtureRow("week", "ready")], "weekly"));
    const yesterday = { date: "2026-07-13", generatedAt: GENERATED_AT, source: "live", items: [], summary: { totalPublicPicks: 0, settled: 0, pending: 0, manualReview: 0, wins: 0, losses: 0, pushes: 0, voids: 0, accuracy: 0, roi: 0, averageOdds: 0, averageClosingLineValue: null } } satisfies YesterdayResultsProduct;
    const outputs = [formatDailyTipsForWhatsApp(daily), formatDailyTipsForTelegram(daily), formatValuePickPost(daily.sections.valuePicks[0]), formatWeeklyRadarPost(weekly), formatYesterdayResultsPost(yesterday)];
    for (const output of outputs) expect(output).toMatch(/Responsible use:.*18\+.*never chase losses/i);
  });

  it("keeps certainty-marketing terms out of the new public product copy", () => {
    const publicFiles = ["src/app/page.tsx", "src/app/predictions/today/page.tsx", "src/app/predictions/tomorrow/page.tsx", "src/app/predictions/week/page.tsx", "src/components/odds/DailyTipsPageView.tsx", "src/components/odds/IntelligenceSlate.tsx", "src/components/odds/PredictionDisclaimer.tsx"];
    const copy = publicFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(copy).not.toMatch(/\b(guaranteed|sure|fixed|banker)\b/i);
  });
});
