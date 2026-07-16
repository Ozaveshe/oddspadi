import { describe, expect, it } from "vitest";
import { deriveHomepageMatchdayState, getWeeklyEmptyState } from "@/lib/sports/homepageState";
import type { LiveBoardFixture, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import type { DailyTipsProduct } from "@/lib/sports/tips/product";

function fixture(id: string, phase: LiveBoardFixture["phase"]): LiveBoardFixture {
  return {
    id,
    sport: "basketball",
    matchId: id,
    kickoff: "2026-07-16T12:00:00.000Z",
    phase,
    statusShort: phase === "live" ? "Q2" : "NS",
    statusLabel: phase === "live" ? "Q2" : "Not started",
    elapsed: null,
    league: { id: 1, name: "BAL", country: "Africa", logo: null, flag: null, round: null },
    home: { id: 1, name: "Lagos", logo: null, winner: null },
    away: { id: 2, name: "Dakar", logo: null, winner: null },
    goals: { home: null, away: null },
    analysis: false
  };
}

describe("homepage matchday resilience", () => {
  it("keeps live-board coverage visible without counting it as prediction-ready", () => {
    const board: LiveScoreBoard = {
      generatedAt: "2026-07-16T10:30:00.000Z",
      date: "2026-07-16",
      source: "multi-provider",
      counts: { live: 1, upcoming: 1, finished: 0, other: 0 },
      sportCounts: { football: 0, basketball: 2, tennis: 0 },
      availableSports: ["basketball"],
      fixtures: [fixture("live-1", "live"), fixture("next-1", "upcoming")]
    };

    const state = deriveHomepageMatchdayState(null, board);

    expect(state.fixtureCount).toBe(0);
    expect(state.liveBoardFixtureCount).toBe(2);
    expect(state.providerState).toBe("unavailable");
    expect(state.providerLabel).toBe("unavailable");
    expect(state.sourceLabel).toBe("Prediction engine");
    expect(state.featuredFixture?.id).toBe("live-1");
    expect(state.previewFixtures).toHaveLength(2);
    expect(state.lastUpdatedAt).toBeNull();
  });

  it("does not invent matchday coverage when both sources are empty", () => {
    const state = deriveHomepageMatchdayState(null, null);
    expect(state.fixtureCount).toBe(0);
    expect(state.usesLiveFallback).toBe(false);
    expect(state.featuredFixture).toBeNull();
    expect(state.providerState).toBe("unavailable");
  });

  it.each(["upcoming", "finished"] as const)("keeps %s-only coverage distinct from live coverage", (phase) => {
    const board: LiveScoreBoard = {
      generatedAt: "2026-07-16T10:30:00.000Z",
      date: "2026-07-16",
      source: "multi-provider",
      counts: { live: 0, upcoming: phase === "upcoming" ? 1 : 0, finished: phase === "finished" ? 1 : 0, other: 0 },
      sportCounts: { football: 0, basketball: 1, tennis: 0 },
      availableSports: ["basketball"],
      fixtures: [fixture(`${phase}-1`, phase)]
    };

    const state = deriveHomepageMatchdayState(null, board);

    expect(state.featuredFixture?.phase).toBe(phase);
    expect(state.liveCount).toBe(0);
    expect(state.fixtureCount).toBe(0);
    expect(state.liveBoardFixtureCount).toBe(1);
  });

  it("keeps engine totals separate from a simultaneously available live board", () => {
    const daily = {
      summary: { fixturesFound: 4, fixturesAnalysed: 3, valuePicks: 1, watchlist: 1 },
      slate: { provider: { status: "running", lastRun: null } }
    } as DailyTipsProduct;
    const board = {
      generatedAt: "2026-07-16T10:30:00.000Z",
      fixtures: [fixture("live-1", "live")]
    } as LiveScoreBoard;

    const state = deriveHomepageMatchdayState(daily, board);

    expect(state.fixtureCount).toBe(4);
    expect(state.liveBoardFixtureCount).toBe(1);
    expect(state.liveCount + state.upcomingCount + state.finishedCount).toBe(0);
    expect(state.providerState).toBe("running");
    expect(state.usesLiveFallback).toBe(false);
  });

  it("describes a completed empty week without claiming an outage or live coverage", () => {
    expect(getWeeklyEmptyState("completed", false)).toEqual({
      title: "No weekly fixtures are published yet",
      detail: "The current seven-day schedule is empty. OddsPadi will not fill it with sample fixtures.",
      showLiveLink: false
    });
  });
});
