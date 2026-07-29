import type { LiveBoardFixture, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import type { ProviderRunStatus } from "@/lib/sports/intelligence/types";
import type { DailyTipsProduct } from "@/lib/sports/tips/product";

export type HomepageProviderState = ProviderRunStatus;

export type HomepageMatchdayState = {
  /**
   * Whether the daily read actually completed.
   *
   * The homepage races each read against a 2.5s budget and falls back to null.
   * A null read was then rendered as `0 fixtures` with provider health
   * "Feed unavailable" — stating as fact something the page had not managed to
   * find out. On a cold serverless start the daily read takes ~14s, so a board
   * holding 698 fixtures routinely told visitors there were none. A timeout is
   * "not yet known", never "nothing there".
   */
  dataState: "ready" | "pending";
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

/**
 * Human copy for each engine run status.
 *
 * The homepage rendered the raw enum under a "Provider health" label, so
 * visitors read bare tokens like `unavailable`, `partial` and `empty`.
 */
const PROVIDER_LABELS: Record<ProviderRunStatus, string> = {
  running: "Run in progress",
  completed: "Healthy",
  partial: "Partial run",
  empty: "No fixtures returned",
  failed: "Run failed",
  unavailable: "Feed unavailable"
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
  // Only claim the engine produced nothing when the read actually returned.
  const usesLiveFallback = daily !== null && boardFixtures.length > 0 && engineFixtureCount === 0;
  const rawProviderState: ProviderRunStatus = daily?.slate.provider.status ?? "unavailable";
  const displayedFixtures = usesLiveFallback ? boardFixtures : [];

  return {
    dataState: daily === null ? "pending" : "ready",
    fixtureCount: engineFixtureCount,
    liveBoardFixtureCount: boardFixtures.length,
    liveCount: displayedFixtures.filter((fixture) => fixture.phase === "live").length,
    upcomingCount: displayedFixtures.filter((fixture) => fixture.phase === "upcoming").length,
    finishedCount: displayedFixtures.filter((fixture) => fixture.phase === "finished").length,
    analysedCount: daily?.summary.fixturesAnalysed ?? 0,
    valuePickCount: daily?.summary.valuePicks ?? 0,
    watchlistCount: daily?.summary.watchlist ?? 0,
    providerState: rawProviderState,
    providerLabel: daily === null ? "Checking feed" : PROVIDER_LABELS[rawProviderState] ?? rawProviderState,
    // Say which source the visitor is actually looking at. When the engine
    // returns nothing the page falls back to live-board fixtures, but the
    // label still read "Prediction engine" — crediting the engine for coverage
    // it did not produce, on a product whose whole pitch is transparency.
    sourceLabel: daily === null
      ? "Still reading today's board"
      : usesLiveFallback ? "Live score board (engine produced no fixtures)" : "Prediction engine",
    lastUpdatedAt: daily?.slate.provider.lastRun?.finishedAt ?? null,
    usesLiveFallback,
    featuredFixture: usesLiveFallback ? boardFixtures[0] ?? null : null,
    previewFixtures: usesLiveFallback ? boardFixtures.slice(0, 3) : []
  };
}

export function getWeeklyEmptyState(
  providerStatus: ProviderRunStatus | null,
  liveCoverageAvailable: boolean,
  // Same distinction as the matchday card: a read that never returned is not
  // evidence that the weekly feed is down.
  pending = false
) {
  if (pending) {
    return {
      title: "Still loading the seven-day board",
      detail: "The weekly read did not finish in time for this render. Refresh in a moment.",
      showLiveLink: liveCoverageAvailable
    };
  }
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
