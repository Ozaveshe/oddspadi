import type { LiveBoardFixture, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import type { ProviderRunStatus } from "@/lib/sports/intelligence/types";
import type { DailyTipsProduct } from "@/lib/sports/tips/product";

export type HomepageProviderState = ProviderRunStatus;

export type HomepageMatchdayState = {
  fixtureCount: number;
  liveBoardFixtureCount: number;
  liveCount: number;
  upcomingCount: number;
  finishedCount: number;
  analysedCount: number;
  valuePickCount: number;
  watchlistCount: number;
  providerState: HomepageProviderState;
  providerLabel: string;
  sourceLabel: string;
  lastUpdatedAt: string | null;
  usesLiveFallback: boolean;
  featuredFixture: LiveBoardFixture | null;
  previewFixtures: LiveBoardFixture[];
};

function preferredBoardFixtures(board: LiveScoreBoard | null): LiveBoardFixture[] {
  const fixtures = board?.fixtures ?? [];
  return [
    ...fixtures.filter((fixture) => fixture.phase === "live"),
    ...fixtures.filter((fixture) => fixture.phase === "upcoming"),
    ...fixtures.filter((fixture) => fixture.phase === "finished"),
    ...fixtures.filter((fixture) => fixture.phase === "other")
  ];
}

export function deriveHomepageMatchdayState(
  daily: DailyTipsProduct | null,
  liveBoard: LiveScoreBoard | null
): HomepageMatchdayState {
  const boardFixtures = preferredBoardFixtures(liveBoard);
  const engineFixtureCount = daily?.summary.fixturesFound ?? 0;
  const usesLiveFallback = boardFixtures.length > 0 && engineFixtureCount === 0;
  const rawProviderState: ProviderRunStatus = daily?.slate.provider.status ?? "unavailable";
  const displayedFixtures = usesLiveFallback ? boardFixtures : [];

  return {
    fixtureCount: engineFixtureCount,
    liveBoardFixtureCount: boardFixtures.length,
    liveCount: displayedFixtures.filter((fixture) => fixture.phase === "live").length,
    upcomingCount: displayedFixtures.filter((fixture) => fixture.phase === "upcoming").length,
    finishedCount: displayedFixtures.filter((fixture) => fixture.phase === "finished").length,
    analysedCount: daily?.summary.fixturesAnalysed ?? 0,
    valuePickCount: daily?.summary.valuePicks ?? 0,
    watchlistCount: daily?.summary.watchlist ?? 0,
    providerState: rawProviderState,
    providerLabel: rawProviderState,
    sourceLabel: "Prediction engine",
    lastUpdatedAt: daily?.slate.provider.lastRun?.finishedAt ?? null,
    usesLiveFallback,
    featuredFixture: usesLiveFallback ? boardFixtures[0] ?? null : null,
    previewFixtures: usesLiveFallback ? boardFixtures.slice(0, 3) : []
  };
}

export function getWeeklyEmptyState(providerStatus: ProviderRunStatus | null, liveCoverageAvailable: boolean) {
  const scheduledEmpty = providerStatus === "completed" || providerStatus === "empty";
  return {
    title: scheduledEmpty ? "No weekly fixtures are published yet" : "Weekly analysis is currently unavailable",
    detail: scheduledEmpty
      ? "The current seven-day schedule is empty. OddsPadi will not fill it with sample fixtures."
      : liveCoverageAvailable
        ? "Live score coverage remains available while the scheduled analysis feed recovers."
        : "The scheduled analysis feed is unavailable, and there is no live coverage to substitute right now.",
    showLiveLink: liveCoverageAvailable
  };
}
