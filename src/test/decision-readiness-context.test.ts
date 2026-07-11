import { describe, expect, it } from "vitest";
import { buildDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";

describe("decision readiness context semantics", () => {
  it("marks the full provider context ready when API-Football and licensed news are configured", () => {
    const readiness = buildDecisionEngineReadiness({
      API_FOOTBALL_KEY: "test-football-key",
      NEWS_API_KEY: "test-news-key"
    });

    expect(readiness.dataProviders.groups.find((group) => group.id === "football-standings-lineups")).toMatchObject({
      status: "live-runtime",
      readinessStatus: "ready"
    });
    expect(readiness.dataProviders.groups.find((group) => group.id === "weather-context")).toMatchObject({
      status: "live-runtime",
      readinessStatus: "ready"
    });
    expect(readiness.dataProviders.groups.find((group) => group.id === "news-injury-context")).toMatchObject({
      status: "live-runtime",
      readinessStatus: "ready"
    });
    expect(readiness.checks.find((check) => check.id === "news-live-context")).toMatchObject({ status: "ready" });
  });

  it("keeps only the licensed-news portion in warning when API-Football is otherwise ready", () => {
    const readiness = buildDecisionEngineReadiness({ API_FOOTBALL_KEY: "test-football-key" });

    expect(readiness.dataProviders.groups.find((group) => group.id === "football-standings-lineups")).toMatchObject({
      status: "live-runtime",
      readinessStatus: "ready"
    });
    expect(readiness.dataProviders.groups.find((group) => group.id === "weather-context")).toMatchObject({
      status: "live-runtime",
      readinessStatus: "ready"
    });
    expect(readiness.dataProviders.groups.find((group) => group.id === "news-injury-context")).toMatchObject({
      status: "missing",
      readinessStatus: "warning"
    });
    expect(readiness.checks.find((check) => check.id === "news-live-context")).toMatchObject({ status: "warning" });
  });
});
