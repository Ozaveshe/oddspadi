import Link from "next/link";
import type { LiveBoardFixture, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import type { FixtureStatus } from "@/lib/domain/states";
import { LocalTime } from "@/components/odds/LocalTime";
import { FixtureCard } from "@/components/product/FixtureCard";

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
  return <LocalTime iso={fixture.kickoff} variant="kickoff" />;
}

function coverageLabel(fixture: LiveBoardFixture): string {
  const source = fixture.analysis ? "Stored match record" : fixture.phase === "live"
    ? "Live score coverage"
    : fixture.phase === "finished"
      ? "Final score coverage"
      : "Scheduled coverage";
  return `${source} · analysis not published`;
}

/** The live board's phase vocabulary, in the fixture-status terms the card speaks. */
function fixtureStatusFor(phase: LiveBoardFixture["phase"]): FixtureStatus {
  if (phase === "live") return "live";
  if (phase === "finished") return "finished";
  return "scheduled";
}

/**
 * The live board's fixture, rendered by the shared card.
 *
 * This used to be its own card markup, which meant the live board and the
 * prediction list disagreed about how a fixture looks and — worse — about what
 * its state is called. The card is now the same object every discovery surface
 * renders; only the mapping into it lives here.
 *
 * No decision is passed: this is the *fallback* path, shown precisely when no
 * publishable analysis exists. The card resolves that to "Analysis
 * unavailable" on its own rather than this file inventing a label for it.
 */
export function MatchdayFixtureCard({ fixture, featured = false }: { fixture: LiveBoardFixture; featured?: boolean }) {
  const hasScore = fixture.goals.home !== null && fixture.goals.away !== null;
  return (
    <div className={featured ? "matchday-fallback-featured" : undefined}>
      <FixtureCard
        fixtureId={String(fixture.id)}
        href={fixture.analysis ? `/predictions/${fixture.matchId}` : "/live-scores"}
        homeTeam={fixture.home.name}
        awayTeam={fixture.away.name}
        competition={`${sportLabel(fixture)} · ${fixture.league.name}`}
        kickoffLabel={<FixtureMoment fixture={fixture} />}
        score={hasScore ? { home: fixture.goals.home!, away: fixture.goals.away! } : null}
        variant="compact"
        card={{
          fixtureStatus: fixtureStatusFor(fixture.phase),
          decision: null,
          hasOfficialPick: false,
          settlement: null,
          oddsAreCurrent: false,
          hasHistoricalOdds: false,
          decimalOdds: null,
          modelProbability: null,
          reason: coverageLabel(fixture)
        }}
      />
    </div>
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
