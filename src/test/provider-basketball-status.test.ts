import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

describe("API-Basketball fixture status", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps NS Not Started fixtures scheduled instead of matching the embedded ot", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "v1.basketball.api-sports.io") {
        return Response.json({
          response: [{
            id: 501,
            date: { date: "2026-07-16", time: "19:30", timestamp: 1784230200 },
            status: { short: "NS", long: "Not Started" },
            country: { name: "Rwanda", code: "RW", flag: "https://media.api-sports.io/flags/rw.svg" },
            league: { id: 12, name: "Basketball Africa League", season: 2026, logo: "https://media.api-sports.io/basketball/leagues/12.png" },
            teams: {
              home: { id: 101, name: "Lagos Legends", logo: "https://media.api-sports.io/basketball/teams/101.png" },
              away: { id: 102, name: "Kigali Kings", logo: "https://media.api-sports.io/basketball/teams/102.png" }
            },
            scores: { home: { total: null }, away: { total: null } }
          }]
        });
      }
      if (url.hostname === "api.the-odds-api.com") return Response.json([]);
      throw new Error(`Unexpected provider request: ${url.hostname}${url.pathname}`);
    });
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_BASKETBALL_KEY: "basketball-key" },
      fetchImpl,
      historicalBasketballStrengthLoader: async () => new Map()
    });

    const fixtures = await provider.getFixtures("2026-07-16", "basketball");

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      id: "api-basketball:501",
      status: "scheduled",
      score: undefined,
      league: {
        country: "Rwanda",
        logo: "https://media.api-sports.io/basketball/leagues/12.png",
        flag: "https://media.api-sports.io/flags/rw.svg"
      },
      homeTeam: { logo: "https://media.api-sports.io/basketball/teams/101.png" },
      awayTeam: { logo: "https://media.api-sports.io/basketball/teams/102.png" },
      dataSource: { fixtureProvider: "api-basketball", statusDetail: "NS Not Started" }
    });
  });

  it("returns primary fixtures when optional historical strength stalls", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        API_BASKETBALL_KEY: "basketball-key",
        SPORTS_PROVIDER_REQUEST_TIMEOUT_MS: "1000"
      },
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.hostname !== "v1.basketball.api-sports.io") return Response.json([]);
        return Response.json({
          response: [{
            id: 502,
            date: "2026-07-16T20:00:00Z",
            status: { short: "NS", long: "Not Started" },
            country: { name: "USA" },
            league: { id: 17, name: "NBA Summer League", season: 2026 },
            teams: {
              home: { id: 201, name: "Chicago Bulls" },
              away: { id: 202, name: "Washington Wizards" }
            }
          }]
        });
      },
      historicalBasketballStrengthLoader: () => new Promise(() => undefined)
    });

    const fixturesPromise = provider.getFixtures("2026-07-16", "basketball");
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(fixturesPromise).resolves.toMatchObject([
      { id: "api-basketball:502", status: "scheduled", dataSource: { fixtureProvider: "api-basketball" } }
    ]);
  });
});
