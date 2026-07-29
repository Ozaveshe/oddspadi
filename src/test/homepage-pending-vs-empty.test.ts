import { describe, expect, it } from "vitest";
import { deriveHomepageMatchdayState, getWeeklyEmptyState } from "@/lib/sports/homepageState";
import type { DailyTipsProduct } from "@/lib/sports/tips/product";
import type { LiveScoreBoard } from "@/lib/sports/liveScoreBoard";

function daily(fixturesFound: number): DailyTipsProduct {
  return {
    summary: { fixturesFound, fixturesAnalysed: fixturesFound, valuePicks: 0, watchlist: fixturesFound },
    slate: { provider: { status: "completed", lastRun: { finishedAt: "2026-07-29T08:00:00.000Z" } } },
    sections: { valuePicks: [], leans: [], watchlist: [], noPicks: [], schedule: [] }
  } as unknown as DailyTipsProduct;
}

const emptyBoard = { fixtures: [] } as unknown as LiveScoreBoard;

describe("homepage pending vs empty", () => {
  it("reports pending when the daily read never returned", () => {
    // The homepage races this read against a 2.5s budget; on a cold start the
    // read takes ~14s and falls back to null.
    const state = deriveHomepageMatchdayState(null, emptyBoard);

    expect(state.dataState).toBe("pending");
  });

  it("still falls back to live-board coverage when the engine read fails", () => {
    // Deliberate existing behaviour, pinned by homepage-resilience.test.ts:
    // a failed engine read should surface live scores rather than an empty page.
    const board = { fixtures: [{ phase: "live" }, { phase: "upcoming" }] } as unknown as LiveScoreBoard;
    const state = deriveHomepageMatchdayState(null, board);

    expect(state.usesLiveFallback).toBe(true);
    expect(state.dataState).toBe("pending");
  });

  it("reports ready with a genuine zero when the read returned no fixtures", () => {
    const state = deriveHomepageMatchdayState(daily(0), emptyBoard);

    expect(state.dataState).toBe("ready");
    expect(state.fixtureCount).toBe(0);
  });

  it("reports ready with the real count when the read succeeded", () => {
    const state = deriveHomepageMatchdayState(daily(698), emptyBoard);

    expect(state.dataState).toBe("ready");
    expect(state.fixtureCount).toBe(698);
  });

  it("distinguishes a pending weekly read from an unavailable weekly feed", () => {
    const pending = getWeeklyEmptyState(null, false, true);
    const unavailable = getWeeklyEmptyState("failed", false, false);

    expect(pending.title).toMatch(/still loading/i);
    expect(unavailable.title).toMatch(/unavailable/i);
  });
});
