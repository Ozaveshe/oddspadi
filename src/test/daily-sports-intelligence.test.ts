import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match, Prediction, ValueEdge } from "@/lib/sports/types";
import { buildUnavailableCaseMemoryBank } from "@/lib/sports/service";
import { buildCanonicalDecision, oddsSnapshotsFromMatch } from "@/lib/sports/prediction/canonicalDecision";
import {
  buildCanonicalDecisions,
  buildSportsSlate,
  normalizeCanonicalFixture,
  normalizeOddsSnapshots,
  utcDateWindow
} from "@/lib/sports/intelligence/canonical";
import { classifyProviderRunStatus, productionPredictionFilters, runDailyEngine } from "@/lib/sports/intelligence/pipeline";
import type { CanonicalDecision, CanonicalFixture, SlatePublicStatus } from "@/lib/sports/intelligence/types";

async function providerMatch({
  id = "api-football:9001",
  kickoffTime = "2026-07-13T18:00:00.000Z",
  oddsCapturedAt = "2026-07-13T12:00:00.000Z"
}: {
  id?: string;
  kickoffTime?: string;
  oddsCapturedAt?: string;
} = {}): Promise<Match> {
  const [base] = await mockSportsDataProvider.getFixtures(kickoffTime.slice(0, 10), "football");
  return {
    ...base,
    id,
    kickoffTime,
    dataQualityScore: 0.9,
    dataSource: {
      kind: "provider",
      fixtureProvider: "api-football",
      fixtureProviderId: id.replace("api-football:", ""),
      oddsProvider: "the-odds-api",
      oddsProviderEventId: `odds-${id}`,
      oddsCapturedAt,
      fetchedAt: oddsCapturedAt,
      season: "2026"
    }
  };
}

function predictionFor(match: Match, edgeOverrides: Partial<ValueEdge> = {}, action: "consider" | "monitor" | "avoid" = "consider"): Prediction {
  const edge: ValueEdge = {
    marketId: "match_winner",
    selectionId: "home",
    label: match.homeTeam.name,
    modelProbability: 0.62,
    rawImpliedProbability: 0.52,
    noVigImpliedProbability: 0.5,
    impliedProbability: 0.5,
    bookmakerMargin: 0.05,
    edge: 0.12,
    expectedValue: 0.18,
    expectedRoi: 0.18,
    odds: match.oddsMarkets[0]?.selections.find((selection) => selection.id === "home")?.decimalOdds ?? 1.9,
    confidence: "medium",
    risk: "medium",
    ...edgeOverrides
  };
  const decisionReport = {
    engineVersion: "test-engine-v1",
    action,
    verdict: action === "consider" ? "strong-value" : action === "monitor" ? "lean-value" : "avoid",
    confidence: edge.confidence,
    risk: edge.risk,
    calibration: { action: "trust" },
    actionability: { status: "actionable" },
    abstentionRules: [],
    dataCoverage: { signals: [] }
  } as unknown as Prediction["decision"];
  const canonicalDecision = buildCanonicalDecision(
    match,
    oddsSnapshotsFromMatch(match, new Date("2026-07-13T12:00:00.000Z")),
    {
      valueEdges: [edge],
      diagnostics: { dataQualityScore: match.dataQualityScore },
      decision: decisionReport,
      generatedAt: "2026-07-13T12:00:00.000Z"
    },
    [],
    { now: new Date("2026-07-13T12:05:00.000Z") }
  );
  return {
    matchId: match.id,
    sport: match.sport,
    generatedAt: "2026-07-13T12:00:00.000Z",
    evidenceHash: "decision-evidence-v1:daily-intelligence-test",
    markets: [{ marketId: "match_winner", probabilities: { home: 0.62, draw: 0.21, away: 0.17 } }],
    diagnostics: { modelVersion: "test-model-v1" } as Prediction["diagnostics"],
    contextAdjustment: {} as Prediction["contextAdjustment"],
    marketPriorAdjustment: {} as Prediction["marketPriorAdjustment"],
    valueEdges: [edge],
    canonicalDecision,
    bestPick: { ...edge, hasValue: true },
    confidence: edge.confidence,
    risk: edge.risk,
    explanation: {} as Prediction["explanation"],
    agentReport: {} as Prediction["agentReport"],
    decision: decisionReport
  };
}

function decision(fixtureId: string, publicStatus: SlatePublicStatus, generatedAt = "2026-07-13T12:00:00.000Z"): CanonicalDecision {
  return {
    decisionId: `${fixtureId}-${publicStatus}`,
    fixtureId,
    market: "match_winner",
    selection: "home",
    label: "Home",
    oddsSnapshotId: null,
    modelVersion: "test-model-v1",
    engineVersion: "test-engine-v1",
    modelProbability: 0.55,
    impliedProbability: 0.5,
    noVigProbability: 0.49,
    valueEdge: publicStatus === "value_pick" ? 0.06 : 0,
    expectedValue: publicStatus === "value_pick" ? 0.1 : 0,
    decimalOdds: 2,
    confidence: "medium",
    risk: "medium",
    dataQuality: 0.9,
    evidenceQuality: "strong",
    decisionStatus: publicStatus === "value_pick" ? "published_value_pick" : publicStatus === "lean" ? "published_lean" : publicStatus === "watchlist" ? "watchlist" : "avoid",
    publicStatus,
    reason: "Test decision",
    generatedAt,
    expiresAt: null,
    supersededBy: null,
    settlementStatus: "pending",
    isPreliminary: publicStatus === "preliminary",
    provider: "api-football"
  };
}

describe("production daily sports intelligence", () => {
  it("keeps promoted historical learning enabled for scheduled predictions", () => {
    expect(productionPredictionFilters("2026-07-13", "football")).toEqual({
      date: "2026-07-13",
      sport: "football",
      providerMode: "live",
      storageMode: "live"
    });
  });

  it("reports a failed case-memory read instead of silently treating it as unconfigured", () => {
    expect(buildUnavailableCaseMemoryBank("network timeout")).toMatchObject({
      status: "failed",
      configured: true,
      runs: [],
      reason: "Could not read decision case memory: network timeout"
    });
  });

  it("preserves partial and empty provider health instead of reporting success", async () => {
    const fixture = normalizeCanonicalFixture(await providerMatch());
    const env = { API_FOOTBALL_KEY: "configured" };

    expect(classifyProviderRunStatus({ fixtures: [fixture], errors: ["tennis odds unavailable"], env })).toBe("partial");
    expect(classifyProviderRunStatus({ fixtures: [], errors: [], env })).toBe("empty");
    expect(classifyProviderRunStatus({ fixtures: [], errors: ["provider failed"], env })).toBe("failed");
  });

  it("does not persist a provider fixture as live hours before kickoff", async () => {
    const now = new Date("2026-07-15T01:45:00.000Z");
    const futureLive = {
      ...(await providerMatch({ kickoffTime: "2026-07-15T07:00:00.000Z" })),
      status: "live" as const
    };

    expect(normalizeCanonicalFixture(futureLive, now).status).toBe("scheduled");
    expect(normalizeCanonicalFixture({ ...futureLive, kickoffTime: "2026-07-15T01:50:00.000Z" }, now).status).toBe("live");
  });

  it("blocks mock fallback fixtures in production public reads", async () => {
    const provider = new ProviderBackedSportsDataProvider({ env: { NODE_ENV: "production" } });
    expect(await provider.getFixtures("2026-07-13", "football")).toEqual([]);

    const mockFixture = { ...(await normalizeCanonicalFixture(await providerMatch())), provider: "mockSportsDataProvider" };
    const slate = buildSportsSlate({
      scope: "daily",
      fixtures: [mockFixture],
      oddsByFixture: new Map(),
      decisionsByFixture: new Map(),
      decisionSummariesByFixture: new Map(),
      range: { from: "2026-07-13", to: "2026-07-13" },
      providerStatus: "completed"
    });
    expect(slate.fixtures).toEqual([]);
  });

  it("flows a provider-backed fixture through the daily prediction pipeline", async () => {
    const match = await providerMatch();
    const prediction = predictionFor(match);
    const result = await runDailyEngine({
      now: new Date("2026-07-13T12:05:00.000Z"),
      sports: ["football"],
      persist: false,
      env: { NODE_ENV: "test", API_FOOTBALL_KEY: "configured" },
      dependencies: {
        getFixtures: async () => [match],
        getPredictions: async () => [{ match, prediction }]
      }
    });
    expect(result.slate.summary.fixturesFound).toBe(1);
    expect(result.slate.summary.predictionsGenerated).toBe(1);
    expect(result.slate.fixtures[0]?.fixture.providerFixtureId).toBe("9001");
    expect(result.rejectedMockFixtures).toBe(0);
  });

  it("publishes a fresh positive-edge, positive-EV selection as a value pick", async () => {
    const now = new Date("2026-07-13T12:05:00.000Z");
    const match = await providerMatch();
    const decisions = buildCanonicalDecisions(match, predictionFor(match), normalizeOddsSnapshots(match, now, 30), { now });
    const home = decisions.find((row) => row.market === "match_winner" && row.selection === "home");
    expect(home?.decisionStatus).toBe("published_value_pick");
    expect(home?.publicStatus).toBe("value_pick");
  });

  it("marks an expired odds decision stale instead of publishing it", async () => {
    const now = new Date("2026-07-13T13:01:00.000Z");
    const match = await providerMatch({ oddsCapturedAt: "2026-07-13T12:00:00.000Z" });
    const decisions = buildCanonicalDecisions(match, predictionFor(match), normalizeOddsSnapshots(match, now, 30), { now });
    expect(decisions.find((row) => row.selection === "home")?.publicStatus).toBe("stale");
  });

  it("downgrades a stored value pick when its supporting price expires", async () => {
    const match = await providerMatch();
    const fixture = normalizeCanonicalFixture(match);
    const expiredValue = {
      ...decision(fixture.fixtureId, "value_pick"),
      expiresAt: "2026-07-13T12:15:00.000Z"
    };
    const storedSummary = predictionFor(match).canonicalDecision;
    const expiredSummary = {
      ...storedSummary,
      expiresAt: "2026-07-13T12:15:00.000Z",
      allMarketAnalyses: storedSummary.allMarketAnalyses.map((analysis) => ({ ...analysis, expiresAt: "2026-07-13T12:15:00.000Z" }))
    };
    const slate = buildSportsSlate({
      scope: "daily",
      fixtures: [fixture],
      oddsByFixture: new Map(),
      decisionsByFixture: new Map([[fixture.fixtureId, [expiredValue]]]),
      decisionSummariesByFixture: new Map([[fixture.fixtureId, expiredSummary]]),
      range: { from: "2026-07-13", to: "2026-07-13" },
      providerStatus: "completed",
      generatedAt: "2026-07-13T12:16:00.000Z"
    });
    expect(slate.fixtures[0]?.publicStatus).toBe("stale");
    expect(slate.summary.valuePicksPublished).toBe(0);
  });

  it("never upgrades a negative-edge decision to a value pick", async () => {
    const now = new Date("2026-07-13T12:05:00.000Z");
    const match = await providerMatch();
    const prediction = predictionFor(match, { edge: -0.04, expectedValue: -0.08, expectedRoi: -0.08 }, "avoid");
    const decisions = buildCanonicalDecisions(match, prediction, normalizeOddsSnapshots(match, now, 30), { now });
    expect(decisions.some((row) => row.publicStatus === "value_pick")).toBe(false);
    expect(decisions.find((row) => row.selection === "home")?.decisionStatus).toBe("avoid");
  });

  it("groups a daily slate into value, lean, watchlist, analysed and no-pick sections", async () => {
    const matches = await Promise.all([
      providerMatch({ id: "api-football:1" }),
      providerMatch({ id: "api-football:2" }),
      providerMatch({ id: "api-football:3" }),
      providerMatch({ id: "api-football:4" })
    ]);
    const fixtures = matches.map((match) => normalizeCanonicalFixture(match));
    const statuses: SlatePublicStatus[] = ["value_pick", "lean", "watchlist", "no_clear_value"];
    const decisionsByFixture = new Map(fixtures.map((fixture, index) => [fixture.fixtureId, [decision(fixture.fixtureId, statuses[index])]]));
    const predictions = [
      predictionFor(matches[0]),
      predictionFor(matches[1], { edge: 0.02, expectedValue: 0.02, expectedRoi: 0.02 }),
      predictionFor(matches[2], { confidence: "low" }),
      predictionFor(matches[3], { edge: -0.03, expectedValue: -0.04, expectedRoi: -0.04 }, "avoid")
    ];
    const decisionSummariesByFixture = new Map(predictions.map((prediction) => [prediction.matchId, prediction.canonicalDecision]));
    const slate = buildSportsSlate({ scope: "daily", fixtures, oddsByFixture: new Map(), decisionsByFixture, decisionSummariesByFixture, range: { from: "2026-07-13", to: "2026-07-13" }, providerStatus: "completed", generatedAt: "2026-07-13T12:05:00.000Z" });
    expect(slate.groups.valuePicks).toHaveLength(1);
    expect(slate.groups.leans).toHaveLength(1);
    expect(slate.groups.watchlist).toHaveLength(1);
    expect(slate.groups.allAnalysed).toHaveLength(4);
    expect(slate.groups.noPicks).toHaveLength(1);
  });

  it("groups exactly the next seven UTC dates on the weekly slate", async () => {
    const dates = utcDateWindow(new Date("2026-07-13T08:00:00.000Z"), 7);
    const fixtures: CanonicalFixture[] = await Promise.all(
      dates.map(async (date, index) => normalizeCanonicalFixture(await providerMatch({ id: `api-football:${100 + index}`, kickoffTime: `${date}T18:00:00.000Z` })))
    );
    const decisionsByFixture = new Map(fixtures.map((fixture) => [fixture.fixtureId, [decision(fixture.fixtureId, "preliminary")]]));
    const decisionSummariesByFixture = new Map((await Promise.all(dates.map(async (date, index) => providerMatch({ id: `api-football:${100 + index}`, kickoffTime: `${date}T18:00:00.000Z` })))).map((match) => [match.id, predictionFor(match).canonicalDecision]));
    const slate = buildSportsSlate({ scope: "weekly", fixtures, oddsByFixture: new Map(), decisionsByFixture, decisionSummariesByFixture, range: { from: dates[0], to: dates.at(-1) as string }, providerStatus: "completed" });
    expect(slate.groupedByDate.map((group) => group.date)).toEqual(dates);
    expect(slate.groupedByDate.every((group) => group.fixtures.length === 1)).toBe(true);
  });
});
