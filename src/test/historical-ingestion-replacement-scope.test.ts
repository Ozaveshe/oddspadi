import { describe, expect, it } from "vitest";
import { parseHistoricalFootballIngestPayload } from "@/lib/sports/training/historicalIngestion";

const fixture = {
  externalId: "fixture-1",
  kickoffAt: "2025-08-15T19:00:00.000Z",
  league: { externalId: "39", name: "Premier League" },
  homeTeam: { externalId: "1", name: "Home" },
  awayTeam: { externalId: "2", name: "Away" },
  status: "finished" as const,
  homeScore: 1,
  awayScore: 0
};

describe("historical ingestion replacement scope", () => {
  it("preserves an explicit core-fixture-only refresh", () => {
    const parsed = parseHistoricalFootballIngestPayload({ provider: "api_football", fixtures: [fixture], replaceChildDatasets: [] });
    expect("errors" in parsed).toBe(false);
    if (!("errors" in parsed)) expect(parsed.replaceChildDatasets).toEqual([]);
  });

  it("keeps full replacement as the legacy default for direct imports", () => {
    const parsed = parseHistoricalFootballIngestPayload({ provider: "api_football", fixtures: [fixture] });
    expect("errors" in parsed).toBe(false);
    if (!("errors" in parsed)) expect(parsed.replaceChildDatasets).toEqual(["odds", "events", "news", "standings", "availability", "lineups", "weather"]);
  });

  it("rejects unknown replacement datasets", () => {
    const parsed = parseHistoricalFootballIngestPayload({
      provider: "api_football",
      fixtures: [fixture],
      replaceChildDatasets: ["events", "invented"]
    } as never);
    expect("errors" in parsed ? parsed.errors : []).toContain("replaceChildDatasets contains unsupported dataset invented.");
  });

  it("rejects a non-array replacement scope without throwing", () => {
    const parsed = parseHistoricalFootballIngestPayload({
      provider: "api_football",
      fixtures: [fixture],
      replaceChildDatasets: "events"
    } as never);
    expect("errors" in parsed ? parsed.errors : []).toContain("replaceChildDatasets must be an array when provided.");
  });
});
