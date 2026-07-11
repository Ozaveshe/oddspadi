import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildMatchContextAdjustment } from "@/lib/sports/prediction/contextAdjustment";
import { inspectContextSignal } from "@/lib/sports/prediction/contextSignalPolicy";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";
import { buildPrediction, decisionAllowsPublicPick } from "@/lib/sports/service";
import type { Match, MatchContextSignal } from "@/lib/sports/types";

const NOW = new Date("2026-08-21T12:00:00.000Z");

function providerMatch(match: Match, signals: MatchContextSignal[], status: Match["status"] = "scheduled"): Match {
  return {
    ...match,
    status,
    dataSource: {
      ...match.dataSource,
      kind: "provider",
      fixtureProvider: "api-football",
      fixtureProviderId: "fixture-123",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "odds-123",
      formProvider: "api-football",
      strengthProvider: "api-football"
    },
    providerContextSignals: signals
  };
}

function signal(overrides: Partial<MatchContextSignal> & Pick<MatchContextSignal, "id" | "category" | "source">): MatchContextSignal {
  return {
    id: overrides.id,
    category: overrides.category,
    source: overrides.source,
    label: overrides.label ?? overrides.category,
    detail: overrides.detail ?? "test context",
    quality: overrides.quality ?? "acceptable",
    impact: overrides.impact ?? "neutral",
    confidence: overrides.confidence ?? 0.72,
    weight: overrides.weight ?? 0.02,
    publishedAt: overrides.publishedAt
  };
}

describe("live context signal policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("classifies expired and computed context without granting provider freshness", () => {
    const staleInjury = signal({
      id: "stale-injury",
      category: "injury",
      source: "api-football-injuries",
      publishedAt: "2026-08-20T22:00:00.000Z"
    });
    const computedWeather = signal({
      id: "computed-weather",
      category: "weather",
      source: "computed-weather-window",
      publishedAt: NOW.toISOString()
    });

    expect(inspectContextSignal(staleInjury, { now: NOW, requireTimestamp: true })).toMatchObject({ status: "stale", freshness: "stale" });
    expect(inspectContextSignal(computedWeather, { now: NOW, requireTimestamp: true })).toMatchObject({
      status: "computed",
      freshness: "pre-match"
    });
  });

  it("keeps stale and computed provider context out of probability shifts and required-context satisfaction", async () => {
    const [base] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const match = providerMatch(base, [
      signal({
        id: "stale-home-injury",
        category: "injury",
        source: "api-football-injuries",
        impact: "home-negative",
        publishedAt: "2026-08-20T22:00:00.000Z"
      }),
      signal({
        id: "computed-weather",
        category: "weather",
        source: "computed-weather-window",
        impact: "tempo-down",
        publishedAt: NOW.toISOString()
      })
    ]);

    const adjustment = buildMatchContextAdjustment(match);

    expect(adjustment.applied).toBe(false);
    expect(adjustment.probabilityShift).toEqual({ home: 0, draw: 0, away: 0 });
    expect(adjustment.totalShift).toBe(0);
    expect(adjustment.dataQualityDelta).toBeLessThan(0);
    expect(adjustment.missingSignals).toEqual(expect.arrayContaining(["Injury and suspension news", "Weather check"]));
  });

  it("does not append a synthetic live-event signal to a live provider fixture", async () => {
    const [base] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const adjustment = buildMatchContextAdjustment(providerMatch(base, [], "live"));

    expect(adjustment.signals).toEqual([]);
    expect(adjustment.missingSignals).toContain("Live event stream");
  });

  it("keeps stale provider evidence out of the football xG context and blocks computed weather from public action", async () => {
    const [base] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const staleMatch = providerMatch(base, [
      signal({
        id: "stale-away-injury",
        category: "injury",
        source: "api-football-injuries",
        impact: "away-negative",
        publishedAt: "2026-08-20T22:00:00.000Z"
      })
    ]);
    const staleModel = modelFootballMatch(staleMatch);
    const contextScore = staleModel.diagnostics.signalScores.find((item) => item.label === "Provider football context xG");
    expect(contextScore?.value).toBe(0);

    const computedWeatherMatch = providerMatch(base, [
      signal({
        id: "computed-weather",
        category: "weather",
        source: "computed-weather-window",
        publishedAt: NOW.toISOString()
      })
    ]);
    const prediction = buildPrediction(computedWeatherMatch);
    const weather = prediction.decision.dataCoverage.signals.find((item) => item.id === "weather");
    expect(weather).toMatchObject({ status: "computed", requiredForProduction: true });
    expect(prediction.decision.dataCoverage.requiredBeforeTrust.join(" ")).toContain("Weather");

    const otherwiseReady = {
      ...prediction.decision,
      action: "consider" as const,
      calibration: { ...prediction.decision.calibration, action: "trust" as const },
      actionability: { ...prediction.decision.actionability, status: "actionable" as const },
      abstentionRules: prediction.decision.abstentionRules.map((rule) => ({ ...rule, triggered: false })),
      dataCoverage: {
        ...prediction.decision.dataCoverage,
        signals: prediction.decision.dataCoverage.signals.map((item) =>
          item.id === "weather" ? item : { ...item, status: "provider-backed" as const }
        )
      }
    };

    expect(decisionAllowsPublicPick(otherwiseReady)).toBe(false);
  });
});
