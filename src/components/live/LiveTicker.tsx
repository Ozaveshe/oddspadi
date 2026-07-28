"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { LiveBoardFixture, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { LocalTimeText } from "@/components/odds/LocalTime";
import { useLiveBoard } from "./useLiveBoard";

/**
 * Live/finished chips carry a provider status label; upcoming chips carry the
 * kickoff, which must go through LocalTime so the server-rendered pass and the
 * hydrated pass agree before settling on the visitor's own zone.
 */
function ChipStatus({ fixture }: { fixture: LiveBoardFixture }) {
  if (fixture.phase === "live" || fixture.phase === "finished") return <>{fixture.statusLabel}</>;
  return <LocalTimeText iso={fixture.kickoff} />;
}

export function LiveTicker({ initial }: { initial: LiveScoreBoard | null }) {
  const { board } = useLiveBoard(initial, 60_000);

  const picks = useMemo(() => {
    const fixtures = board?.fixtures ?? [];
    const live = fixtures.filter((fixture) => fixture.phase === "live");
    const upcoming = fixtures.filter((fixture) => fixture.phase === "upcoming");
    return [...live, ...upcoming].slice(0, 14);
  }, [board]);

  if (!board) {
    return (
      <div className="ticker-wrap" aria-hidden="true">
        <div className="ticker">
          {[0, 1, 2, 3, 4].map((index) => (
            <div className="skeleton" key={index} style={{ height: 74, minWidth: 190, flex: "0 0 auto" }} />
          ))}
        </div>
      </div>
    );
  }

  if (!picks.length) {
    return (
      <div className="ticker-empty">
        <span className="te-dot" aria-hidden="true" />
        <span>No matches kicking off right now.</span>
        <Link className="inline-link" href="/live-scores">
          Browse all live scores
        </Link>
      </div>
    );
  }

  return (
    <div className="ticker-wrap">
      {/* A named group, not a live region: the ticker re-renders all 14 chips
          on every 60s poll, so `aria-live` re-read the whole strip aloud each
          time. The live board owns score announcements. */}
      <div className="ticker" role="group" aria-label="Live and upcoming matches">
        {picks.map((fixture) => (
          <Link className="ticker-chip" href="/live-scores" key={fixture.id}>
            <span className="t-league">
              {fixture.league.flag ? (
                <img className="flag" src={fixture.league.flag} alt="" width={16} height={11} loading="lazy" referrerPolicy="no-referrer" />
              ) : null}
              <span aria-hidden="true">{fixture.sport === "football" ? "⚽" : fixture.sport === "basketball" ? "🏀" : "🎾"}</span>
              {fixture.league.name}
            </span>
            <span className="t-row">
              <span className="team-name">{fixture.home.name}</span>
              <span className="t-score">
                {fixture.goals.home !== null && fixture.goals.away !== null
                  ? `${fixture.goals.home} - ${fixture.goals.away}`
                  : "vs"}
              </span>
            </span>
            <span className="t-row">
              <span className="team-name">{fixture.away.name}</span>
              {fixture.phase === "live" ? (
                <span className="t-min"><ChipStatus fixture={fixture} /></span>
              ) : (
                <span className="muted small">
                  <ChipStatus fixture={fixture} />
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
