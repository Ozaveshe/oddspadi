import { describe, expect, it } from "vitest";
import {
  getSportsProviderRuntimeStatus,
  ProviderBackedSportsDataProvider
} from "@/lib/sports/providers/providerBackedProvider";

function emptyJsonResponse(): Response {
  return new Response(JSON.stringify({ response: [] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("provider fallback in deployed Netlify contexts", () => {
  it.each(["branch-deploy", "deploy-preview"])(
    "keeps %s honest-empty when the configured provider returns no fixtures",
    async (context) => {
      const provider = new ProviderBackedSportsDataProvider({
        env: { CONTEXT: context, API_BASKETBALL_KEY: "basketball-key" },
        fetchImpl: async () => emptyJsonResponse(),
        historicalBasketballStrengthLoader: async () => new Map()
      });

      await expect(provider.getFixtures("2026-07-18", "basketball")).resolves.toEqual([]);
    }
  );

  it("reports an unconfigured branch deploy as unavailable, not mock-backed", () => {
    expect(getSportsProviderRuntimeStatus({ CONTEXT: "branch-deploy" }).runtimeProvider).toBe("unavailable");
  });

  it("preserves mock fallback for a local development runtime", async () => {
    const provider = new ProviderBackedSportsDataProvider({
      env: { NODE_ENV: "development", API_BASKETBALL_KEY: "basketball-key" },
      fetchImpl: async () => emptyJsonResponse(),
      historicalBasketballStrengthLoader: async () => new Map()
    });

    const fixtures = await provider.getFixtures("2026-07-18", "basketball");
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.every((fixture) => fixture.dataSource?.fixtureProvider === "mockSportsDataProvider")).toBe(true);
  });
});
