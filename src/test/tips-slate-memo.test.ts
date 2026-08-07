import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { slateIsCacheable, ttlMemo, ttlMemoByKey } from "@/lib/sports/tips/slateMemo";
import { DATA_CACHE_LIMIT_BYTES, cacheEntryBytes, pruneSlateForCache } from "@/lib/sports/tips/tipsCacheShape";
import type { SportsSlate } from "@/lib/sports/intelligence/types";

/**
 * The tips reads passed a 36.6MB day and a 62.5MB week to `unstable_cache`,
 * which refuses anything over 2MB and fails open — computing the value, logging
 * "items over 2MB can not be cached", storing nothing. Measured hit rate zero,
 * with a full serialisation charged to every request to establish that.
 */

function slate(overrides: Partial<SportsSlate> = {}): SportsSlate {
  return {
    scope: "daily",
    generatedAt: "2026-08-03T12:00:00.000Z",
    range: { from: "2026-08-03", to: "2026-08-03" },
    provider: { status: "ready", providers: [], lastRun: null, errors: [] },
    summary: {
      fixturesFound: 0, predictionsGenerated: 0, oddsSnapshotsUsed: 0, valuePicksPublished: 0,
      leansPublished: 0, watchlist: 0, noPickMatches: 0, preliminaryDecisions: 0,
      readyDecisions: 0, staleDecisions: 0, settledFixtures: 0
    },
    fixtures: [],
    groupedByDate: [],
    groups: { valuePicks: [], leans: [], watchlist: [], allAnalysed: [], noPicks: [] },
    ...overrides
  } as SportsSlate;
}

describe("ttlMemo", () => {
  it("serves the held value inside the window and reloads after it", async () => {
    let calls = 0;
    const load = vi.fn(async () => ++calls);
    const now = vi.spyOn(Date, "now");

    now.mockReturnValue(1_000);
    const memo = ttlMemo(load, 5_000);
    expect(await memo()).toBe(1);
    expect(await memo()).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);

    now.mockReturnValue(6_001);
    expect(await memo()).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("shares one in-flight load between concurrent callers", async () => {
    // A cold instance costs ~14s. Without sharing the promise, every request
    // that arrives during that window starts its own.
    let resolve: (value: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const memo = ttlMemo(load, 5_000);

    const [a, b] = [memo(), memo()];
    resolve("slate");

    expect(await a).toBe("slate");
    expect(await b).toBe("slate");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not hold a rejection for the window", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("statement timeout"))
      .mockResolvedValueOnce("recovered");
    const memo = ttlMemo(load as () => Promise<string>, 60_000);

    await expect(memo()).rejects.toThrow("statement timeout");
    expect(await memo()).toBe("recovered");
  });

  it("does not hold a resolved failure either", async () => {
    // The slate getters fail soft: a repository error resolves to a read-only
    // slate marked unavailable rather than throwing. Memoising that would serve
    // an empty board for the whole window.
    const unavailable = slate({ provider: { status: "unavailable", providers: [], lastRun: null, errors: ["timeout"] } });
    const load = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(slate());
    const memo = ttlMemo(load as () => Promise<SportsSlate>, 60_000, slateIsCacheable);

    expect((await memo()).provider.status).toBe("unavailable");
    expect((await memo()).provider.status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("treats unavailable and failed slates as not worth holding", () => {
    expect(slateIsCacheable(slate())).toBe(true);
    for (const status of ["unavailable", "failed"] as const) {
      expect(slateIsCacheable(slate({ provider: { status, providers: [], lastRun: null, errors: [] } }))).toBe(false);
    }
  });
});

describe("the tips reads stay off the data cache", () => {
  it("never routes a tips slate through unstable_cache", async () => {
    // The regression this prevents: caching a payload that cannot fit produces
    // a cache with no entries and a serialisation cost on every request, and
    // says so only in a log line.
    const source = await readFile("src/lib/sports/tips/publicReads.ts", "utf8");

    // Weekly still has its own single-slot memo; the two daily reads now share
    // one keyed memo, because "today" depends on the visitor's timezone.
    expect(source).toMatch(/const cachedWeeklyTipsSlate = ttlMemo\(/);
    expect(source).toMatch(/const cachedDailyTipsSlate = ttlMemoByKey\(/);
    expect(source, "tips slates must not go through unstable_cache").not.toMatch(
      /const cached(Daily|Today|Tomorrow|Weekly)TipsSlate = unstable_cache\(/
    );
  });

  it("keys the daily slate so one visitor's day cannot be served to another", () => {
    // A single-slot memo would hand whichever board loaded first to everyone,
    // so a Lagos reader could be served Sydney's day. It would look exactly
    // like a caching flake and be miserable to reproduce.
    const load = vi.fn(async (key: string) => slate({ generatedAt: key }));
    const memo = ttlMemoByKey(load, 60_000);

    memo("Africa/Lagos|0|1");
    memo("Africa/Lagos|0|1");
    memo("Australia/Sydney|0|2");

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith("Africa/Lagos|0|1");
    expect(load).toHaveBeenCalledWith("Australia/Sydney|0|2");
  });

  it("evicts expired keys instead of growing without bound", async () => {
    // The key space derives from a cookie, so an unbounded map here is a slow
    // memory leak a spread of unusual timezones could widen at will.
    vi.useFakeTimers();
    try {
      const load = vi.fn(async (key: string) => slate({ generatedAt: key }));
      const memo = ttlMemoByKey(load, 1_000);
      await memo("zone-a");
      vi.advanceTimersByTime(1_500);
      await memo("zone-b");
      // zone-a expired and was swept, so asking again is a fresh load.
      await memo("zone-a");
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prunes the derived views the product rebuilds anyway", () => {
    const withViews = slate({
      groupedByDate: [{ date: "2026-08-03", fixtures: [] }],
      groups: { valuePicks: [], leans: [], watchlist: [], allAnalysed: [], noPicks: [] }
    });

    const pruned = pruneSlateForCache(withViews);

    expect(pruned.groupedByDate).toEqual([]);
    expect(cacheEntryBytes(pruned)).toBeLessThan(cacheEntryBytes(withViews));
  });

  it("agrees with Next on where the ceiling is", () => {
    expect(DATA_CACHE_LIMIT_BYTES).toBe(2 * 1024 * 1024);
  });
});
