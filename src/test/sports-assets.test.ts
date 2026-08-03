import { describe, expect, it } from "vitest";
import { parseSportsAssetQuery, usableSportsAssetUrl } from "@/lib/sports/assets";

function request(query = ""): Request {
  return new Request(`https://oddspadi.example/api/sports/assets${query ? `?${query}` : ""}`);
}

describe("sports asset catalogue", () => {
  it("defaults to a bounded first page of logo-bearing teams", () => {
    expect(parseSportsAssetQuery(request())).toEqual({
      kind: "team",
      page: 1,
      limit: 50,
      hasLogo: true
    });
  });

  it("accepts league, sport, provider, lookup, search, and paging filters", () => {
    expect(parseSportsAssetQuery(request("kind=league&sport=football&provider=api-football&externalId=api-football%3A39&q=Premier&page=2&limit=25&hasLogo=false"))).toEqual({
      kind: "league",
      sport: "football",
      provider: "api-football",
      externalId: "api-football:39",
      query: "Premier",
      page: 2,
      limit: 25,
      hasLogo: false
    });
  });

  it("rejects filters that could create unbounded scans or cache keys", () => {
    for (const query of [
      "kind=player",
      "sport=quidditch",
      "provider=api%20football",
      "q=a",
      "q=%25%25",
      "page=0",
      "page=501",
      "limit=101",
      "hasLogo=maybe"
    ]) {
      expect(parseSportsAssetQuery(request(query))).toHaveProperty("error");
    }
  });

  it("publishes only absolute HTTPS artwork URLs", () => {
    expect(usableSportsAssetUrl("https://media.api-sports.io/football/teams/33.png")).toBe("https://media.api-sports.io/football/teams/33.png");
    expect(usableSportsAssetUrl("http://example.com/logo.png")).toBeNull();
    expect(usableSportsAssetUrl("javascript:alert(1)")).toBeNull();
    expect(usableSportsAssetUrl("/local/path.svg")).toBeNull();
  });
});
