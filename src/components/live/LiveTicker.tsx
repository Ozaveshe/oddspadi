"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { LiveBoardFixture, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { useLiveBoard } from "./useLiveBoard";

function chipStatus(fixture: LiveBoardFixture): string {
  if (fixture.phase === "live") return fixture.statusLabel;
  if (fixture.phase === "finished") return fixture.statusLabel;
  return new Date(fixture.kickoff).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

  if (!picks.length) return null;

  return (
    <div className="ticker-wrap">
      <div className="ticker" aria-label="Live and upcoming matches">
        {picks.map((fixture) => (
          <Link className="ticker-chip" href="/live-scores" key={fixture.id}>
            <span className="t-league">
              {fixture.league.flag ? (
                <img className="flag" src={fixture.league.flag} alt="" width={16} height={11} loading="lazy" referrerPolicy="no-referrer" />
              ) : null}
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
                <span className="t-min">{chipStatus(fixture)}</span>
              ) : (
                <span className="muted small" suppressHydrationWarning>
                  {chipStatus(fixture)}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
