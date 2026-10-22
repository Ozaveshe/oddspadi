import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider, getRecentSportsProviderIssues } from "@/lib/sports/providers/providerBackedProvider";

describe("provider account failures", () => {
  it("records an HTTP 200 suspension as a provider failure, never a healthy empty slate", async () => {
    const since = new Date().toISOString();
    const history = vi.fn(async () => new Map());
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "test-only", API_FOOTBALL_ODDS_ENABLED: "false", SPORTS_PROVIDER_REQUESTS_PER_MINUTE: "1200" },
      historicalFootballEloLoader: history,
      fetchImpl: async () => Response.json({ errors: { access: "Account suspended" }, response: [] })
    });
    expect(await provider.getFixtures("2026-10-22", "football")).toEqual([]);
    expect(history).not.toHaveBeenCalled();
    expect(getRecentSportsProviderIssues(since).some((issue) => issue.reason.includes("Provider rejected request (access)"))).toBe(true);
  });
});
