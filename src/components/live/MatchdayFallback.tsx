import Link from "next/link";
import type { LiveBoardFixture, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { LocalTime } from "@/components/odds/LocalTime";

function sportLabel(fixture: LiveBoardFixture): string {
  if (fixture.sport === "football") return "Football";
  if (fixture.sport === "basketball") return "Basketball";
  return "Tennis";
}

/**
 * Kickoffs render through LocalTime so the visitor sees their own clock; this
 * card is a server component, so a raw toLocaleTimeString would pin every time
 * to the deploy host's zone (UTC).
 */
function FixtureMoment({ fixture }: { fixture: LiveBoardFixture }) {
  if (fixture.phase === "live") return <>{fixture.statusLabel || "Live"}</>;
  if (fixture.phase === "finished") return <>{fixture.statusLabel || "Final"}</>;
  return <LocalTime iso={fixture.kickoff} />;
}

function coverageLabel(fixture: LiveBoardFixture): string {
  const source = fixture.analysis ? "Stored match record" : fixture.phase === "live"
    ? "Live score coverage"
    : fixture.phase === "finished"
      ? "Final score coverage"
      : "Scheduled coverage";
  return `${source} · analysis not published`;
}

export function MatchdayFixtureCard({ fixture, featured = false }: { fixture: LiveBoardFixture; featured?: boolean }) {
  const hasScore = fixture.goals.home !== null && fixture.goals.away !== null;
  return (
    <article className={`matchday-fallback-card${featured ? " featured" : ""}`}>
      <div className="matchday-fallback-topline">
        <span>{sportLabel(fixture)} &middot; {fixture.league.name}</span>
        <strong className={fixture.phase === "live" ? "is-live" : undefined}><FixtureMoment fixture={fixture} /></strong>
      </div>
      <div className="matchday-fallback-teams">
        <span>{fixture.home.name}</span>
        <b>{hasScore ? `${fixture.goals.home} - ${fixture.goals.away}` : "vs"}</b>
        <span>{fixture.away.name}</span>
      </div>
      <div className="matchday-fallback-footer">
        <span>{coverageLabel(fixture)}</span>
        <Link className="text-link" href="/live-scores">Follow match &rarr;</Link>
      </div>
    </article>
  );
}

export function LiveCoverageFallback({ board, limit = 3 }: { board: LiveScoreBoard; limit?: number }) {
  const fixtures = [
    ...board.fixtures.filter((fixture) => fixture.phase === "live"),
    ...board.fixtures.filter((fixture) => fixture.phase === "upcoming"),
    ...board.fixtures.filter((fixture) => fixture.phase === "finished")
  ].slice(0, limit);

  return (
    <section className="section live-coverage-fallback" aria-labelledby="live-fallback-title">
      <div className="section-title">
        <div>
          <span className="section-kicker">Match coverage is available</span>
          <h2 id="live-fallback-title">Prediction analysis is not published for these matches</h2>
        </div>
        <Link className="button small-btn" href="/live-scores">Open live board</Link>
      </div>
      <p className="live-coverage-explainer">
        These are real fixtures from the score board. No selection is shown unless OddsPadi has a stored, publishable analysis.
      </p>
      <div className="matchday-fallback-grid">
        {fixtures.map((fixture) => <MatchdayFixtureCard fixture={fixture} key={fixture.id} />)}
      </div>
    </section>
  );
}
