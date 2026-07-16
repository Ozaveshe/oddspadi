import { unstable_cache } from "next/cache";
import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";

const readCachedLiveScoreBoard = unstable_cache(
  async (date: string) => fetchLiveScoreBoard(date || undefined),
  ["oddspadi-public-live-score-board-v1"],
  { revalidate: 30 }
);

/**
 * Shares one short-lived live-board snapshot across the page and JSON API.
 * The browser still polls /api/live, while cold server renders avoid repeating
 * the same provider and repository work for every visitor.
 */
export function getCachedLiveScoreBoard(date?: string) {
  return readCachedLiveScoreBoard(date ?? "");
}
