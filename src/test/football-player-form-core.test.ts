import { describe, expect, it } from "vitest";

import { buildMatchContextAdjustment, coreModelContextCategories } from "@/lib/sports/prediction/contextAdjustment";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import type { Match, MatchContextSignal } from "@/lib/sports/types";

function winnerHomeProbability(result: ReturnType<typeof modelFootballMatch>): number {
  return result.markets.find((market) => market.marketId === "match_winner")!.probabilities.home!;
}

describe("football player-form core model", () => {
  it("moves fresh player form into expected-goals math exactly once and rejects stale evidence", async () => {
    const [fixture] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const now = new Date("2026-08-21T12:00:00.000Z");
    const baselineMatch: Match = {
      ...fixture,
      providerContextSignals: [],
      dataSource: {
        ...fixture.dataSource,
        kind: "provider",
        fixtureProvider: "test-provider",
        fixtureProviderId: fixture.id
      }
    };
    const playerForm: MatchContextSignal = {
      id: `${fixture.id}-player-form`,
      category: "player-form",
      label: `${fixture.homeTeam.name} player-performance edge`,
      detail: "Five earlier fixtures supply minute-weighted player ratings and contribution evidence.",
      quality: "strong",
      impact: "home-positive",
      confidence: 0.76,
      weight: 0.018,
      source: "supabase-player-performance",
      publishedAt: "2026-08-20T18:00:00.000Z"
    };
    const freshMatch: Match = { ...baselineMatch, providerContextSignals: [playerForm] };
    const staleMatch: Match = {
      ...baselineMatch,
      providerContextSignals: [{ ...playerForm, publishedAt: "2026-06-01T18:00:00.000Z" }]
    };

    const baseline = modelFootballMatch(baselineMatch, { now });
    const fresh = modelFootballMatch(freshMatch, { now });
    const stale = modelFootballMatch(staleMatch, { now });
    const residualContext = buildMatchContextAdjustment(freshMatch, {
      probabilityHandledCategories: coreModelContextCategories(freshMatch),
      now
    });

    expect(fresh.diagnostics.modelVersion).toBe("football-poisson-v3");
    expect(fresh.diagnostics.expectedGoals.home).toBeGreaterThan(baseline.diagnostics.expectedGoals.home);
    expect(fresh.diagnostics.expectedGoals.away).toBeLessThan(baseline.diagnostics.expectedGoals.away);
    expect(winnerHomeProbability(fresh)).toBeGreaterThan(winnerHomeProbability(baseline));
    expect(fresh.diagnostics.signalScores.find((signal) => signal.label === "Provider football context xG")?.note).toContain("player-form");

    expect(residualContext.signals).toEqual([playerForm]);
    expect(residualContext.applied).toBe(false);
    expect(residualContext.probabilityShift).toMatchObject({ home: 0, draw: 0, away: 0 });
    expect(residualContext.summary).toContain("core sport math already consumed");

    expect(stale.diagnostics.expectedGoals).toEqual(baseline.diagnostics.expectedGoals);
    expect(winnerHomeProbability(stale)).toBe(winnerHomeProbability(baseline));
  });
});
