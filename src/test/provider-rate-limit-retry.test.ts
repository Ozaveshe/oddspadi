import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match, SportsDataProvider } from "@/lib/sports/types";

const fixedNow = new Date("2026-08-21T12:00:00.000Z");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function rateLimited(retryAfterSeconds?: number): Response {
  return new Response("Too Many Requests", {
    status: 429,
    headers: retryAfterSeconds == null ? {} : { "Retry-After": String(retryAfterSeconds) }
  });
}

function fallbackProvider(fixtures: Match[] = []): SportsDataProvider {
  return {
    getFixtures: vi.fn(async () => fixtures),
    getMatch: vi.fn(async () => null),
    getLiveScores: vi.fn(async () => []),
    getOdds: vi.fn(async () => []),
    getTeamForm: vi.fn(async (teamId) => ({
      teamId,
      recentResults: [],
      goalsFor: 0,
      goalsAgainst: 0,
      attackStrength: 1,
      defenseStrength: 1
    }))
  };
}

function fixture(id: number, kickoff: string, status: string, homeId: number, awayId: number) {
  return {
    fixture: { id, date: kickoff, status: { short: status } },
    league: { id: 39, name: "Premier League", country: "England", season: 2026 },
    teams: {
      home: { id: homeId, name: `Home ${homeId}` },
      away: { id: awayId, name: `Away ${awayId}` }
    },
    goals: { home: null, away: null }
  };
}

describe("API-Football rate limit handling", () => {
  it("retries a 429 slate request instead of publishing an empty board", async () => {
    let slateAttempts = 0;
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        API_FOOTBALL_KEY: "football-key",
        // Keep the bucket wide so the test exercises retry, not pacing.
        SPORTS_PROVIDER_REQUESTS_PER_MINUTE: "1200"
      },
      now: () => fixedNow,
      fallback: fallbackProvider(),
      historicalFootballEloLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.hostname !== "v3.football.api-sports.io") return new Response("not found", { status: 404 });
        if (url.pathname === "/fixtures" && url.searchParams.has("date")) {
          slateAttempts += 1;
          // First call is rate limited; a correct client waits and asks again.
          if (slateAttempts === 1) return rateLimited(0);
          return jsonResponse({ response: [fixture(2001, "2026-08-21T15:00:00Z", "NS", 7, 8)] });
        }
        if (url.pathname === "/fixtures" && url.searchParams.has("team")) return jsonResponse({ response: [] });
        if (url.pathname === "/standings") return jsonResponse({ response: [] });
        if (["/fixtures/lineups", "/injuries", "/fixtures/events"].includes(url.pathname)) {
          return jsonResponse({ response: [] });
        }
        return new Response("not found", { status: 404 });
      }
    });

    const matches = await provider.getFixtures("2026-08-21", "football");

    expect(slateAttempts).toBe(2);
    expect(matches).toHaveLength(1);
  });

  it("falls back once the retry budget is spent rather than retrying forever", async () => {
    let attempts = 0;
    const fallbackFixtures = [{ id: "fallback:fixture" } as Match];
    const fallback = fallbackProvider(fallbackFixtures);
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        API_FOOTBALL_KEY: "football-key",
        SPORTS_PROVIDER_REQUESTS_PER_MINUTE: "1200",
        SPORTS_PROVIDER_RATE_LIMIT_RETRIES: "1"
      },
      now: () => fixedNow,
      fallback,
      fetchImpl: async () => {
        attempts += 1;
        return rateLimited(0);
      }
    });

    await expect(provider.getFixtures("2026-08-21", "football")).resolves.toBe(fallbackFixtures);
    // One initial attempt plus exactly one configured retry.
    expect(attempts).toBe(2);
  });
});
