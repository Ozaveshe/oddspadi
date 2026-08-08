import type { CuratedBoard, RankedFixture } from "@/lib/discovery/fixtureRanking";

/**
 * Splitting the board into what is happening and what is filed.
 *
 * The ranking engine produces one ordered list. That is right for relevance and
 * wrong for a screen: on a normal day most of the catalogue is finished
 * fixtures the model passed on, and they outnumber everything a reader came
 * for. They are legitimate evidence — an abstention is a real analysis and the
 * archive is what makes the record honest — but they are not "today".
 *
 * So the split is not a filter that discards. Every fixture lands in exactly
 * one section, the counts are reported, and the full catalogue stays one click
 * away. A board that quietly drops coverage and a board that drowns in it are
 * the same failure seen from opposite sides.
 */

export type TodayBoard = {
  /** What is happening now or next, and can still be acted on. */
  primary: RankedFixture[];
  /** Finished fixtures carrying a published claim — the record, not the forecast. */
  recentResults: RankedFixture[];
  /**
   * Finished fixtures the model analysed and did not pick, plus abstentions.
   * Real evidence, filed rather than deleted.
   */
  evidenceArchive: RankedFixture[];
  counts: {
    primary: number;
    recentResults: number;
    evidenceArchive: number;
    /** Everything in the catalogue, including what diversity caps held back. */
    catalogue: number;
    heldBackByDiversity: number;
  };
  /** True when the primary board is empty but the catalogue is not. */
  primaryEmptyWithCoverage: boolean;
};

const CURRENT_STATUSES = new Set(["scheduled", "live"]);

export type TodayBoardOptions = {
  /** Cap on the primary board. The rest stays reachable through "view all". */
  primaryLimit?: number;
};

export function buildTodayBoard(board: CuratedBoard, options: TodayBoardOptions = {}): TodayBoard {
  const primaryLimit = Math.max(1, options.primaryLimit ?? 40);

  const primary: RankedFixture[] = [];
  const recentResults: RankedFixture[] = [];
  const evidenceArchive: RankedFixture[] = [];

  // Classified from the full ranked set, not the capped one. The diversity
  // caps protect the primary board's first screen; applying them here would
  // silently shrink the recent-results and archive counts.
  for (const entry of board.ranked) {
    if (CURRENT_STATUSES.has(entry.fixture.status)) {
      primary.push(entry);
      continue;
    }
    // A finished fixture with a published claim is the track record, and a
    // reader who followed the pick is owed its result on the same screen they
    // saw the pick. Without one, it is an entry in the archive.
    if (entry.fixture.hasOfficialDecision) {
      recentResults.push(entry);
      continue;
    }
    evidenceArchive.push(entry);
  }

  const capped = primary.slice(0, primaryLimit);
  // Overflow is not archived — it is still current, just below the fold. It
  // stays counted in `primary` so "view all" leads somewhere honest.
  const overflow = primary.length - capped.length;

  return {
    primary: capped,
    recentResults,
    evidenceArchive,
    counts: {
      primary: primary.length,
      recentResults: recentResults.length,
      evidenceArchive: evidenceArchive.length,
      catalogue: board.catalogueSize,
      heldBackByDiversity: board.heldBack.total
    },
    // The distinction a reader needs on an empty screen: nothing to show today
    // versus nothing at all. Only the first is normal.
    primaryEmptyWithCoverage: capped.length === 0 && (board.catalogueSize > 0 || overflow > 0)
  };
}

/**
 * The line under a capped board.
 *
 * Never a silent truncation: a board showing 40 of 300 with no note reads as
 * the whole slate, and a reader who acts on that is acting on a false premise
 * this system created.
 */
export function boardDisclosure(board: TodayBoard): string | null {
  const hidden = board.counts.primary - board.primary.length;
  const held = board.counts.heldBackByDiversity;
  if (hidden <= 0 && held <= 0) return null;

  const parts: string[] = [];
  if (hidden > 0) parts.push(`${hidden} more happening today`);
  if (held > 0) parts.push(`${held} held back so one competition does not fill the board`);
  return `Showing ${board.primary.length}. ${parts.join(", ")}. View all to see everything.`;
}
