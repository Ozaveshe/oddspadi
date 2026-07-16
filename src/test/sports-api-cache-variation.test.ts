import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchLiveScoreBoard: vi.fn(),
  getPredictions: vi.fn(),
  getValuePicks: vi.fn(),
  getFixtures: vi.fn()
}));

vi.mock("@/lib/sports/liveScoreBoard", () => ({
  fetchLiveScoreBoard: mocks.fetchLiveScoreBoard
}));

vi.mock("@/lib/sports/service", () => ({
  getPredictions: mocks.getPredictions,
  getValuePicks: mocks.getValuePicks,
  sportsProvider: { getFixtures: mocks.getFixtures },
  isSupportedSport: (sport: string) => ["football", "basketball", "tennis"].includes(sport),
  todayIsoDate: () => "2026-07-16"
}));

import { GET as getLive } from "@/app/api/live/route";
import { GET as getFixtures } from "@/app/api/sports/fixtures/route";
import { GET as getPredictions } from "@/app/api/sports/predictions/route";
import { GET as getValuePicks } from "@/app/api/sports/value-picks/route";
import { publicCacheInit } from "@/app/api/sports/_utils";

describe("sports API cache variation", () => {
  beforeEach(() => {
    mocks.fetchLiveScoreBoard.mockResolvedValue({
      generatedAt: "2026-07-16T04:00:00.000Z",
      date: "2026-07-17",
      source: "none",
      counts: { live: 0, upcoming: 0, finished: 0, other: 0 },
      sportCounts: { football: 0, basketball: 0, tennis: 0 },
      availableSports: [],
      fixtures: []
    });
    mocks.getPredictions.mockResolvedValue([]);
    mocks.getValuePicks.mockResolvedValue([]);
    mocks.getFixtures.mockResolvedValue([]);
  });

  it("varies a shared public cache only by declared query keys", () => {
    const headers = new Headers(publicCacheInit(60, ["date", "sport"]).headers);
    expect(headers.get("Netlify-Vary")).toBe("query=date|sport");
    expect(headers.get("Cache-Control")).toContain("s-maxage=60");
  });

  it("keeps live boards isolated by date", async () => {
    const response = await getLive(new Request("https://oddspadi.com/api/live?date=2026-07-17"));
    expect(mocks.fetchLiveScoreBoard).toHaveBeenCalledWith("2026-07-17");
    expect(response.headers.get("Netlify-Vary")).toBe("query=date");
  });

  it("keeps fixture and value-pick payloads isolated by date and sport", async () => {
    const requestUrl = "https://oddspadi.com/api/sports/fixtures?date=2026-07-17&sport=basketball";
    const fixtureResponse = await getFixtures(new Request(requestUrl));
    const valueResponse = await getValuePicks(new Request(requestUrl.replace("fixtures", "value-picks")));
    expect(fixtureResponse.headers.get("Netlify-Vary")).toBe("query=date|sport");
    expect(valueResponse.headers.get("Netlify-Vary")).toBe("query=date|sport");
  });

  it("keeps every prediction filter and response view in the cache key", async () => {
    const response = await getPredictions(new Request(
      "https://oddspadi.com/api/sports/predictions?date=2026-07-17&sport=football&confidence=high&league=MLS&country=USA&q=Miami&publicHistory=true&view=summary"
    ));
    expect(response.headers.get("Netlify-Vary")).toBe(
      "query=date|sport|confidence|league|country|q|publicHistory|historical|view"
    );
  });
});
