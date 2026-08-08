import Link from "next/link";
import { LocalTime } from "@/components/odds/LocalTime";
import { FixtureCard } from "@/components/product/FixtureCard";
import { curateBoard, type ViewerContext } from "@/lib/discovery/fixtureRanking";
import { boardDisclosure, buildTodayBoard } from "@/lib/discovery/todayBoard";
import { toCardInput, toRankableFixture } from "@/lib/discovery/slateAdapter";
import { fixtureRoute } from "@/lib/discovery/liveContinuity";
import type { SlateFixture } from "@/lib/sports/intelligence/types";

/**
 * The ranked board.
 *
 * The ranking engine, the diversity caps and the board split existed for weeks
 * with no consumer — every one of them tested, none of them affecting a single
 * pixel. This is the component that makes them real.
 *
 * It renders three sections rather than one list, because on a normal day the
 * finished no-pick archive outnumbers everything a reader came for. Nothing is
 * discarded: the counts are shown and the full catalogue stays one link away.
 */

export type RankedFixtureBoardProps = {
  rows: SlateFixture[];
  viewer: ViewerContext;
  /** Cap on the primary board. The rest is reachable through "view all". */
  primaryLimit?: number;
  /** Where "view all" goes. */
  viewAllHref?: string;
  heading?: string;
};

export function RankedFixtureBoard({
  rows,
  viewer,
  primaryLimit = 24,
  viewAllHref = "/predictions",
  heading = "What matters now"
}: RankedFixtureBoardProps) {
  const byId = new Map(rows.map((row) => [row.fixture.fixtureId, row]));
  const curated = curateBoard(rows.map((row) => toRankableFixture(row)), viewer);
  const board = buildTodayBoard(curated, { primaryLimit });
  const disclosure = boardDisclosure(board);

  /**
   * An empty primary board does not short-circuit the rest.
   *
   * The first version returned early here, which hid recently settled picks
   * entirely — at precisely the moment a reader wants them most. Nothing is
   * running, so the only question left is how today's picks finished.
   */
  return (
    <>
      {board.primary.length === 0 ? (
        <section className="section" aria-labelledby="ranked-board-empty">
          <h2 id="ranked-board-empty">{heading}</h2>
          <div className="notice">
            {board.primaryEmptyWithCoverage
              ? // Nothing today and nothing at all are different facts, and
                // only the first is normal.
                "Nothing is running or due right now. Finished matches and the analysis archive are below."
              : "No fixtures are covered for this window yet."}
          </div>
        </section>
      ) : (
        <section className="section" aria-labelledby="ranked-board-heading">
          <div className="section-title">
            <div>
              <span className="section-kicker">Ranked for you</span>
              <h2 id="ranked-board-heading">{heading}</h2>
            </div>
            <Link className="button small-btn" href={viewAllHref}>
              View all
            </Link>
          </div>

          <div className="match-list">
            {board.primary.map((entry) => {
              const row = byId.get(entry.fixture.fixtureId);
              if (!row) return null;
              return (
                <FixtureCard
                  key={entry.fixture.fixtureId}
                  fixtureId={entry.fixture.fixtureId}
                  href={fixtureRoute(entry.fixture.fixtureId)}
                  homeTeam={entry.fixture.homeTeam}
                  awayTeam={entry.fixture.awayTeam}
                  competition={entry.fixture.competition}
                  kickoffLabel={<LocalTime iso={entry.fixture.kickoffAt} variant="kickoff" />}
                  score={row.fixture.score ? { home: row.fixture.score.home, away: row.fixture.score.away } : null}
                  card={toCardInput(row)}
                />
              );
            })}
          </div>

          {/* Never a silent truncation: a board showing 24 of 300 with no note
              reads as the whole slate. */}
          {disclosure ? <p className="muted small">{disclosure}</p> : null}
        </section>
      )}

      {board.recentResults.length > 0 ? (
        <section className="section" aria-labelledby="ranked-board-results">
          <div className="section-title">
            <div>
              <span className="section-kicker">Recently settled</span>
              <h2 id="ranked-board-results">How the published picks finished</h2>
            </div>
            <Link className="button small-btn" href="/track-record">
              Track record
            </Link>
          </div>
          <div className="match-list">
            {board.recentResults.slice(0, 6).map((entry) => {
              const row = byId.get(entry.fixture.fixtureId);
              if (!row) return null;
              return (
                <FixtureCard
                  key={entry.fixture.fixtureId}
                  fixtureId={entry.fixture.fixtureId}
                  href={fixtureRoute(entry.fixture.fixtureId)}
                  homeTeam={entry.fixture.homeTeam}
                  awayTeam={entry.fixture.awayTeam}
                  competition={entry.fixture.competition}
                  kickoffLabel={<LocalTime iso={entry.fixture.kickoffAt} variant="kickoff" />}
                  score={row.fixture.score ? { home: row.fixture.score.home, away: row.fixture.score.away } : null}
                  variant="compact"
                  card={toCardInput(row)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {board.counts.evidenceArchive > 0 ? <ArchiveSummary board={board} viewAllHref={viewAllHref} /> : null}
    </>
  );
}

/**
 * The abstention archive, as a count and a link rather than a list.
 *
 * These are real analyses and they are kept. They are not on the board because
 * a reader looking for tonight's matches should not have to scroll past four
 * hundred finished fixtures the model passed on.
 */
function ArchiveSummary({
  board,
  viewAllHref
}: {
  board: ReturnType<typeof buildTodayBoard>;
  viewAllHref: string;
}) {
  return (
    <section className="section" aria-labelledby="ranked-board-archive">
      <div className="section-title">
        <div>
          <span className="section-kicker">Evidence archive</span>
          <h2 id="ranked-board-archive">Analysed, no pick published</h2>
        </div>
        <Link className="button small-btn" href={viewAllHref}>
          Open the full board
        </Link>
      </div>
      <p className="muted small">
        {board.counts.evidenceArchive} finished {board.counts.evidenceArchive === 1 ? "fixture" : "fixtures"} the engine
        analysed without publishing a pick. A pass is a complete analysis, and it is kept rather than deleted.
      </p>
    </section>
  );
}
