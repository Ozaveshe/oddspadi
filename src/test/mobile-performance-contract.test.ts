import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("mobile performance contract", () => {
  it("progressively renders the live board and optimizes provider artwork", () => {
    const board = source("src/components/live/LiveScoreBoard.tsx");
    const presentation = source("src/lib/sports/liveBoardPresentation.ts");
    const config = source("next.config.mjs");
    expect(presentation).toContain("LIVE_BOARD_INITIAL_FIXTURES = 36");
    expect(presentation).toContain("fixtures: board.fixtures.slice");
    expect(board).toContain("visibleFixtures");
    expect(board).toContain("ensureCompleteBoard");
    expect(board).toContain("Show next");
    expect(board).toContain("ProviderArtwork");
    expect(board).toContain("CONFIRMED_MISSING_PROVIDER_ARTWORK");
    expect(board).toContain("football/teams/28004.png");
    expect(board).toContain("basketball/teams/6301.png");
    expect(board).toContain("basketball/teams/7354.png");
    expect(board).toContain("basketball/teams/7882.png");
    expect(board).toContain("basketball/teams/7889.png");
    expect(config).toContain('hostname: "media.api-sports.io"');
    expect(config).toContain("minimumCacheTTL: 86_400");
  });

  it("shares the same short-lived live-board cache between the page and API", () => {
    const page = source("src/app/live-scores/page.tsx");
    const api = source("src/app/api/live/route.ts");
    const cache = source("src/lib/sports/cachedLiveScoreBoard.ts");
    expect(page).toContain("getCachedLiveScoreBoard");
    expect(page).toContain("export const revalidate = 30");
    expect(api).toContain("getCachedLiveScoreBoard");
    expect(cache).toContain("unstable_cache");
    expect(cache).toContain("revalidate: 30");
  });

  it("bounds historical evidence reads when the backing store is degraded", () => {
    const report = source("src/lib/sports/performance/report.ts");
    const census = source("src/lib/sports/training/supabaseTrainingCorpusCensus.ts");
    expect(report).toContain("AbortSignal.timeout(HISTORICAL_EVIDENCE_READ_TIMEOUT_MS)");
    expect(report).toContain(".abortSignal(abortSignal)");
    expect(census).toContain("AbortSignal.timeout(TRAINING_CENSUS_READ_TIMEOUT_MS)");
    expect(census).toContain("query.abortSignal(abortSignal)");
  });

  it("removes expensive mobile effects and keeps live controls usable", () => {
    const styles = source("src/app/globals.css");
    expect(styles).toContain("--faint: #637568");
    expect(styles).toContain("backdrop-filter: none");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("body::after");
    expect(styles).toContain("display: none");
    expect(styles).toContain("live-results-footer");
  });

  it("loads followed teams only on surfaces that consume them", () => {
    const provider = source("src/components/account/FollowedTeamsProvider.tsx");
    expect(provider).toContain("ensureLoaded");
    expect(provider).not.toContain('fetch("/api/account/followed-teams", { cache: "no-store" })');
    expect(provider).not.toContain("useEffect(() => { void refresh()");
  });
});
